import { db as realFirestore, auth } from './realFirebase.js';
import { getDB, getMasterDB, getCompanyDB, clearCompanyDBCache, genericSchema, createCompany, setCompanyLiveStatus } from './localDB.js';
import { Timestamp } from '@firebase/firestore';
// Import directly from @firebase/* so Vite's 'firebase/firestore' → rxfs.js alias is bypassed
import { collection, doc, setDoc, onSnapshot, getDoc, writeBatch, getDocs, deleteDoc, query, where } from '@firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { sqlite as sqliteBridge } from './sqliteBridge';


const activeSyncs = {}; // record of companyId -> unsubscribe function
let liveAuthPromise = null;

// ⚡ SQLite fast-read mirror (Electron desktop only). Keeps the SQLite store in
// sync with RxDB after cloud pulls / lastSync patches so the fast read path
// never shows stale data.
const sqliteEnabled = (() => { try { return sqliteBridge.isAvailable(); } catch (e) { return false; } })();

async function sqliteMirror(companyId, docs) {
    if (!sqliteEnabled || !Array.isArray(docs) || docs.length === 0) return;
    try {
        await sqliteBridge.putRecords(String(companyId || ''), docs.map(d => ({
            id: d?.id,
            collectionName: d?.collectionName || '',
            data: (d && d.data !== undefined) ? d.data : d,
            timestamp: Number(d?.timestamp) || 0,
            lastSync: Number(d?.lastSync) || 0
        })));
    } catch (e) { /* non-fatal mirror */ }
}

async function sqliteMirrorDoc(companyId, doc) {
    if (!sqliteEnabled || !doc || !doc.id) return;
    try {
        await sqliteBridge.putRecord(String(companyId || ''), {
            id: doc.id,
            collectionName: doc.collectionName || '',
            data: doc.data !== undefined ? doc.data : doc,
            timestamp: Number(doc.timestamp) || 0,
            lastSync: Number(doc.lastSync) || 0
        });
    } catch (e) { /* non-fatal mirror */ }
}

async function sqliteMirrorRemove(companyId, id) {
    if (!sqliteEnabled || !id) return;
    try { await sqliteBridge.removeRecord(String(companyId || ''), id); } catch (e) { /* non-fatal mirror */ }
}

// Helper to ensure data is a plain JSON object (avoids DataCloneError in RxDB/BroadcastChannel)
function wash(data) {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) => {
        // If it's a Firestore Timestamp (resilient check for minified builds)
        if (value && typeof value === 'object' && (value.constructor?.name === 'Timestamp' || typeof value.toDate === 'function')) {
            const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value.seconds * 1000);
            return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0, _isTimestamp: true };
        }
        return value;
    }));
}

const waitForInitialAuthState = () => new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        resolve(user);
    });
});

const ensureLiveFirestoreAccess = async () => {
    if (auth.currentUser) {
        // console.log(`[LIVE] Using existing auth session: ${auth.currentUser.uid}`);
        return auth.currentUser;
    }

    const restoredUser = await waitForInitialAuthState();
    if (restoredUser) {
        console.log(`[LIVE] Restored previous auth session: ${restoredUser.uid}`);
        return restoredUser;
    }

    if (!liveAuthPromise) {
        console.log("[LIVE] No active session found. Establishing anonymous session...");
        liveAuthPromise = signInAnonymously(auth)
            .then(({ user }) => {
                console.log(`[LIVE] Firebase anonymous session established: ${user.uid}`);
                return user;
            })
            .catch((error) => {
                console.error('[LIVE] Failed to establish Firebase auth session:', error);
                throw error;
            })
            .finally(() => {
                liveAuthPromise = null;
            });
    }

    return liveAuthPromise;
};

