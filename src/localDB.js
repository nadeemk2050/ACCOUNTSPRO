import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';

addRxPlugin(RxDBMigrationPlugin);
addRxPlugin(RxDBUpdatePlugin);

let masterDbPromise = null;
let companyDbPromise = null;
let currentCompanyId = (() => {
    const val = localStorage.getItem('activeCompanyId');
    if (val === 'null' || val === 'undefined') {
        localStorage.removeItem('activeCompanyId');
        return null;
    }
    return val || null;
})();

export const genericSchema = {
    version: 4,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        data: { type: 'object' },
        collectionName: { type: 'string', maxLength: 50 },
        timestamp: { type: 'number' },
        lastSync: { type: 'number' }
    },
    required: ['id', 'collectionName'],
    indexes: ['collectionName', 'lastSync']
};

const companyRegistrySchema = {
    version: 2,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        name: { type: 'string' },
        createdAt: { type: 'number' },
        createdBy: { type: 'string' },
        creationDevice: { type: 'object' },
        settings: { type: 'object' },
        history: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type: { type: 'string' }, // 'access', 'name_change'
                    userId: { type: 'string' },
                    userName: { type: 'string' },
                    date: { type: 'number' },
                    device: { type: 'object' },
                    details: { type: 'object' } // e.g. { oldName, newName }
                }
            }
        }
    },
    required: ['id', 'name']
};

const deviceNameSchema = {
    version: 0,
    primaryKey: 'hostname',
    type: 'object',
    properties: {
        hostname: { type: 'string', maxLength: 100 },
        customName: { type: 'string' }
    },
    required: ['hostname', 'customName']
};

/**
 * Repairs corrupted RxDB internal metadata by removing duplicate old-version entries.
 * Each RxDB collection stores metadata in a Dexie DB named:
 *   rxdb-dexie-{rxdbDbName}--0--_rxdb_internal
 * within a `docs` table.  Duplicate entries cause "more than one old collection meta found".
 */
const repairRxDBInternalStore = async (rxdbDbName) => {
    const internalIdbName = `rxdb-dexie-${rxdbDbName}--0--_rxdb_internal`;
    return new Promise((resolve) => {
        const openReq = indexedDB.open(internalIdbName);
        openReq.onerror = () => resolve(false);
        openReq.onsuccess = () => {
            const idb = openReq.result;
            if (!idb.objectStoreNames.contains('docs')) {
                idb.close();
                resolve(false);
                return;
            }
            try {
                const tx = idb.transaction('docs', 'readwrite');
                const store = tx.objectStore('docs');
                const getAllReq = store.getAll();
                getAllReq.onerror = () => { idb.close(); resolve(false); };
                getAllReq.onsuccess = () => {
                    const allDocs = getAllReq.result || [];
                    // Collection metadata doc IDs look like: "collection|{name}-{version}"
                    const byCollection = new Map();
                    for (const doc of allDocs) {
                        const docId = doc?.id;
                        if (typeof docId !== 'string' || !docId.startsWith('collection|')) continue;
                        const withoutCtx = docId.slice('collection|'.length); // e.g. "offline_records-1"
                        const lastDash = withoutCtx.lastIndexOf('-');
                        if (lastDash === -1) continue;
                        const colName = withoutCtx.slice(0, lastDash);
                        const version = parseInt(withoutCtx.slice(lastDash + 1), 10);
                        if (isNaN(version)) continue;
                        if (!byCollection.has(colName)) byCollection.set(colName, []);
                        byCollection.get(colName).push({ id: docId, version });
                    }
                    let deletedCount = 0;
                    for (const [colName, entries] of byCollection) {
                        if (entries.length <= 1) continue;
                        // Keep only the highest version; delete all others
                        entries.sort((a, b) => b.version - a.version);
                        for (let i = 1; i < entries.length; i++) {
                            store.delete(entries[i].id);
                            deletedCount++;
                            console.warn(`[REPAIR] Removed duplicate RxDB metadata "${colName}" v${entries[i].version} in "${rxdbDbName}"`);
                        }
                    }
                    tx.oncomplete = () => { idb.close(); resolve(deletedCount > 0); };
                    tx.onerror = () => { idb.close(); resolve(false); };
                };
            } catch (e) {
                idb.close();
                resolve(false);
            }
        };
    });
};

