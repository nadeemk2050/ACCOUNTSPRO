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

export const getMasterDB = async () => {
    if (!masterDbPromise) {
        masterDbPromise = (async () => {
            const db = await createRxDatabase({
                name: 'nadtally_master_db',
                storage: getRxStorageDexie(),
                multiInstance: false,
                ignoreDuplicate: true
            });
            await db.addCollections({
                companies: { 
                    schema: companyRegistrySchema,
                    migrationStrategies: {
                        1: (oldDoc) => {
                            oldDoc.history = [];
                            return oldDoc;
                        },
                        2: (oldDoc) => {
                            if (oldDoc.history) {
                                oldDoc.history = oldDoc.history.map(h => ({
                                    ...h,
                                    type: h.type || 'access'
                                }));
                            }
                            return oldDoc;
                        }
                    }
                },
                device_names: { schema: deviceNameSchema },
                offline_records: { schema: genericSchema }
            });
            return db;
        })();
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
        companyDbPromise = (async () => {
            const dbName = `nadtally_company_${currentCompanyId}`;
            const db = await createRxDatabase({
                name: dbName,
                storage: getRxStorageDexie(),
                multiInstance: false,
                ignoreDuplicate: true
            });
            await db.addCollections({
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
            return db;
        })();
    }
    return companyDbPromise;
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
    const currentUserEmail = typeof window !== 'undefined' && window.nadtallyLicense?.email 
        ? window.nadtallyLicense.email.toLowerCase() 
        : null;
        
    if (currentUserEmail) {
        comps = comps.filter(co => {
            const creator = (co.createdBy || '').toLowerCase();
            return creator === currentUserEmail;
        });
    }

    return comps;
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
export const getCompanyStats = async (companyId) => {
    try {
        const dbName = `nadtally_company_${companyId}`;
        const db = await createRxDatabase({
            name: dbName,
            storage: getRxStorageDexie(),
            multiInstance: false,
            ignoreDuplicate: true
        });

        await db.addCollections({
            offline_records: {
                schema: genericSchema,
                migrationStrategies: {
                    1: function (oldDoc) {
                        if (!oldDoc.collectionName) oldDoc.collectionName = 'unknown';
                        return oldDoc;
                    }
                }
            }
        }).catch(() => { });

        const allDocs = await db.offline_records.find().exec();

        const ledgerCols = ['parties', 'accounts', 'expenses', 'income_accounts', 'capital_accounts', 'asset_accounts'];
        const voucherCols = ['invoices', 'payments', 'journal_vouchers', 'stock_journals'];

        let ledgers = 0;
        let vouchers = 0;
        let logs = 0;

        allDocs.forEach(doc => {
            const col = doc.collectionName;
            if (ledgerCols.includes(col)) ledgers++;
            else if (voucherCols.includes(col)) vouchers++;
            else if (col === 'audit_logs') logs++;
        });

        if (companyId !== getActiveCompanyId()) {
            await db.destroy();
        }

        return { ledgers, vouchers, logs };
    } catch (e) {
        console.error("Stats error for", companyId, e);
        return { ledgers: 0, vouchers: 0, logs: 0 };
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