// Start bidirectional sync for a live company
export const startLiveSync = async (companyId) => {
    if (activeSyncs[companyId]) return; // Already syncing
    
    try {
        await ensureLiveFirestoreAccess();
        const master = await getMasterDB();
        const companyDoc = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!companyDoc || !companyDoc.settings?.isLive) {
            console.log(`[SYNC] Company ${companyId} is not LIVE. Skipping sync initialization.`);
            return;
        }
        
        console.log(`[SYNC] Starting Live Sync for LIVE company: ${companyId}`);
        const tempIdHolder = localStorage.getItem('activeCompanyId');
        // Temporarily get the db for the target company
        localStorage.setItem('activeCompanyId', companyId);
        const rxdb = await getDB();
        // optionally restore the current active company id immediately if getDB is instantaneous, 
        // wait getDB caches the promise for currentCompanyId, so it might be tricky.
        // Actually, getDB uses the exported generic currentCompanyId if not passed.
        // If we want to sync the CURRENT company only, then companyId is just getActiveCompanyId().
        if (tempIdHolder !== companyId) {
            console.warn("[SYNC] Warning: sync requested for a non-active company. Forcing reload/reset is needed by localDB.js.");
            return;
        }

        const liveCollectionPath = `companies_live/${companyId}/records`;

        // 1. Initial full push if needed, but RxDB subscribe might not give existing docs unless we query them.
        // Actually, let's just push everything to be safe if this is the first time making it live!
        // 🚀 OPTIMIZATION: Only push local docs that are NOT in sync
        const allLocalDocs = await rxdb.offline_records.find().exec();
        const docsNeedingSync = allLocalDocs.filter(d => {
            const docData = d.toJSON();
            // A doc needs sync if it has never been synced or user modified it after last sync
            return !docData.lastSync || docData.lastSync < (docData.timestamp || 0);
        });

        if (docsNeedingSync.length === 0) {
            console.log("[SYNC] Local database is already in sync. No initial push needed.");
            if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('connected');
        } else {
            let batch = writeBatch(realFirestore);
            let count = 0;
            let totalSent = 0;
            let currentBatchDocs = [];

            console.log(`[SYNC] Found ${docsNeedingSync.length} docs needing sync for company ${companyId}.`);
            
            // Report initial syncing status
            if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('syncing', { progress: 0, total: docsNeedingSync.length });

            for (const rxdoc of docsNeedingSync) {
                const data = rxdoc.toJSON();
                const docRef = doc(realFirestore, liveCollectionPath, data.id);
                // Ensure document has a timestamp for sync logic
                if (!data.timestamp) data.timestamp = Date.now();
                
                batch.set(docRef, {
                    ...data,
                    syncTimestamp: Date.now()
                }, { merge: true });
                
                count++;
                totalSent++;
                currentBatchDocs.push(rxdoc);

                if (count >= 100) { // Safer batch size
                    await batch.commit();
                    
                    // ✅ UPDATE LOCAL RxDB with lastSync timestamp in parallel
                    const now = Date.now();
                    await Promise.all(currentBatchDocs.map(syncedDoc =>
                        syncedDoc.incrementalPatch({ lastSync: now }).catch(() => {})
                    ));

                    console.log(`[SYNC] Committed batch. Total sent: ${totalSent}/${docsNeedingSync.length}`);
                    if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('syncing', { progress: totalSent, total: docsNeedingSync.length });
                    batch = writeBatch(realFirestore);
                    count = 0;
                    currentBatchDocs = [];
                    await new Promise(r => setTimeout(r, 100)); 
                }
            }

            if (count > 0) {
                await batch.commit();
                const now = Date.now();
                await Promise.all(currentBatchDocs.map(syncedDoc =>
                    syncedDoc.incrementalPatch({ lastSync: now }).catch(() => {})
                ));
                if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('syncing', { progress: totalSent, total: docsNeedingSync.length });
            }

            console.log("[SYNC] Initial push complete.");
            if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('connected');
        }

        // Update registry with stats
        await registerCompanyAsLiveInFirestore(companyId, companyDoc.name, {
            records: allLocalDocs.length,
            lastSyncedAt: Date.now()
        });

        const isConflictError = (err) => {
            const msg = String(err?.message || err || '');
            return msg.includes('RxError (CONFLICT)') || msg.includes('Error-Code CONFLICT');
        };

        // Avoid push-back echoes for records just pulled from Firestore.
        const suppressPushUntil = new Map();
        const markRemoteApplied = (id) => {
            suppressPushUntil.set(id, Date.now() + 5000);
        };
        const isPushSuppressed = (id) => {
            const until = suppressPushUntil.get(id);
            if (!until) return false;
            if (Date.now() > until) {
                suppressPushUntil.delete(id);
                return false;
            }
            return true;
        };

        // Serialize pull application so large snapshots do not trigger overlapping writes.
        let pullQueue = Promise.resolve();

        // 2. LIVE PULL: Monitor for external changes
        // 🚀 OPTIMIZATION: Only pull records that changed after our last seen timestamp
        const lastPullKey = `nadtally_last_pull_${companyId}`;
        let lastPullTsFromStorage = Number(localStorage.getItem(lastPullKey) || 0);

        // If no prior pull timestamp, this PC just initialised (either the original owner
        // after the initial push, or a PC whose downloadLiveCompany didn't set the key).
        // Set to now so the pull subscription only captures FUTURE changes — existing data
        // was already pushed/downloaded and does not need to be replayed record-by-record.
        if (lastPullTsFromStorage === 0) {
            lastPullTsFromStorage = Date.now();
            localStorage.setItem(lastPullKey, String(lastPullTsFromStorage));
        }

        let maxSeenSyncTs = lastPullTsFromStorage;

        const pullQuery = query(
            collection(realFirestore, liveCollectionPath),
            where('syncTimestamp', '>', lastPullTsFromStorage)
        );

        const setupPullListener = () => {
        const q = pullQuery;
        const unsub = onSnapshot(q, (snapshot) => {
            pullQueue = pullQueue.then(async () => {
                const changes = snapshot.docChanges();
                if (changes.length === 0) return;

                console.log(`[SYNC] Pulling ${changes.length} remote changes.`);

                const addedOrModified = [];
                const deletedIds = [];

                for (const change of changes) {
                    // Sanitize raw Firestore data — Firestore Timestamp objects are not
                    // structured-clone-able and cause BroadcastChannel DataCloneErrors in RxDB.
                    const fsData = JSON.parse(JSON.stringify(change.doc.data()));
                    const remoteTs = fsData.syncTimestamp || 0;
                    if (remoteTs > maxSeenSyncTs) maxSeenSyncTs = remoteTs;

                    if (change.type === 'added' || change.type === 'modified') {
                        if (fsData?.id) {
                            if (fsData.deleted === true) {
                                deletedIds.push(fsData.id);
                            } else {
                                addedOrModified.push(fsData);
                            }
                        }
                    }
                }

                // 1. Handle Deletions in bulk with robust findOne & retry mechanisms to prevent conflict failure
                if (deletedIds.length > 0) {
                    for (const id of deletedIds) {
                        const MAX_RETRIES = 5;
                        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                            const fresh = await rxdb.offline_records.findOne({ selector: { id } }).exec();
                            if (!fresh) {
                                console.log(`[SYNC] Pull deletion: doc ${id} already removed or not found locally.`);
                                break; 
                            }
                            try {
                                markRemoteApplied(id);
                                await fresh.remove();
                                // ⚡ Mirror deletion to SQLite
                                sqliteMirrorRemove(companyId, id);
                                console.log(`[SYNC] Pull deletion: successfully deleted local doc ${id}`);
                                break; // success
                            } catch (e) {
                                const isConflict = e?.rxdb === true || e?.code === 'CONFLICT' ||
                                    (e?.message && e.message.includes('CONFLICT')) ||
                                    (e?.parameters?.writeError?.status === 409);
                                if (isConflict && attempt < MAX_RETRIES - 1) {
                                    console.warn(`[SYNC] Pull deletion: conflict for ${id}, retrying in ${(attempt + 1) * 50}ms...`);
                                    await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
                                    continue;
                                }
                                console.error(`[SYNC] Pull deletion: failed for ${id} after ${attempt + 1} attempts:`, e);
                                break;
                            }
                        }
                    }
                }

                // 2. Handle Added / Modified in bulk
                if (addedOrModified.length > 0) {
                    const ids = addedOrModified.map(d => d.id);
                    let existingDocsMap;
                    try {
                        existingDocsMap = await rxdb.offline_records.findByIds(ids);
                    } catch (e) {
                        console.warn('[SYNC] findByIds failed, falling back to individual lookup:', e);
                        existingDocsMap = new Map();
                    }

                    const toInsert = [];
                    const toUpdate = [];

                    for (const fsData of addedOrModified) {
                        const remoteTs = fsData.syncTimestamp || 0;
                        let existing;
                        try {
                            existing = existingDocsMap.get ? existingDocsMap.get(fsData.id) : existingDocsMap[fsData.id];
                        } catch (e) { existing = undefined; }

                        // Fallback: if findByIds returned nothing, try findOne individually
                        if (!existing) {
                            try {
                                existing = await rxdb.offline_records.findOne({ selector: { id: fsData.id } }).exec();
                            } catch (e) {}
                        }

                        if (!existing) {
                            toInsert.push(wash({
                                ...fsData,
                                lastSync: remoteTs
                            }));
                        } else {
                            const localTs = Number(existing.timestamp || 0);
                            const remoteDataTs = Number(fsData.timestamp || 0);
                            
                            // Apply incoming record only when it is newer (or equal for first insert).
                            if (localTs <= remoteDataTs) {
                                toUpdate.push({
                                    doc: existing,
                                    data: wash({
                                        ...fsData,
                                        lastSync: remoteTs
                                    })
                                });
                            }
                        }
                    }

                    // Bulk Insert new records (genuinely new docs only)
                    if (toInsert.length > 0) {
                        toInsert.forEach(d => markRemoteApplied(d.id));
                        try {
                            await rxdb.offline_records.bulkInsert(toInsert);
                        } catch (err) {
                            console.warn('[SYNC] bulkInsert failed for pulled records, falling back to individual inserts:', err);
                            for (const doc of toInsert) {
                                try {
                                    await rxdb.offline_records.insert(doc);
                                } catch (e) {
                                    // If insert fails (docs already exist), try patch instead
                                    try {
                                        const existing = await rxdb.offline_records.findOne({ selector: { id: doc.id } }).exec();
                                        if (existing) {
                                            await existing.incrementalPatch(doc);
                                            console.log(`[SYNC] Fallback: patched existing doc ${doc.id} instead of insert`);
                                        }
                                    } catch (e2) {}
                                }
                            }
                        }
                    }

                    // ⚡ Mirror pulled inserts to SQLite (idempotent upsert)
                    sqliteMirror(companyId, toInsert);

                    // Concurrent Upsert / Patch existing records
                    if (toUpdate.length > 0) {
                        toUpdate.forEach(u => markRemoteApplied(u.data.id));
                        await Promise.all(toUpdate.map(async (u) => {
                            try {
                                await u.doc.incrementalPatch(u.data);
                            } catch (e) {
                                if (!isConflictError(e)) {
                                    console.error('[SYNC] Pull patch failed:', u.data.id, e);
                                }
                            }
                        }));
                    }

                    // ⚡ Mirror pulled updates to SQLite
                    sqliteMirror(companyId, toUpdate.map(u => u.data));
                }
                
                // Update local storage so we don't pull these again next time
                if (maxSeenSyncTs > lastPullTsFromStorage) {
                    localStorage.setItem(lastPullKey, String(maxSeenSyncTs));
                }
            }).catch((e) => {
                console.error('[SYNC] Pull queue error:', e);
            });
        }, (err) => {
            // Error handler: auto-reconnect pull listener if it dies
            console.error('[SYNC] Pull listener error — reconnecting in 5s:', err?.message || err);
            setTimeout(() => {
                try {
                    unsubPull = setupPullListener();
                    console.log('[SYNC] Pull listener reconnected');
                } catch (e) {
                    console.error('[SYNC] Pull listener reconnect failed:', e);
                }
            }, 5000);
        });
        return unsub;
    };

    let unsubPull = setupPullListener();

        // 3. Set up PUSH to Firestore — rxdb.offline_records.$ emits RxChangeEvent one at a time
        const subPush = rxdb.offline_records.$.subscribe(async (changeEvent) => {
            try {
                const op = changeEvent.operation;
                const id = changeEvent.documentId;
                if (!id) return;
                
                if (isPushSuppressed(id)) {
                    console.log(`[SYNC] Push suppressed for ${id} (echo loop protection)`);
                    return;
                }

                // Serialize to plain JSON
                const data = JSON.parse(JSON.stringify(changeEvent.documentData));
                console.log(`[SYNC] Local change detected: ${op} ${id} (Col: ${data?.collectionName})`);

                // Filter echo pushes
                if (op !== 'DELETE') {
                    const localDataTs = Number(data.timestamp || 0);
                    const localLastSync = Number(data.lastSync || 0);
                    if (localLastSync > 0 && localLastSync >= localDataTs) {
                        return;
                    }
                }

                const docRef = doc(realFirestore, liveCollectionPath, id);

                if (op === 'INSERT' || op === 'UPDATE') {
                    console.log(`[SYNC] Pushing ${op} to cloud...`);
                    await setDoc(docRef, { ...data, syncTimestamp: Date.now() }, { merge: true });
                    console.log(`[SYNC] Successfully pushed ${op} for ${id}`);
                    
                    // ✅ Update local doc to reflect success
                    try {
                        const rxdoc = await rxdb.offline_records.findOne({ selector: { id } }).exec();
                        if (rxdoc) {
                            await rxdoc.incrementalPatch({ lastSync: Date.now() });
                            // ⚡ Mirror updated lastSync to SQLite
                            sqliteMirrorDoc(companyId, rxdoc.toJSON());
                            console.log(`[SYNC] Updated local lastSync for ${id}`);
                        }
                    } catch(e) {}
                } else if (op === 'DELETE') {
                    console.log(`[SYNC] Pushing soft-delete to cloud...`);
                    await setDoc(docRef, { id, deleted: true, syncTimestamp: Date.now() }, { merge: false });
                    console.log(`[SYNC] Successfully pushed DELETE for ${id}`);
                }
            } catch (err) {
                console.error('[SYNC] CRITICAL: Error pushing update to Firestore:', err);
            }
        });

        // Expose a direct push trigger for rxfs.js (backup if RxDB $ observable doesn't fire)
        window.__accproNotifyDataChange = async ({ id, collectionName, operation }) => {
            try {
                if (!id) return;
                console.log(`[SYNC] Direct notify: ${operation} ${id} (${collectionName})`);
                
                const docRef = doc(realFirestore, liveCollectionPath, id);
                
                if (operation === 'DELETE') {
                    await setDoc(docRef, { id, deleted: true, syncTimestamp: Date.now() }, { merge: false });
                    console.log(`[SYNC] Direct notify: pushed DELETE for ${id}`);
                    return;
                }
                
                // Re-read latest data from RxDB
                const fresh = await rxdb.offline_records.findOne({ selector: { id } }).exec();
                if (!fresh) {
                    console.warn(`[SYNC] Direct notify: doc ${id} not found in RxDB`);
                    return;
                }
                const freshData = fresh.toJSON();
                const freshTs = Number(freshData.timestamp || 0);
                const freshLastSync = Number(freshData.lastSync || 0);
                
                // Skip if already synced
                if (freshLastSync > 0 && freshLastSync >= freshTs) {
                    console.log(`[SYNC] Direct notify: ${id} already synced (lastSync=${freshLastSync} >= ts=${freshTs})`);
                    return;
                }
                
                await setDoc(docRef, { ...freshData, syncTimestamp: Date.now() }, { merge: true });
                console.log(`[SYNC] ✅ Direct notify: pushed UPDATE for ${id}`);
                
                // Update lastSync
                try {
                    await fresh.incrementalPatch({ lastSync: Date.now() });
                    // ⚡ Mirror updated lastSync to SQLite
                    sqliteMirrorDoc(companyId, fresh.toJSON());
                } catch(e) {}
            } catch (err) {
                console.error('[SYNC] Direct notify error:', err);
            }
        };

        activeSyncs[companyId] = () => {
            delete window.__accproNotifyDataChange;
            unsubPull();
            subPush.unsubscribe();
            delete activeSyncs[companyId];
        };
        
        console.log(`[SYNC] Active for ${companyId}`);

    } catch (err) {
        console.error("[SYNC] Error starting live sync:", err);
        if (window.onCloudSyncStatusChange) {
            const isQuota = String(err).includes('resource-exhausted');
            window.onCloudSyncStatusChange('error', { 
                message: isQuota ? 'Cloud Storage Full / Traffic Limit' : err.message || 'Sync Failed' 
            });
        }
    }
};