/**
 * Opens a RxDB database, auto-repairing internal metadata corruption if detected.
 */
const openDBWithRepair = async (dbName, createFn) => {
    try {
        return await createFn();
    } catch (e) {
        // Handle common RxDB "Closed" or "Conflict" errors during init
        if (e.message && (e.message.includes('closed') || e.code === 'DM4')) {
            console.warn(`[DB] Storage closed for "${dbName}" during init, retrying...`);
            await new Promise(r => setTimeout(r, 300));
            return await createFn();
        }
        if (e.message && e.message.includes('more than one old collection meta')) {
            console.warn(`[REPAIR] Detected RxDB metadata corruption in "${dbName}", attempting repair...`);
            const repaired = await repairRxDBInternalStore(dbName);
            if (repaired) {
                console.log(`[REPAIR] Repair successful for "${dbName}", retrying open...`);
                return await createFn();
            }
        }
        throw e;
    }
};

const withRetry = async (fn, retries = 3, delay = 500) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const isClosed = e.message?.includes('closed') || e.code === 'DM4';
            if (isClosed && i < retries - 1) {
                console.warn(`[DB] Operation failed (closed/DM4), retry ${i + 1}/${retries}...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw e;
        }
    }
    throw lastError;
};

const _masterDBCollections = {
    companies: { 
        schema: companyRegistrySchema,
        migrationStrategies: {
            1: (oldDoc) => { oldDoc.history = []; return oldDoc; },
            2: (oldDoc) => {
                if (oldDoc.history) {
                    oldDoc.history = oldDoc.history.map(h => ({ ...h, type: h.type || 'access' }));
                }
                return oldDoc;
            }
        }
    },
    device_names: { schema: deviceNameSchema },
    offline_records: { 
        schema: genericSchema,
        migrationStrategies: {
            1: (oldDoc) => { if (!oldDoc.collectionName) oldDoc.collectionName = 'unknown'; return oldDoc; },
            2: (oldDoc) => { oldDoc.lastSync = oldDoc.lastSync || 0; return oldDoc; },
            3: (oldDoc) => oldDoc,
            4: (oldDoc) => oldDoc
        }
    }
};

const _companyDBCollections = {
    offline_records: {
        schema: genericSchema,
        migrationStrategies: {
            1: (oldDoc) => { if (!oldDoc.collectionName) oldDoc.collectionName = 'unknown'; return oldDoc; },
            2: (oldDoc) => { oldDoc.lastSync = oldDoc.lastSync || 0; return oldDoc; },
            3: (oldDoc) => oldDoc,
            4: (oldDoc) => oldDoc
        }
    }
};

export const getMasterDB = async () => {
    if (!masterDbPromise) {
        masterDbPromise = openDBWithRepair('nadtally_master_db', async () => {
            const db = await createRxDatabase({
                name: 'nadtally_master_db',
                storage: getRxStorageDexie(),
                multiInstance: true,
                ignoreDuplicate: true
            });
            await db.addCollections(_masterDBCollections);
            return db;
        });
        masterDbPromise.catch(() => { masterDbPromise = null; });
    }
    return masterDbPromise;
};
if (typeof window !== 'undefined') window.getMasterDB = getMasterDB;

export const getDB = async () => {
    if (!currentCompanyId) {
        console.warn("Attempted to getDB without an active company. Returning Master DB.");
        return getMasterDB();
    }

    if (!companyDbPromise) {
        const dbName = `nadtally_company_${currentCompanyId}`;
        companyDbPromise = openDBWithRepair(dbName, async () => {
            const db = await createRxDatabase({
                name: dbName,
                storage: getRxStorageDexie(),
                multiInstance: true,
                ignoreDuplicate: true
            });
            await db.addCollections(_companyDBCollections);
            return db;
        });
        companyDbPromise.catch(() => { companyDbPromise = null; });
    }
    return companyDbPromise;
};

const companyDbCache = new Map();
export const getCompanyDB = async (companyId) => {
    if (!companyId) return getMasterDB();
    if (companyId === currentCompanyId) return getDB();

    if (!companyDbCache.has(companyId)) {
        const dbName = `nadtally_company_${companyId}`;
        const promise = openDBWithRepair(dbName, async () => {
            const db = await createRxDatabase({
                name: dbName,
                storage: getRxStorageDexie(),
                multiInstance: true,
                ignoreDuplicate: true
            });
            await db.addCollections(_companyDBCollections);
            return db;
        });
        promise.catch(() => { companyDbCache.delete(companyId); });
        companyDbCache.set(companyId, promise);
    }
    return companyDbCache.get(companyId);
};

export const clearCompanyDBCache = (companyId) => {
    if (companyId) {
        companyDbCache.delete(companyId);
    } else {
        companyDbCache.clear();
    }
};

export const setCurrentCompany = (id) => {
    if (currentCompanyId !== id) {
        currentCompanyId = id;
        localStorage.setItem('activeCompanyId', id);
        companyDbPromise = null; // Reset promise to force new DB init
        window.location.reload(); // Refresh to ensure all hooks restart with new DB
    }
};

export const getActiveCompanyId = () => currentCompanyId;

export const createCompany = async (name, user, device) => {
    const master = await getMasterDB();
    const id = (Math.random() + 1).toString(36).substring(7);
    const newCompany = {
        id,
        name,
        createdAt: Date.now(),
        createdBy: user?.email || 'Unknown',
        creationDevice: device || {},
        settings: {},
        history: []
    };
    await master.companies.insert(newCompany);
    return newCompany;
};

export const recordCompanyAccess = async (companyId, user, device) => {
    try {
        const master = await getMasterDB();
        const co = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (co) {
            const entry = {
                type: 'access',
                userId: user?.uid || 'Unknown',
                userName: user?.email || 'Guest',
                date: Date.now(),
                device: device || {}
            };
            const history = [entry, ...(co.history || [])].slice(0, 50);
            await co.incrementalPatch({ history });
        }
    } catch (e) {
        console.error("Failed to record access log", e);
    }
};

export const updateCompanyRegistryName = async (companyId, newName, user, device) => {
    try {
        const master = await getMasterDB();
        const co = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (co) {
            const oldName = co.name;
            if (oldName === newName) return true;

            const entry = {
                type: 'name_change',
                userId: user?.uid || 'Unknown',
                userName: user?.email || 'Guest',
                date: Date.now(),
                device: device || {},
                details: { oldName, newName }
            };
            
            const history = [...(co.history || [])];
            history.unshift(entry);
            if (history.length > 50) history.pop();

            await co.patch({ 
                name: newName,
                history 
            });
            return true;
        }
        return false;
    } catch (e) {
        console.error("Failed to update company name", e);
        return false;
    }
};

export const updateDeviceName = async (hostname, customName) => {
    try {
        const master = await getMasterDB();
        const existing = await master.device_names.findOne({ selector: { hostname } }).exec();
        if (existing) {
            await existing.patch({ customName });
        } else {
            await master.device_names.insert({ hostname, customName });
        }
        return true;
    } catch (e) {
        console.error("Failed to update device name", e);
        return false;
    }
};

export const getDeviceNames = async () => {
    try {
        const master = await getMasterDB();
        const results = await master.device_names.find().exec();
        return results.reduce((map, d) => {
            map[d.hostname] = d.customName;
            return map;
        }, {});
    } catch (e) {
        return {};
    }
};

export const listCompanies = async () => {
    const master = await getMasterDB();
    const results = await master.companies.find().exec();
    let comps = results.map(d => d.toJSON());
    
    // Attempt to isolate data for the current user
    const currentUserEmail = typeof window !== 'undefined' && window.accproLicense?.email 
        ? window.accproLicense.email.toLowerCase() 
        : null;
        
    if (currentUserEmail) {
        comps = comps.filter(co => {
            const creator = (co.createdBy || '').toLowerCase();
            return creator === currentUserEmail;
        });
    }

    return comps;
};

/**
 * Restores backup data directly into a specific company's offline_records DB.
 * Bypasses the rxfs.js shim entirely — data goes to the correct company
 * regardless of what currentCompanyId is at the time of restore.
 *
 * @param {string} companyId  - The company to restore into
 * @param {Object} dataByCollection - { 'parties': [...], 'invoices': [...], ... }
 * @param {string} targetUid  - The userId/ownerId to stamp on every record
 * @param {Function} [onProgress] - optional (done, total) progress callback
 */
export const restoreCompanyData = async (companyId, dataByCollection, targetUid, onProgress) => {
    if (!companyId) throw new Error('restoreCompanyData: companyId is required');
    if (!dataByCollection || typeof dataByCollection !== 'object') throw new Error('restoreCompanyData: dataByCollection must be an object');

    const db = await getCompanyDB(companyId);
    if (!db || !db.offline_records) throw new Error(`restoreCompanyData: could not open DB for company ${companyId}`);

    // Flatten all records into a single list for bulk processing
    const allRecords = [];
    for (const [colName, records] of Object.entries(dataByCollection)) {
        if (!Array.isArray(records)) continue;
        for (const record of records) {
            if (!record || typeof record !== 'object') continue;
            // Ensure every record has a proper string ID
            const rawId = record.id;
            const safeId = (typeof rawId === 'string' && rawId.trim())
                ? rawId.trim()
                : ((Math.random() + 1).toString(36).substring(2) + Date.now().toString(36));

            // Clean the data: remove the `id` key from nested data (it lives in the RxDB `id` field)
            const { id: _dropId, ...recordData } = record;
            const cleanData = {
                ...recordData,
                userId: targetUid,
            };

            allRecords.push({
                id: safeId,
                collectionName: colName,
                data: cleanData,
                timestamp: Date.now(),
                lastSync: 0,
            });
        }
    }

    const total = allRecords.length;
    if (total === 0) return { written: 0, errors: 0 };

    // Process in chunks: upsert each record (insert or patch if existing)
    const CHUNK_SIZE = 100;
    let written = 0;
    let errors = 0;

    for (let i = 0; i < allRecords.length; i += CHUNK_SIZE) {
        const chunk = allRecords.slice(i, i + CHUNK_SIZE);
        const ids = chunk.map(r => r.id);

        // Find which IDs already exist
        const existingDocs = await db.offline_records.findByIds(ids);

        for (const rec of chunk) {
            try {
                const existing = existingDocs.get ? existingDocs.get(rec.id) : existingDocs[rec.id];
                if (existing) {
                    await existing.patch({ data: rec.data, collectionName: rec.collectionName, timestamp: rec.timestamp });
                } else {
                    await db.offline_records.insert(rec);
                }
                written++;
            } catch (e) {
                console.warn(`[restoreCompanyData] Failed to upsert record ${rec.id} in ${rec.collectionName}:`, e.message);
                errors++;
            }
        }

        if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, total), total);
    }

    console.log(`[restoreCompanyData] Done: ${written} written, ${errors} errors for company ${companyId}`);
    return { written, errors };
};

export const importJSONBackup = async (jsonData, isEncrypted = false, password = '') => {
    try {
        let parsedData = jsonData;
        if (isEncrypted) throw new Error("Decryption logic needs integration.");

        if (typeof parsedData === 'string') parsedData = JSON.parse(parsedData);

        const db = await getDB();
        const bulkDocs = [];
        for (const [colName, docs] of Object.entries(parsedData)) {
            for (const doc of docs) {
                bulkDocs.push({
                    id: doc.id || (Math.random() + 1).toString(36).substring(7),
                    collectionName: colName,
                    data: doc,
                    timestamp: Date.now()
                });
            }
        }
        await db.offline_records.bulkInsert(bulkDocs);
        console.log("Offline backup imported successfully!");
        return true;
    } catch (err) {
        console.error("Failed to import JSON backup:", err);
        return false;
    }
};
/**
 * Save computed stats to localStorage (avoids RxDB BroadcastChannel serialization issues).
 */
export const saveCachedCompanyStats = (companyId, stats) => {
    if (!companyId || !stats) return;
    try {
        localStorage.setItem(`accpro_stats_${companyId}`, JSON.stringify({
            ledgers: stats.ledgers || 0,
            vouchers: stats.vouchers || 0,
            logs: stats.logs || 0,
            savedAt: Date.now()
        }));
    } catch (e) {
        console.warn('[DB] saveCachedCompanyStats failed:', e);
    }
};

export const getCompanyStats = async (companyId) => {
    // 1. Try the fast localStorage cache first (avoids slow RxDB full scan)
    try {
        const raw = localStorage.getItem(`accpro_stats_${companyId}`);
        if (raw) {
            const cached = JSON.parse(raw);
            if (cached && cached.savedAt && (Date.now() - cached.savedAt < 300000)) {
                return { ledgers: cached.ledgers || 0, vouchers: cached.vouchers || 0, logs: cached.logs || 0, companyId, fromCache: true };
            }
        }
    } catch (e) { /* ignore */ }

    // 2. Scan company-specific DB
    const ledgerCols = ['parties', 'accounts', 'expenses', 'income_accounts', 'capital_accounts', 'asset_accounts', 'ledgers'];
    const voucherCols = ['invoices', 'payments', 'journal_vouchers', 'stock_journals', 'vouchers'];

    const countDocs = (docs) => {
        let ledgers = 0, vouchers = 0, logs = 0;
        docs.forEach(doc => {
            const col = doc.collectionName;
            if (ledgerCols.includes(col)) ledgers++;
            else if (voucherCols.includes(col)) vouchers++;
            else if (col === 'audit_logs' || col === 'system_logs') logs++;
        });
        return { ledgers, vouchers, logs };
    };

    try {
        const result = await withRetry(async () => {
            const db = await getCompanyDB(companyId);
            const allDocs = await db.offline_records.find().exec();
            const counts = countDocs(allDocs);

            // 3. If company DB is empty, try master DB as fallback
            // (data may have been written there before a company was selected)
            if (counts.ledgers === 0 && counts.vouchers === 0) {
                try {
                    const masterDb = await getMasterDB();
                    const masterDocs = await masterDb.offline_records.find().exec();
                    if (masterDocs.length > 0) {
                        const masterCounts = countDocs(masterDocs);
                        if (masterCounts.ledgers > 0 || masterCounts.vouchers > 0) {
                            if (masterCounts.ledgers > 0 || masterCounts.vouchers > 0) {
                                saveCachedCompanyStats(companyId, masterCounts);
                            }
                            return { ...masterCounts, companyId, fromMaster: true };
                        }
                    }
                } catch (me) { /* ignore master DB fallback error */ }
            }

            if (counts.ledgers > 0 || counts.vouchers > 0) {
                saveCachedCompanyStats(companyId, counts);
            }
            return { ...counts, companyId };
        }, 2, 800);
        return result;
    } catch (e) {
        console.warn('[DB] getCompanyStats scan failed:', e);
        return { ledgers: 0, vouchers: 0, logs: 0, companyId };
    }
};

/**
 * Remove a company from local storage:
 *  1. Deletes the entry from the master companies registry
 *  2. Deletes the company's IndexedDB so all voucher/ledger data is erased
 */
export const removeCompanyData = async (companyId) => {
    try {
        const master = await getMasterDB();
        const co = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (co) await co.remove();

        // Drop the company's IndexedDB store
        await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(`nadtally_company_${companyId}`);
            req.onsuccess = resolve;
            req.onerror = resolve;   // resolve even on error; data may not exist yet
            req.onblocked = resolve; // proceed even if another tab has it open
        });

        return true;
    } catch (e) {
        console.error('removeCompanyData error:', e);
        return false;
    }
};

export const setCompanyLiveStatus = async (companyId, isLive) => {
    try {
        const master = await getMasterDB();
        const co = await master.companies.findOne({ selector: { id: companyId } }).exec();
        if (!co) return false;

        await co.patch({
            settings: {
                ...(co.settings || {}),
                isLive: !!isLive
            }
        });
        return true;
    } catch (e) {
        console.error('setCompanyLiveStatus error:', e);
        return false;
    }
};
