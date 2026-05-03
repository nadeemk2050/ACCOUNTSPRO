import { db as realFirestore, auth } from './realFirebase.js';
import { getDB, getMasterDB, getCompanyDB, clearCompanyDBCache, genericSchema, createCompany, setCompanyLiveStatus } from './localDB.js';
import { Timestamp } from '@firebase/firestore';
// Import directly from @firebase/* so Vite's 'firebase/firestore' → rxfs.js alias is bypassed
import { collection, doc, setDoc, onSnapshot, getDoc, writeBatch, getDocs, deleteDoc, query, where } from '@firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';


const activeSyncs = {}; // record of companyId -> unsubscribe function
let liveAuthPromise = null;

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
                    
                    // ✅ UPDATE LOCAL RxDB with lastSync timestamp
                    const now = Date.now();
                    for (const syncedDoc of currentBatchDocs) {
                        try { await syncedDoc.incrementalPatch({ lastSync: now }); } catch(e) {}
                    }

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
                for (const syncedDoc of currentBatchDocs) {
                    try { await syncedDoc.incrementalPatch({ lastSync: now }); } catch(e) {}
                }
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

        const unsubPull = onSnapshot(pullQuery, (snapshot) => {
            pullQueue = pullQueue.then(async () => {
                const changes = snapshot.docChanges();
                if (changes.length === 0) return;

                console.log(`[SYNC] Pulling ${changes.length} remote changes.`);

                for (const change of changes) {
                    // Sanitize raw Firestore data — Firestore Timestamp objects are not
                    // structured-clone-able and cause BroadcastChannel DataCloneErrors in RxDB.
                    const fsData = JSON.parse(JSON.stringify(change.doc.data()));
                    const remoteTs = fsData.syncTimestamp || 0;
                    if (remoteTs > maxSeenSyncTs) maxSeenSyncTs = remoteTs;

                    if (change.type === 'added' || change.type === 'modified') {
                        try {
                            if (!fsData?.id) continue;

                            // Handle soft-delete: this record was deleted on another PC.
                            if (fsData.deleted === true) {
                                const toRemove = await rxdb.offline_records.findOne({ selector: { id: fsData.id } }).exec();
                                if (toRemove) {
                                    markRemoteApplied(fsData.id);
                                    await toRemove.remove();
                                }
                                continue;
                            }

                            const existing = await rxdb.offline_records.findOne({ selector: { id: fsData.id } }).exec();
                            const localTs = Number(existing?.timestamp || 0);
                            const remoteDataTs = Number(fsData?.timestamp || 0);

                            // Apply incoming record only when it is newer (or equal for first insert).
                            if (!existing || localTs <= remoteDataTs) {
                                markRemoteApplied(fsData.id); // Mark BEFORE write to ensure suppression
                                await rxdb.offline_records.incrementalUpsert(wash({
                                    ...fsData,
                                    lastSync: remoteTs
                                }));
                            }
                        } catch (e) {
                            if (!isConflictError(e)) {
                                console.error(e);
                            }
                        }
                    }
                    // NOTE: change.type === 'removed' is intentionally NOT handled here.
                    // Hard-deletes from Firestore (e.g. removeCompanyFromFirebase) must NOT
                    // cascade to local RxDB deletion — local data is the source of truth.
                    // Cross-PC deletions are handled via soft-delete (fsData.deleted === true)
                    // which is already processed in the 'added'/'modified' block above.
                }
                
                // Update local storage so we don't pull these again next time
                if (maxSeenSyncTs > lastPullTsFromStorage) {
                    localStorage.setItem(lastPullKey, String(maxSeenSyncTs));
                }
            }).catch((e) => {
                console.error('[SYNC] Pull queue error:', e);
            });
        });

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

        activeSyncs[companyId] = () => {
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

/**
 * Make a company live:
 *  1. Authenticates with Firebase
 *  2. Uploads ALL local records for the company in batches
 *  3. Creates / updates the nadtally_live_registry document
 *  4. Marks the company isLive:true in local master DB
 *
 * @param {string} companyId
 * @param {string} companyName
 * @param {function} onProgress  optional (uploadedCount, totalCount) => void
 * @returns {{ success: boolean, uploaded?: number, error?: string }}
 */
export const makeCompanyLive = async (companyId, companyName, onProgress, knownStats = null) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');

        const master = await getMasterDB();
        const existing = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!existing) return { success: false, error: 'Company not found in local registry' };

        // --- Step 1: Get all records from local IndexedDB ---
        // Priority order:
        //   1. getCompanyDB(companyId) — explicitly opens the target company's DB by name
        //      (when companyId === currentCompanyId this returns getDB(), same instance)
        //   2. getDB() — the shared company DB instance used by rxfs.js (fallback if same company)
        //   3. getMasterDB() — fallback for data written before a company was selected
        let allDocs = [];

        // Try companyDB first — this explicitly targets the correct company regardless of
        // what currentCompanyId happens to be at call time.
        try {
            const companyDb = await getCompanyDB(companyId);
            if (companyDb && companyDb.offline_records) {
                const companyDocs = await companyDb.offline_records.find().exec();
                if (companyDocs.length > 0) {
                    allDocs = companyDocs;
                    console.log(`[LIVE] Using getCompanyDB(${companyId}): found ${companyDocs.length} records.`);
                }
            }
        } catch (e) { console.warn('[LIVE] getCompanyDB() read failed:', e); }

        // If companyDB was empty (or companyId !== currentCompanyId), also try the active getDB()
        if (allDocs.length === 0) {
            try {
                const activeDb = await getDB();
                if (activeDb && activeDb.offline_records) {
                    const activeDocs = await activeDb.offline_records.find().exec();
                    if (activeDocs.length > 0) {
                        allDocs = activeDocs;
                        console.log(`[LIVE] Using active getDB() instance: found ${activeDocs.length} records.`);
                    }
                }
            } catch (e) { console.warn('[LIVE] getDB() read failed:', e); }
        }

        // Last resort: master DB offline_records
        if (allDocs.length === 0) {
            console.warn(`[LIVE] Company DB empty for ${companyId}, checking master DB offline_records as fallback...`);
            try {
                const masterDb = await getMasterDB();
                const masterDocs = await masterDb.offline_records.find().exec();
                if (masterDocs.length > 0) {
                    allDocs = masterDocs;
                    console.log(`[LIVE] Using master DB fallback: found ${masterDocs.length} records.`);
                }
            } catch (me) { console.warn('[LIVE] Master DB fallback failed:', me); }
        }

        // Nuclear fallback: scan ALL IndexedDB databases directly, bypassing RxDB entirely.
        // This recovers data that RxDB's query layer cannot find due to schema/migration issues.
        if (allDocs.length === 0) {
            console.warn('[LIVE] All RxDB reads returned 0. Attempting raw IndexedDB scan...');
            try {
                const rawDocs = await scanAllIndexedDBForOfflineRecords(companyId);
                if (rawDocs.length > 0) {
                    allDocs = rawDocs; // these are plain objects, not RxDB docs
                    console.log(`[LIVE] Raw IndexedDB scan found ${rawDocs.length} records.`);
                }
            } catch (re) { console.warn('[LIVE] Raw IndexedDB scan failed:', re); }
        }
        const totalCount = allDocs.length;
        console.log(`[LIVE] Found ${totalCount} records in local RxDB for companyId: ${companyId}`);

        // Define collection categories for accurate stats reporting
        const ledgerCols = ['parties', 'accounts', 'expenses', 'income_accounts', 'capital_accounts', 'asset_accounts', 'ledgers'];
        const voucherCols = ['invoices', 'payments', 'journal_vouchers', 'stock_journals', 'vouchers'];

        // Calculate detailed stats from DB scan
        const scannedStats = {
            ledgers: allDocs.filter(d => ledgerCols.includes(d.collectionName)).length,
            vouchers: allDocs.filter(d => voucherCols.includes(d.collectionName)).length,
            logs: allDocs.filter(d => d.collectionName === 'audit_logs' || d.collectionName === 'system_logs').length,
            records: totalCount,
            lastSyncedAt: Date.now()
        };

        // Use knownStats (from in-memory React state) when provided and DB scan shows less —
        // this ensures the Firebase registry always reflects the true data counts.
        const stats = {
            ledgers: knownStats ? Math.max(knownStats.ledgers || 0, scannedStats.ledgers) : scannedStats.ledgers,
            vouchers: knownStats ? Math.max(knownStats.vouchers || 0, scannedStats.vouchers) : scannedStats.vouchers,
            logs: knownStats ? Math.max(knownStats.logs || 0, scannedStats.logs) : scannedStats.logs,
            records: totalCount,
            lastSyncedAt: Date.now()
        };

        console.log(`[LIVE] Stats for '${companyName}': scanned=${JSON.stringify(scannedStats)}, final=${JSON.stringify(stats)}`);

        if (totalCount === 0) {
            console.warn(`[LIVE] WARNING: No records found for company ${companyId}. Registry will be updated but no data pushed.`);
        }

        // --- Step 2: batch-upload to companies_live/{companyId}/records ---
        const liveCollectionPath = `companies_live/${companyId}/records`;
        let batch = writeBatch(realFirestore);
        let batchCount = 0;
        let uploaded = 0;
        let uploadedLedgers = 0;
        let uploadedVouchers = 0;

        for (const rxdoc of allDocs) {
            // Support both RxDB doc objects (have .toJSON()) and plain objects (from raw IDB scan)
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
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // ✅ Signal 100% complete IMMEDIATELY after all Firebase batches are done.
        // Do NOT wait for the incrementalPatch loop below — it can take minutes for
        // large datasets (12000+ records × await per patch = very long freeze).
        if (onProgress) onProgress(totalCount, totalCount, {
            ledgers: stats.ledgers,
            totalLedgers: stats.ledgers,
            vouchers: stats.vouchers,
            totalVouchers: stats.vouchers
        });
        console.log(`[LIVE] Upload complete: ${uploaded} records pushed to Firebase.`);

        // --- Step 3: register in nadtally_live_registry (do this BEFORE patch loop) ---
        await registerCompanyAsLiveInFirestore(companyId, companyName, stats);

        // --- Step 4: mark isLive in local master DB ---
        try {
            const existingSettings = existing.toJSON().settings || {};
            await existing.incrementalPatch({ settings: { ...existingSettings, isLive: true } });
        } catch (patchErr) {
            try { await setCompanyLiveStatus(companyId, true); } catch (e2) { /* best effort */ }
        }

        // Fire-and-forget: update lastSync on local records in background.
        // We intentionally do NOT await this — it is a performance hint only and
        // should not block or delay the completion signal shown to the user.
        const now = Date.now();
        Promise.allSettled(
            allDocs
                .filter(rxdoc => typeof rxdoc.incrementalPatch === 'function')
                .map(rxdoc => rxdoc.incrementalPatch({ lastSync: now }).catch(() => {}))
        ).then(() => {
            console.log(`[LIVE] Background lastSync patch complete for ${companyId}.`);
        });

        return { success: true, uploaded };
    } catch (e) {
        console.error('[LIVE] makeCompanyLive error:', e);
        return { success: false, error: e.message };
    }
};

/**
 * Register a company in the Firebase live registry.
 * This allows other PCs to discover this company in the "LIVE DATAS" section.
 */
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
                settings: { isLive: true }
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
                    isLive: true
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
        const BATCH_SIZE = 50;
        const allDocs = snap.docs.map(d => d.data());

        for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
            const batch = allDocs.slice(i, i + BATCH_SIZE);
            const toInsert = [];
            
            for (const fsDoc of batch) {
                // Skip soft-deleted records — they were deleted on the originating PC
                if (fsDoc.deleted === true) continue;

                // Check if already exists
                const existing = await companyDb.offline_records
                    .findOne({ selector: { id: fsDoc.id } }).exec();
                if (!existing) {
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
                await companyDb.offline_records.bulkInsert(toInsert);
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

        // Update local metadata to prevent re-syncing the same records
        for (const rxdoc of delta) {
            try { await rxdoc.incrementalPatch({ lastSync: now }); } catch(e) {}
        }

        return { success: true, count: total };
    } catch (err) {
        console.error('[SYNC DELTA] Failed:', err);
        return { success: false, error: err.message };
    }
};