export const stopLiveSync = (companyId) => {
    if (activeSyncs[companyId]) {
        activeSyncs[companyId]();
        console.log(`[SYNC] Stopped Live Sync for company: ${companyId}`);
    }
};

/**
 * Make a company live:
 *  1. Authenticates with Firebase
 *  2. Uploads ALL local records for the company in batches
 *  3. Creates / updates the nadtally_live_registry document
 *  4. Marks the company isLive:true in local master DB
/**
 * Scans ALL IndexedDB databases looking for offline_records data.
 * This is a last-resort fallback when RxDB's query layer returns 0 documents.
 * RxDB with Dexie storage may fail to return docs due to schema/migration issues.
 */
const scanAllIndexedDBForOfflineRecords = async (companyId) => {
    const results = [];
    try {
        // Get all database names
        const dbList = indexedDB.databases ? await indexedDB.databases() : [];
        // Prioritize company-specific and master databases first
        const priority = [
            `nadtally_company_${companyId}`,
            'nadtally_master_db'
        ];
        const allNames = [
            ...priority,
            ...dbList.map(d => d.name).filter(n => n && !priority.includes(n) && n.startsWith('nadtally'))
        ];

        for (const dbName of allNames) {
            if (results.length > 0) break; // found data, stop searching
            try {
                const docs = await readOfflineRecordsFromIndexedDB(dbName);
                if (docs.length > 0) {
                    console.log(`[LIVE] Raw IDB scan found ${docs.length} records in "${dbName}".`);
                    results.push(...docs);
                }
            } catch (e) { /* ignore per-db errors */ }
        }
    } catch (e) {
        console.warn('[LIVE] scanAllIndexedDBForOfflineRecords error:', e);
    }
    return results;
};

