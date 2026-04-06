import { db as realFirestore, auth } from './realFirebase.js';
import { getDB, getMasterDB, createCompany } from './localDB.js';
// Import directly from @firebase/* so Vite's 'firebase/firestore' → rxfs.js alias is bypassed
import { collection, doc, setDoc, onSnapshot, getDoc, writeBatch, getDocs, deleteDoc, query, where } from '@firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';


const activeSyncs = {}; // record of companyId -> unsubscribe function
let liveAuthPromise = null;

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
        const allLocalDocs = await rxdb.offline_records.find().exec();
        
        let batch = writeBatch(realFirestore);
        let count = 0;
        console.log(`[SYNC] Found ${allLocalDocs.length} local docs for company ${companyId}. Ensuring they are in Firestore.`);
        for (const rxdoc of allLocalDocs) {
            const data = rxdoc.toJSON();
            const docRef = doc(realFirestore, liveCollectionPath, data.id);
            // Ensure document has a timestamp for sync logic
            if (!data.timestamp) data.timestamp = Date.now();
            
            batch.set(docRef, {
                ...data,
                syncTimestamp: Date.now()
            }, { merge: true });
            
            count++;
            if (count > 400) {
                await batch.commit();
                batch = writeBatch(realFirestore);
                count = 0;
            }
        }
        if (count > 0) await batch.commit();

        console.log("[SYNC] Initial push complete.");

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

        // 2. Set up PULL from Firestore
        const unsubPull = onSnapshot(collection(realFirestore, liveCollectionPath), (snapshot) => {
            pullQueue = pullQueue.then(async () => {
                const changes = snapshot.docChanges();
                for (const change of changes) {
                    const fsData = change.doc.data();
                    if (change.type === 'added' || change.type === 'modified') {
                        try {
                            if (!fsData?.id) continue;
                            const existing = await rxdb.offline_records.findOne({ selector: { id: fsData.id } }).exec();
                            const localTs = Number(existing?.timestamp || 0);
                            const remoteTs = Number(fsData?.timestamp || 0);

                            // Apply incoming record only when it is newer (or equal for first insert).
                            if (!existing || localTs <= remoteTs) {
                                await rxdb.offline_records.incrementalUpsert(fsData);
                                markRemoteApplied(fsData.id);
                            }
                        } catch (e) {
                            if (!isConflictError(e)) {
                                console.error(e);
                            }
                        }
                    }
                    if (change.type === 'removed') {
                        try {
                            const existing = await rxdb.offline_records.findOne({ selector: { id: change.doc.id } }).exec();
                            if (existing) {
                                await existing.remove();
                                markRemoteApplied(change.doc.id);
                            }
                        } catch (e) {
                            if (!isConflictError(e)) {
                                console.error(e);
                            }
                        }
                    }
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
                if (!id || isPushSuppressed(id)) return;
                // Serialize to plain JSON so non-cloneable objects (Firestore Timestamps etc.) are stripped
                const data = JSON.parse(JSON.stringify(changeEvent.documentData));

                const docRef = doc(realFirestore, liveCollectionPath, id);

                if (op === 'INSERT' || op === 'UPDATE') {
                    await setDoc(docRef, { ...data, syncTimestamp: Date.now() }, { merge: true });
                } else if (op === 'DELETE') {
                    await deleteDoc(docRef).catch(e => console.warn('FS Delete error:', e));
                }
            } catch (err) {
                console.error('[SYNC] Error pushing update to Firestore:', err);
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
 *
 * @param {string} companyId
 * @param {string} companyName
 * @param {function} onProgress  optional (uploadedCount, totalCount) => void
 * @returns {{ success: boolean, uploaded?: number, error?: string }}
 */
export const makeCompanyLive = async (companyId, companyName, onProgress) => {
    try {
        await ensureLiveFirestoreAccess();
        if (!realFirestore) throw new Error('Firebase not initialized');

        const master = await getMasterDB();
        const existing = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!existing) return { success: false, error: 'Company not found in local registry' };

        // --- Step 1: open the company's IndexedDB directly ---
        const { createRxDatabase, addRxPlugin } = await import('rxdb');
        const { getRxStorageDexie } = await import('rxdb/plugins/storage-dexie');
        const { RxDBMigrationPlugin } = await import('rxdb/plugins/migration-schema');
        addRxPlugin(RxDBMigrationPlugin);

        const genericSchema = {
            version: 1,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: { type: 'string', maxLength: 100 },
                data: { type: 'object' },
                collectionName: { type: 'string', maxLength: 50 },
                timestamp: { type: 'number' }
            },
            required: ['id', 'collectionName'],
            indexes: ['collectionName']
        };

        const companyDb = await createRxDatabase({
            name: `nadtally_company_${companyId}`,
            storage: getRxStorageDexie(),
            multiInstance: false,
            ignoreDuplicate: true
        });
        await companyDb.addCollections({
            offline_records: {
                schema: genericSchema,
                migrationStrategies: { 1: (d) => { if (!d.collectionName) d.collectionName = 'unknown'; return d; } }
            }
        }).catch(() => {});

        const allDocs = await companyDb.offline_records.find().exec();
        const totalCount = allDocs.length;
        console.log(`[LIVE] Uploading ${totalCount} records for '${companyName}' (${companyId})…`);

        // Calculate detailed stats for the registry
        const stats = {
            ledgers: allDocs.filter(d => d.collectionName === 'ledgers').length,
            vouchers: allDocs.filter(d => d.collectionName === 'vouchers').length,
            logs: allDocs.filter(d => d.collectionName === 'audit_logs').length,
            records: totalCount,
            lastSyncedAt: Date.now()
        };

        // --- Step 2: batch-upload to companies_live/{companyId}/records ---
        const liveCollectionPath = `companies_live/${companyId}/records`;
        let batch = writeBatch(realFirestore);
        let batchCount = 0;
        let uploaded = 0;

        for (const rxdoc of allDocs) {
            const safeData = JSON.parse(JSON.stringify(rxdoc.toJSON()));
            if (!safeData.timestamp) safeData.timestamp = Date.now();
            batch.set(
                doc(realFirestore, liveCollectionPath, safeData.id),
                { ...safeData, syncTimestamp: Date.now() },
                { merge: true }
            );
            batchCount++;
            uploaded++;
            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(realFirestore);
                batchCount = 0;
                if (onProgress) onProgress(uploaded, totalCount);
            }
        }
        if (batchCount > 0) {
            await batch.commit();
        }
        if (onProgress) onProgress(totalCount, totalCount);
        console.log(`[LIVE] Upload complete: ${uploaded} records pushed.`);

        // --- Step 3: register in nadtally_live_registry ---
        await registerCompanyAsLiveInFirestore(companyId, companyName, stats);

        // --- Step 4: mark isLive in local master DB ---
        await existing.patch({ settings: { ...existing.settings, isLive: true } });

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
        
        const license = window.nadtallyLicense;
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
        
        await setDoc(registryRef, data, { merge: true });

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
        const license = window.nadtallyLicense;
        const isDeveloper = license?.email === 'nadeemalsaham@gmail.com';
        const registryCollection = collection(realFirestore, 'nadtally_live_registry');

        let snap;
        if (isDeveloper) {
            // Developer sees all companies
            snap = await getDocs(registryCollection);
        } else if (license?.serialKey && license.serialKey !== 'DEV-SUPER-USER') {
            // Filter by licenseKey
            const q = query(registryCollection, where('licenseKey', '==', license.serialKey));
            snap = await getDocs(q);
        } else if (license?.email) {
            // Fallback: filter by ownerEmail
            const q = query(registryCollection, where('ownerEmail', '==', license.email));
            snap = await getDocs(q);
        } else {
            // No license info — return empty
            return [];
        }

        if (!snap || snap.empty) return [];
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

                const license = window.nadtallyLicense;
                const isDeveloper = license?.email === 'nadeemalsaham@gmail.com';
                const registryCollection = collection(realFirestore, 'nadtally_live_registry');

                let registryQuery;
                if (isDeveloper) {
                    // Developer sees all companies
                    registryQuery = registryCollection;
                } else if (license?.serialKey && license.serialKey !== 'DEV-SUPER-USER') {
                    // Filter by licenseKey (most reliable)
                    registryQuery = query(registryCollection, where('licenseKey', '==', license.serialKey));
                } else if (license?.email) {
                    // Fallback: filter by ownerEmail
                    registryQuery = query(registryCollection, where('ownerEmail', '==', license.email));
                } else {
                    // No license — show nothing
                    console.warn('[LIVE] No license info found — showing no cloud companies.');
                    callback([]);
                    return;
                }

                unsubSnapshot = onSnapshot(registryQuery, (snap) => {
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
            await master.companies.insert({
                id: companyId,
                name: companyName,
                createdAt: Date.now(),
                settings: { isLive: true }
            });
            console.log(`[DOWNLOAD] Created local master entry for '${companyName}'.`);
        } else {
            // Update it to be marked as live
            await existingEntry.patch({
                name: companyName || existingEntry.name,
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
        // We need to temporarily use the company DB directly
        const { createRxDatabase, addRxPlugin } = await import('rxdb');
        const { getRxStorageDexie } = await import('rxdb/plugins/storage-dexie');
        const { RxDBMigrationPlugin } = await import('rxdb/plugins/migration-schema');

        addRxPlugin(RxDBMigrationPlugin);

        const genericSchema = {
            version: 1,
            primaryKey: 'id',
            type: 'object',
            properties: {
                id: { type: 'string', maxLength: 100 },
                data: { type: 'object' },
                collectionName: { type: 'string', maxLength: 50 },
                timestamp: { type: 'number' }
            },
            required: ['id', 'collectionName'],
            indexes: ['collectionName']
        };

        const dbName = `nadtally_company_${companyId}`;
        const companyDb = await createRxDatabase({
            name: dbName,
            storage: getRxStorageDexie(),
            multiInstance: false,
            ignoreDuplicate: true
        });
        await companyDb.addCollections({
            offline_records: {
                schema: genericSchema,
                migrationStrategies: {
                    1: function (oldDoc) {
                        if (!oldDoc.collectionName) oldDoc.collectionName = 'unknown';
                        return oldDoc;
                    }
                }
            }
        });

        let downloadedCount = 0;
        const BATCH_SIZE = 50;
        const allDocs = snap.docs.map(d => d.data());

        for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
            const batch = allDocs.slice(i, i + BATCH_SIZE);
            const toInsert = [];
            
            for (const fsDoc of batch) {
                // Check if already exists
                const existing = await companyDb.offline_records
                    .findOne({ selector: { id: fsDoc.id } }).exec();
                if (!existing) {
                    toInsert.push({
                        id: fsDoc.id,
                        collectionName: fsDoc.collectionName || 'unknown',
                        data: fsDoc.data || {},
                        timestamp: fsDoc.timestamp || Date.now()
                    });
                }
            }

            if (toInsert.length > 0) {
                await companyDb.offline_records.bulkInsert(toInsert);
            }
            downloadedCount += batch.length;
            if (onProgress) onProgress(downloadedCount, totalCount);
        }

        await companyDb.destroy();
        console.log(`[DOWNLOAD] Successfully downloaded ${downloadedCount} records for '${companyName}'.`);
        return { success: true, downloaded: downloadedCount };
    } catch (e) {
        console.error("[DOWNLOAD] Failed to download live company:", e);
        return { success: false, error: e.message };
    }
};