/**
 * Opens an IndexedDB by name and reads all records from any object store
 * that looks like offline_records (contains "offline_records" in name).
 * Returns plain objects that can be uploaded directly to Firestore.
 */
const readOfflineRecordsFromIndexedDB = (dbName) => new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => resolve([]);
    req.onsuccess = (e) => {
        const db = e.target.result;
        const storeNames = Array.from(db.objectStoreNames);
        // Find any store with "offline_records" in name
        const targetStore = storeNames.find(s => s.includes('offline_records'));
        if (!targetStore) { db.close(); resolve([]); return; }
        try {
            const tx = db.transaction(targetStore, 'readonly');
            const store = tx.objectStore(targetStore);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
                db.close();
                const raw = getAllReq.result || [];
                // RxDB Dexie storage wraps docs in { _data: {...}, _deleted: bool }
                // Try to extract the actual document
                const docs = raw
                    .filter(r => r && !r._deleted)
                    .map(r => {
                        const doc = r._data || r; // unwrap RxDB internal format if present
                        // Must have an id and collectionName to be valid
                        if (!doc.id || !doc.collectionName) return null;
                        return doc;
                    })
                    .filter(Boolean);
                resolve(docs);
            };
            getAllReq.onerror = () => { db.close(); resolve([]); };
        } catch (err) { db.close(); resolve([]); }
    };
});

// Map of active sync AbortControllers for graceful cancellation & rollback
const activeSyncAbortControllers = new Map();

/**
 * Abort/Cancel a sync in progress for a company and revert any uploaded records from Firebase.
 */
export const abortCompanySync = async (companyId) => {
    console.log(`[LIVE] Requesting abort for company: ${companyId}`);
    const controller = activeSyncAbortControllers.get(companyId);
    if (controller) {
        controller.abort();
        activeSyncAbortControllers.delete(companyId);
    }
    // Revert partial uploads from Firebase so cloud doesn't have partial/corrupted data
    try {
        await removeCompanyFromFirebase(companyId);
    } catch (e) {
        console.warn('[LIVE] Error removing cloud records during revert:', e);
    }
    // Stop local live sync & scheduler
    try {
        stopLiveSync(companyId);
        stopCompanySyncScheduler(companyId);
    } catch (e) {}
    return { success: true };
};

/**
 * Make a company live:
 *  1. Authenticates with Firebase
 *  2. Uploads ALL local records strictly for this company ONLY (no fallback to other DBs!)
 *  3. Creates / updates the nadtally_live_registry document
 *  4. Marks the company isLive:true in local master DB
 *
 * @param {string} companyId
 * @param {string} companyName
 * @param {function} onProgress  optional (uploadedCount, totalCount) => void
 * @returns {{ success: boolean, uploaded?: number, error?: string }}
 */
export const makeCompanyLive = async (companyId, companyName, onProgress, knownStats = null) => {
    const abortController = new AbortController();
    activeSyncAbortControllers.set(companyId, abortController);
    const signal = abortController.signal;

    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');

        const master = await getMasterDB();
        const existing = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!existing) return { success: false, error: 'Company not found in local registry' };

        // --- Step 1: Get records STRICTLY from this company's database ONLY ---
        // NEVER fall back to another company's DB or master DB. If this company has 0 records,
        // it is a brand new empty company and MUST stay 0!
        let allDocs = [];
        try {
            const companyDb = await getCompanyDB(companyId);
            if (companyDb && companyDb.offline_records) {
                const companyDocs = await companyDb.offline_records.find().exec();
                if (companyDocs && companyDocs.length > 0) {
                    allDocs = companyDocs;
                    console.log(`[LIVE] Using getCompanyDB(${companyId}): found ${companyDocs.length} records.`);
                }
            }
        } catch (e) {
            console.warn('[LIVE] getCompanyDB() read failed:', e);
        }

        const totalCount = allDocs.length;
        console.log(`[LIVE] Found ${totalCount} records in local RxDB for companyId: ${companyId}`);

        // Define collection categories for accurate stats reporting
        const ledgerCols = ['parties', 'accounts', 'expenses', 'income_accounts', 'capital_accounts', 'asset_accounts', 'ledgers'];
        const voucherCols = ['invoices', 'payments', 'journal_vouchers', 'stock_journals', 'vouchers'];

        // Calculate detailed stats strictly from this company's scanned records
        const scannedStats = {
            ledgers: allDocs.filter(d => ledgerCols.includes(d.collectionName)).length,
            vouchers: allDocs.filter(d => voucherCols.includes(d.collectionName)).length,
            logs: allDocs.filter(d => d.collectionName === 'audit_logs' || d.collectionName === 'system_logs').length,
            records: totalCount,
            lastSyncedAt: Date.now()
        };

        const stats = {
            ledgers: scannedStats.ledgers,
            vouchers: scannedStats.vouchers,
            logs: scannedStats.logs,
            records: totalCount,
            lastSyncedAt: Date.now()
        };

        console.log(`[LIVE] Stats for '${companyName}': final=${JSON.stringify(stats)}`);

        // Empty company handling (e.g. 0 meters unused new company)
        if (totalCount === 0) {
            console.log(`[LIVE] Company ${companyId} is empty (0 records). Registering live company with 0 records.`);
            // Register in Firestore registry with 0 stats
            await registerCompanyAsLiveInFirestore(companyId, companyName, stats);

            // Mark isLive: true in local master DB
            try {
                const existingSettings = existing.toJSON().settings || {};
                await existing.incrementalPatch({
                    settings: {
                        ...existingSettings,
                        isLive: true,
                        backgroundSyncEnabled: existingSettings.backgroundSyncEnabled ?? true
                    }
                });
            } catch (patchErr) {
                try { await setCompanyLiveStatus(companyId, true); } catch (e2) {}
            }

            if (onProgress) onProgress(0, 0, { ledgers: 0, totalLedgers: 0, vouchers: 0, totalVouchers: 0 });
            activeSyncAbortControllers.delete(companyId);
            return { success: true, uploaded: 0 };
        }

        // --- Step 2: batch-upload to companies_live/{companyId}/records ---
        const liveCollectionPath = `companies_live/${companyId}/records`;
        let batch = writeBatch(realFirestore);
        let batchCount = 0;
        let uploaded = 0;
        let uploadedLedgers = 0;
        let uploadedVouchers = 0;

        for (const rxdoc of allDocs) {
            if (signal.aborted) {
                console.warn(`[LIVE] Sync aborted by user for ${companyId}, cleaning up Firebase...`);
                await removeCompanyFromFirebase(companyId);
                activeSyncAbortControllers.delete(companyId);
                return { success: false, aborted: true, error: 'Sync stopped and reverted by user' };
            }

            const rxJson = typeof rxdoc.toJSON === 'function' ? rxdoc.toJSON() : rxdoc;
            const safeData = JSON.parse(JSON.stringify(rxJson));
            const colName = rxJson.collectionName;

            if (ledgerCols.includes(colName)) uploadedLedgers++;
            else if (voucherCols.includes(colName)) uploadedVouchers++;

            if (!safeData.timestamp) safeData.timestamp = Date.now();
            
            batch.set(
                doc(realFirestore, liveCollectionPath, safeData.id),
                { ...safeData, syncTimestamp: Date.now() },
                { merge: true }
            );
            batchCount++;
            uploaded++;

            if (batchCount >= 200) {
                await batch.commit();
                if (signal.aborted) {
                    console.warn(`[LIVE] Sync aborted by user for ${companyId}, cleaning up Firebase...`);
                    await removeCompanyFromFirebase(companyId);
                    activeSyncAbortControllers.delete(companyId);
                    return { success: false, aborted: true, error: 'Sync stopped and reverted by user' };
                }
                // Small delay between batches to avoid Firebase "write stream exhausted" error
                await new Promise(resolve => setTimeout(resolve, 150));
                batch = writeBatch(realFirestore);
                batchCount = 0;
                if (onProgress) onProgress(uploaded, totalCount, {
                    ledgers: uploadedLedgers,
                    totalLedgers: stats.ledgers,
                    vouchers: uploadedVouchers,
                    totalVouchers: stats.vouchers
                });
            }
        }
        if (batchCount > 0) {
            await batch.commit();
            if (signal.aborted) {
                console.warn(`[LIVE] Sync aborted by user for ${companyId}, cleaning up Firebase...`);
                await removeCompanyFromFirebase(companyId);
                activeSyncAbortControllers.delete(companyId);
                return { success: false, aborted: true, error: 'Sync stopped and reverted by user' };
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // Signal 100% complete
        if (onProgress) onProgress(totalCount, totalCount, {
            ledgers: stats.ledgers,
            totalLedgers: stats.ledgers,
            vouchers: stats.vouchers,
            totalVouchers: stats.vouchers
        });
        console.log(`[LIVE] Upload complete: ${uploaded} records pushed to Firebase.`);

        // --- Step 3: register in nadtally_live_registry ---
        await registerCompanyAsLiveInFirestore(companyId, companyName, stats);

        // --- Step 4: mark isLive in local master DB ---
        try {
            const existingSettings = existing.toJSON().settings || {};
            await existing.incrementalPatch({
                settings: {
                    ...existingSettings,
                    isLive: true,
                    backgroundSyncEnabled: existingSettings.backgroundSyncEnabled ?? true
                }
            });
        } catch (patchErr) {
            try { await setCompanyLiveStatus(companyId, true); } catch (e2) {}
        }

        // Fire-and-forget: update lastSync on local records in background.
        const now = Date.now();
        Promise.allSettled(
            allDocs
                .filter(rxdoc => typeof rxdoc.incrementalPatch === 'function')
                .map(rxdoc => rxdoc.incrementalPatch({ lastSync: now }).catch(() => {}))
        ).then(() => {
            console.log(`[LIVE] Background lastSync patch complete for ${companyId}.`);
        });

        activeSyncAbortControllers.delete(companyId);
        return { success: true, uploaded };
    } catch (e) {
        activeSyncAbortControllers.delete(companyId);
        console.error('[LIVE] makeCompanyLive error:', e);
        return { success: false, error: e.message };
    }
};

export const registerCompanyAsLiveInFirestore = async (companyId, companyName, stats) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error("realFirestore not initialized");
        
        const license = window.accproLicense;
        const registryRef = doc(realFirestore, 'nadtally_live_registry', companyId);
        const normalizedFromArg = typeof companyName === 'string' ? companyName.trim() : '';
        let resolvedName = normalizedFromArg;

        // Fallback 1: existing registry name (prevents accidental overwrite with blank/undefined)
        if (!resolvedName) {
            try {
                const existingRegistry = await getDoc(registryRef);
                const existingName = existingRegistry.exists() ? existingRegistry.data()?.name : '';
                if (typeof existingName === 'string' && existingName.trim()) {
                    resolvedName = existingName.trim();
                }
            } catch (e) {
                console.warn('[LIVE] Could not read existing registry name fallback:', e);
            }
        }

        // Fallback 2: local master registry name
        if (!resolvedName) {
            try {
                const master = await getMasterDB();
                const localCompany = await master.companies.findOne({ selector: { id: companyId } }).exec();
                const localName = localCompany?.name;
                if (typeof localName === 'string' && localName.trim()) {
                    resolvedName = localName.trim();
                }
            } catch (e) {
                console.warn('[LIVE] Could not read local master name fallback:', e);
            }
        }

        if (!resolvedName) resolvedName = 'Untitled Company';

        try {
            const master = await getMasterDB();
            const localCo = await master.companies.findOne({ selector: { id: companyId } }).exec();
            if (localCo && license?.email) {
                const creator = (localCo.createdBy || '').toLowerCase();
                // Prevent hijacking: don't sync to cloud if it explicitly belongs to someone else
                if (creator && creator !== 'unknown' && creator !== license.email.toLowerCase()) {
                    console.warn(`[LIVE] Aborting registry update for ${companyId}: Not owned by current user.`);
                    return; 
                }
            }
        } catch(e) {}

        const data = {
            id: companyId,
            name: resolvedName,
            isLive: true,
            registeredAt: Date.now(),
            lastUpdated: Date.now(),
            ownerEmail: license?.email || 'N/A',
            licenseKey: license?.serialKey || 'N/A',
            deviceId: localStorage.getItem('nadtally_device_id') || 'UNKNOWN'
        };
        if (stats) data.stats = stats;
        
        try {
            await setDoc(registryRef, data, { merge: true });
            console.log(`[LIVE] Successfully registered/updated company '${resolvedName}' in 'nadtally_live_registry'.`);
        } catch (setErr) {
            console.error(`[LIVE] CRITICAL: Failed to write to 'nadtally_live_registry'.`, setErr);
        }

        // Keep local master registry aligned with cloud-visible name.
        try {
            const master = await getMasterDB();
            const localCompany = await master.companies.findOne({ selector: { id: companyId } }).exec();
            if (localCompany && localCompany.name !== resolvedName) {
                await localCompany.patch({ name: resolvedName });
            }
        } catch (e) {
            console.warn('[LIVE] Could not sync local master company name:', e);
        }

        console.log(`[LIVE] Registered/Updated company '${resolvedName}' (${companyId}) in live registry.`);
    } catch (e) {
        console.error("[LIVE] Failed to register company in Firebase registry:", e);
    }
};

/**
 * Remove a company from Firebase:
 *  - Deletes all records in companies_live/{companyId}/records
 *  - Deletes the registry document in nadtally_live_registry
 */
export const removeCompanyFromFirebase = async (companyId) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');

        // Delete all synced records in batches
        const liveCollectionPath = `companies_live/${companyId}/records`;
        const snap = await getDocs(collection(realFirestore, liveCollectionPath));
        let batch = writeBatch(realFirestore);
        let count = 0;
        for (const docSnap of snap.docs) {
            batch.delete(docSnap.ref);
            count++;
            if (count >= 400) {
                await batch.commit();
                batch = writeBatch(realFirestore);
                count = 0;
            }
        }
        if (count > 0) await batch.commit();

        // Delete the registry entry
        await deleteDoc(doc(realFirestore, 'nadtally_live_registry', companyId));

        console.log(`[LIVE] Removed company ${companyId} from Firebase (${snap.docs.length} records deleted).`);
        return { success: true, deleted: snap.docs.length };
    } catch (e) {
        console.error('[LIVE] removeCompanyFromFirebase error:', e);
        return { success: false, error: e.message };
    }
};

/**
 * Exports a full JSON backup of a company directly from its Cloud Firestore records
 * and triggers a browser file download.
 */
export const exportCloudCompanyFullBackup = async (companyId, companyName = '', exportedBy = '') => {
    if (!companyId) throw new Error('exportCloudCompanyFullBackup: companyId is required');
    await ensureLiveFirestoreAccess();
    if (!realFirestore) throw new Error('Firebase not initialized');

    const liveCollectionPath = `companies_live/${companyId}/records`;
    const snap = await getDocs(collection(realFirestore, liveCollectionPath));

    const dataByCollection = {};
    let totalDocs = 0;

    if (!snap.empty) {
        for (const docSnap of snap.docs) {
            const raw = docSnap.data();
            const colName = raw?.collectionName || 'unknown';
            if (!dataByCollection[colName]) dataByCollection[colName] = [];
            dataByCollection[colName].push({
                id: raw.id || docSnap.id,
                ...(raw.data || {})
            });
            totalDocs++;
        }
    } else {
        // Fallback to localDB export if Firestore collection is empty or offline
        try {
            const { exportCompanyFullBackup } = await import('./localDB.js');
            return await exportCompanyFullBackup(companyId, companyName, exportedBy);
        } catch (e) {
            console.warn('[LIVE] Local export fallback failed:', e);
        }
    }

    const collectionCounts = Object.fromEntries(
        Object.entries(dataByCollection).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
    );

    const backupData = {
        meta: {
            date: new Date().toISOString(),
            version: '3.0',
            exportedBy: exportedBy || 'cloud_backup',
            scope: 'full_system_backup',
            encrypted: false,
            ownerId: companyId,
            companyId,
            companyName: companyName || companyId,
            collectionCounts
        },
        data: dataByCollection
    };

    const safeName = String(companyName || companyId)
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || companyId;
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `nadtally_CloudBackup_${safeName}_${dateStr}.json`;

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', url);
    downloadAnchorNode.setAttribute('download', fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url);

    return {
        success: true,
        totalDocs,
        count: totalDocs,
        collectionsCount: Object.keys(dataByCollection).length,
        fileName
    };
};

/**
 * Move a cloud company to the Cloud Recycle Bin (Soft Delete).
 * Data records are preserved in companies_live/{companyId}/records.
 * Marked with autoDeleteAt for 30 days (1 month).
 */
export const moveCompanyToCloudRecycleBin = async (companyId, deletedBy = '') => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');
        const registryRef = doc(realFirestore, 'nadtally_live_registry', companyId);
        const now = Date.now();
        const autoDeleteAt = now + (30 * 24 * 60 * 60 * 1000); // 30 days
        await setDoc(registryRef, {
            inRecycleBin: true,
            deletedAt: now,
            autoDeleteAt: autoDeleteAt,
            deletedBy: deletedBy || 'Admin',
            lastUpdated: now
        }, { merge: true });

        console.log(`[LIVE] Moved company ${companyId} to Cloud Recycle Bin (auto-deletes in 30 days).`);
        return { success: true };
    } catch (e) {
        console.error('[LIVE] moveCompanyToCloudRecycleBin error:', e);
        return { success: false, error: e.message };
    }
};

/**
 * Restore a company from Cloud Recycle Bin back to active Live Cloud Data.
 */
export const restoreCompanyFromCloudRecycleBin = async (companyId) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');
        const registryRef = doc(realFirestore, 'nadtally_live_registry', companyId);
        const now = Date.now();
        await setDoc(registryRef, {
            inRecycleBin: false,
            deletedAt: null,
            autoDeleteAt: null,
            lastUpdated: now
        }, { merge: true });

        console.log(`[LIVE] Restored company ${companyId} from Cloud Recycle Bin.`);
        return { success: true };
    } catch (e) {
        console.error('[LIVE] restoreCompanyFromCloudRecycleBin error:', e);
        return { success: false, error: e.message };
    }
};

/**
 * Purge expired companies from Cloud Recycle Bin (older than 30 days).
 */
export const purgeExpiredRecycleBinCompanies = async (recycledCompanies = []) => {
    const now = Date.now();
    const expired = (recycledCompanies || []).filter(co => co?.inRecycleBin && co?.autoDeleteAt && now >= co.autoDeleteAt);
    const results = [];
    for (const co of expired) {
        try {
            console.log(`[LIVE] Auto-purging expired recycle bin company: ${co.name || co.id}`);
            const res = await removeCompanyFromFirebase(co.id);
            results.push({ id: co.id, success: res.success });
        } catch (e) {
            console.error(`[LIVE] Failed to auto-purge company ${co.id}:`, e);
        }
    }
    return results;
};

export const updateLiveCompanyStats = async (companyId, stats) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error("realFirestore not initialized");
        const registryRef = doc(realFirestore, 'nadtally_live_registry', companyId);
        await setDoc(registryRef, {
            stats,
            lastUpdated: Date.now()
        }, { merge: true });
    } catch (e) {
        console.error("[LIVE] Failed to update company stats in Firebase registry:", e);
    }
};

/**
 * Fetch all live companies from the Firebase live registry.
 * FILTERED to the current license holder — each user only sees their own companies.
 * Developer account sees all.
 */
export const fetchLiveCompaniesFromFirestore = async () => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) {
            console.error("[LIVE] realFirestore is UNDEFINED in fetchLiveCompaniesFromFirestore");
            return [];
        }
        const license = window.accproLicense;
        const isDeveloper = license?.email === 'nadeemalsaham@gmail.com';
        
        const fetchFromCollection = async (collName) => {
            const coll = collection(realFirestore, collName);
            let snap;
            if (isDeveloper) {
                snap = await getDocs(coll);
            } else if (license?.serialKey && license.serialKey !== 'DEV-SUPER-USER' && license.serialKey !== 'N/A') {
                snap = await getDocs(query(coll, where('licenseKey', '==', license.serialKey)));
            } else if (license?.email) {
                const emails = [license.email];
                if (license.email === 'guest@accpro.app') emails.push('guest@nadtally.app');
                snap = await getDocs(query(coll, where('ownerEmail', 'in', emails)));
            } else {
                return [];
            }
            return snap.docs.map(d => ({ id: d.id, ...d.data(), cloudVisible: true }));
        };

        // Try new registry first (if exists), but focus on nadtally_ registry
        const results = await fetchFromCollection('nadtally_live_registry');
        return results;
    } catch (e) {
        console.error("[LIVE] Failed to fetch live companies from Firebase:", e);
        return [];
    }
};

/**
 * Subscribe to real-time updates of the live company registry.
 * FILTERED to the current license holder — each user only sees their own companies.
 * Developer account sees all.
 * Calls callback(liveCompanies) whenever the registry changes.
 * Returns an unsubscribe function.
 */
export const subscribeLiveRegistry = (callback) => {
    try {
        let cancelled = false;
        let unsubSnapshot = () => {};

        (async () => {
            try {
                await ensureLiveFirestoreAccess();
                if (cancelled) return;
                
                if (!realFirestore) {
                    console.error("[LIVE] realFirestore is UNDEFINED in subscribeLiveRegistry");
                    callback([]);
                    return;
                }

                const license = window.accproLicense;
                const isDeveloper = license?.email === 'nadeemalsaham@gmail.com';
                
                const coll = collection(realFirestore, 'nadtally_live_registry');
                let q;
                if (isDeveloper) {
                    q = coll;
                } else if (license?.serialKey && license.serialKey !== 'DEV-SUPER-USER' && license.serialKey !== 'N/A') {
                    q = query(coll, where('licenseKey', '==', license.serialKey));
                } else if (license?.email) {
                    const emails = [license.email];
                    if (license.email === 'guest@accpro.app') emails.push('guest@nadtally.app');
                    q = query(coll, where('ownerEmail', 'in', emails));
                } else {
                    callback([]);
                    return;
                }

                unsubSnapshot = onSnapshot(q, (snap) => {
                    const companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    callback(companies);
                }, (err) => {
                    console.error("[LIVE] Live registry subscription error:", err);
                    callback([]);
                });
            } catch (e) {
                console.error('[LIVE] Failed to initialize live registry subscription:', e);
                callback([]);
            }
        })();

        return () => {
            cancelled = true;
            unsubSnapshot();
        };
    } catch (e) {
        console.error("[LIVE] Failed to subscribe to live registry:", e);
        return () => {};
    }
};

/**
 * Download a live company's data from Firebase to local RxDB.
 * Creates it in the local master DB and fetches all records from Firestore.
 * @param {string} companyId - The Firestore company ID
 * @param {string} companyName - The company name
 * @param {function} onProgress - Optional callback: (downloadedCount, totalCount) => void
 */
export const downloadLiveCompany = async (companyId, companyName, onProgress) => {
    try {
        await ensureLiveFirestoreAccess();
        console.log(`[DOWNLOAD] Starting download of company '${companyName}' (${companyId})...`);

        // 1. Register in local master DB (creates the company locally)
        const master = await getMasterDB();
        
        // Check if already exists
        const existingEntry = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!existingEntry) {
            // Create the company entry in local master with the SAME ID as Firebase
            // Include createdBy so listCompanies() filter doesn't hide it
            const currentUserEmail = (typeof window !== 'undefined' && window.accproLicense?.email)
                ? window.accproLicense.email.toLowerCase()
                : (auth.currentUser?.email || '');
            await master.companies.insert({
                id: companyId,
                name: companyName,
                createdAt: Date.now(),
                createdBy: currentUserEmail,
                settings: { isLive: true, backgroundSyncEnabled: true }
            });
            console.log(`[DOWNLOAD] Created local master entry for '${companyName}'.`);
        } else {
            // Update it to be marked as live; preserve or restore createdBy so it appears in listCompanies()
            const currentUserEmail = (typeof window !== 'undefined' && window.accproLicense?.email)
                ? window.accproLicense.email.toLowerCase()
                : (auth.currentUser?.email || existingEntry.createdBy || '');
            await existingEntry.patch({
                name: companyName || existingEntry.name,
                createdBy: existingEntry.createdBy || currentUserEmail,
                settings: {
                    ...existingEntry.settings,
                    isLive: true,
                    backgroundSyncEnabled: existingEntry.settings?.backgroundSyncEnabled ?? true
                }
            });
            console.log(`[DOWNLOAD] Updated existing local master entry for '${companyName}'.`);
        }

        // 2. Fetch all records from Firestore for this company
        const liveCollectionPath = `companies_live/${companyId}/records`;
        const recordsCollection = collection(realFirestore, liveCollectionPath);
        const snap = await getDocs(recordsCollection);
        
        const totalCount = snap.docs.length;
        console.log(`[DOWNLOAD] Found ${totalCount} records to download.`);
        
        if (totalCount === 0) {
            console.log("[DOWNLOAD] No records found in Firestore. Company is empty.");
            return { success: true, downloaded: 0 };
        }

        // 3. Switch to the company's local DB and insert the records
        // getCompanyDB auto-repairs RxDB metadata corruption internally.
        // As a last resort, delete and recreate the local DB if still unrecoverable.
        let companyDb;
        try {
            companyDb = await getCompanyDB(companyId);
        } catch (migErr) {
            console.warn('[DOWNLOAD] DB open failed after repair attempt, deleting and recreating:', migErr.message);
            clearCompanyDBCache(companyId);
            await new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(`rxdb-dexie-nadtally_company_${companyId}--0--_rxdb_internal`);
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
            });
            companyDb = await getCompanyDB(companyId);
        }

        const now = Date.now();
        let downloadedCount = 0;
        const BATCH_SIZE = 250;
        const allDocs = snap.docs.map(d => d.data());

        for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
            const batch = allDocs.slice(i, i + BATCH_SIZE);
            const toInsert = [];
            const seenIds = new Set(); // Track IDs within this batch to avoid COL22 duplicates

            const candidateIds = batch
                .filter(fsDoc => fsDoc && fsDoc.id && fsDoc.deleted !== true)
                .map(fsDoc => fsDoc.id);
            let existingDocsMap = new Map();
            if (candidateIds.length > 0) {
                try {
                    existingDocsMap = await companyDb.offline_records.findByIds(candidateIds);
                } catch (e) {
                    existingDocsMap = new Map();
                }
            }

            for (const fsDoc of batch) {
                if (!fsDoc || !fsDoc.id) continue;
                // Skip soft-deleted records — they were deleted on the originating PC
                if (fsDoc.deleted === true) continue;

                // Skip if the same ID was already queued in this batch (RxDB bulkInsert
                // throws COL22 when multiple docs share the same primary key)
                if (seenIds.has(fsDoc.id)) {
                    console.warn(`[DOWNLOAD] Skipping duplicate id '${fsDoc.id}' (${fsDoc.collectionName || 'unknown'}) within batch.`);
                    continue;
                }

                // Check if already exists in the DB via batch map
                const existing = existingDocsMap?.get ? existingDocsMap.get(fsDoc.id) : existingDocsMap?.[fsDoc.id];
                if (!existing) {
                    seenIds.add(fsDoc.id);
                    toInsert.push({
                        id: fsDoc.id,
                        collectionName: fsDoc.collectionName || 'unknown',
                        data: fsDoc.data || {},
                        timestamp: fsDoc.timestamp || Date.now(),
                        lastSync: now // Mark as synced so initial push doesn't try to re-upload them
                    });
                }
            }

            if (toInsert.length > 0) {
                // Fallback: if bulkInsert fails (e.g. unexpected duplicate), insert one by one
                try {
                    await companyDb.offline_records.bulkInsert(toInsert);
                } catch (bulkErr) {
                    console.warn('[DOWNLOAD] bulkInsert failed, falling back to individual inserts:', bulkErr.message);
                    for (const doc of toInsert) {
                        try {
                            await companyDb.offline_records.insert(doc);
                        } catch (insErr) {
                            // Likely a race / already-inserted; log and continue
                            console.warn(`[DOWNLOAD] Skipping individual insert for '${doc.id}':`, insErr.message);
                        }
                    }
                }
            }
            downloadedCount += batch.length;
            if (onProgress) onProgress(downloadedCount, totalCount);
        }

        console.log(`[DOWNLOAD] Successfully downloaded ${downloadedCount} records for '${companyName}'.`);

        // Save the highest syncTimestamp seen so startLiveSync won't replay all these
        // records on the next page load (avoids the 17k+ sequential upsert queue).
        let maxSyncTs = 0;
        for (const fsDoc of allDocs) {
            const ts = fsDoc.syncTimestamp || 0;
            if (ts > maxSyncTs) maxSyncTs = ts;
        }
        localStorage.setItem(`nadtally_last_pull_${companyId}`, String(maxSyncTs || Date.now()));

        return { success: true, downloaded: downloadedCount };
    } catch (e) {
        console.error("[DOWNLOAD] Failed to download live company:", e);
        return { success: false, error: e.message };
    }
};

/**
 * DELTA SYNC: Specifically identifies local records that are not in cloud 
 * and pushes them to Firestore. This is called during 'Refresh Hub' 
 * to ensure all records from another PC's restore are correctly uploaded.
 */
/**
 * Force full re-sync: pushes EVERY record from local IndexedDB to Firebase,
 * ignoring the lastSync flag. Use this when records are missing from QuickAccPro
 * despite being saved in the main AccountsPro app.
 */
export const forceFullResync = async (companyId, onProgress) => {
    try {
        await ensureLiveFirestoreAccess();

        const companyDb = await getCompanyDB(companyId);
        if (!companyDb) throw new Error('Could not access company database.');

        let allDocs = await companyDb.offline_records.find().exec();

        // Fallback to master DB if company DB is empty
        if (allDocs.length === 0) {
            try {
                const masterDb = await getMasterDB();
                const masterDocs = await masterDb.offline_records.find().exec();
                if (masterDocs.length > 0) allDocs = masterDocs;
            } catch (me) { /* ignore */ }
        }

        if (allDocs.length === 0) return { success: true, count: 0 };

        const liveCollectionPath = `companies_live/${companyId}/records`;
        let batch = writeBatch(realFirestore);
        let count = 0;
        let total = 0;
        const now = Date.now();

        if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('syncing', { progress: 0, total: allDocs.length });

        for (const rxdoc of allDocs) {
            const data = rxdoc.toJSON();
            const safeData = JSON.parse(JSON.stringify(data));
            if (!safeData.timestamp) safeData.timestamp = now;

            batch.set(
                doc(realFirestore, liveCollectionPath, safeData.id),
                { ...safeData, syncTimestamp: now },
                { merge: true }
            );

            count++;
            total++;

            if (count >= 400) {
                await batch.commit();
                batch = writeBatch(realFirestore);
                count = 0;
                if (onProgress) onProgress(total, allDocs.length);
                if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('syncing', { progress: total, total: allDocs.length });
                await new Promise(r => setTimeout(r, 150));
            }
        }

        if (count > 0) {
            await batch.commit();
        }

        // Update lastSync on all docs in parallel so delta sync doesn't re-push them
        await Promise.all(allDocs.map(rxdoc =>
            rxdoc.incrementalPatch({ lastSync: now }).catch(() => {})
        ));

        if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('connected');

        console.log(`[FORCE RESYNC] Pushed ${total} records for company ${companyId}.`);
        return { success: true, count: total };
    } catch (err) {
        console.error('[FORCE RESYNC] Failed:', err);
        if (window.onCloudSyncStatusChange) window.onCloudSyncStatusChange('error');
        return { success: false, error: err.message };
    }
};

export const syncCompanyDataDelta = async (companyId, onProgress) => {
    try {
        const companyDb = await getCompanyDB(companyId);
        if (!companyDb) throw new Error("Could not access company database.");

        let allDocs = await companyDb.offline_records.find().exec();

        // Fallback to master DB if company DB is empty
        if (allDocs.length === 0) {
            try {
                const masterDb = await getMasterDB();
                const masterDocs = await masterDb.offline_records.find().exec();
                if (masterDocs.length > 0) allDocs = masterDocs;
            } catch (me) { /* ignore */ }
        }
        
        // Documents that have never been synced or were modified since last sync
        const delta = allDocs.filter(d => {
            const data = d.toJSON();
            return !data.lastSync || data.lastSync < (data.timestamp || 0);
        });

        if (delta.length === 0) return { success: true, count: 0 };

        const liveCollectionPath = `companies_live/${companyId}/records`;
        let batch = writeBatch(realFirestore);
        let count = 0;
        let total = 0;
        const now = Date.now();

        for (const rxdoc of delta) {
            const data = rxdoc.toJSON();
            const safeData = JSON.parse(JSON.stringify(data));
            if (!safeData.timestamp) safeData.timestamp = now;

            batch.set(
                doc(realFirestore, liveCollectionPath, safeData.id), 
                { ...safeData, syncTimestamp: now }, 
                { merge: true }
            );

            count++;
            total++;
            if (count >= 400) {
                await batch.commit();
                batch = writeBatch(realFirestore);
                count = 0;
                if (onProgress) onProgress(total, delta.length);
            }
        }
        if (count > 0) {
            await batch.commit();
        }

        // Update local metadata in parallel to prevent re-syncing the same records
        await Promise.all(delta.map(rxdoc =>
            rxdoc.incrementalPatch({ lastSync: now }).catch(() => {})
        ));

        return { success: true, count: total };
    } catch (err) {
        console.error('[SYNC DELTA] Failed:', err);
        return { success: false, error: err.message };
    }
};
