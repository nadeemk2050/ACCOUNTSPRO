import { v4 as uuidv4 } from 'uuid';
import { getDB, getActiveCompanyId } from './localDB';
import { sqlite, isSqliteAvailable } from './sqliteBridge';

export const getFirestore = () => ({});
export const initializeFirestore = (app, settings) => ({});
export const memoryLocalCache = () => ({});
export const persistentLocalCache = (settings) => ({});
export const persistentMultipleTabManager = () => ({});

export const collection = (db, path) => {
    return { path, type: 'collection' };
};

export const doc = (db, path, id) => {
    if (db && db.type === 'collection') {
        const autoId = path || id || uuidv4();
        return { path: `${db.path}/${autoId}`, type: 'doc' };
    }
    const safePath = path || uuidv4();
    return { path: id ? `${safePath}/${id}` : safePath, type: 'doc' };
};

export class Timestamp {
    constructor(seconds, nanoseconds) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds || 0;
    }
    static now() {
        return new Timestamp(Math.floor(Date.now() / 1000), 0);
    }
    toDate() {
        return new Date(this.seconds * 1000);
    }
}

export const serverTimestamp = () => {
    return { type: 'serverTimestamp' };
};

export const deleteField = () => {
    return undefined; // Handled specially in updates
};

export const documentId = () => '__name__';

export const startAfter = (val) => {
    return { type: 'startAfter', val };
};

export const sum = (f) => ({ aggregate: 'sum', field: f });
export const count = () => ({ aggregate: 'count' });

export const getCountFromServer = async (q) => {
    // Fake count
    return { data: () => ({ count: 0 }) };
};

export const getAggregateFromServer = async (q, aggregates) => {
    return { data: () => ({}) };
};

export const query = (col, ...constraints) => {
    return { ...col, constraints };
};

export const where = (field, op, value) => {
    return { type: 'where', field, op, value };
};

export const orderBy = (field, dir = 'asc') => {
    return { type: 'orderBy', field, dir };
};

export const limit = (num) => {
    return { type: 'limit', num };
};

// Generic matcher for queries
const matches = (id, docData, constraints) => {
    if (!constraints) return true;
    for (const c of constraints) {
        if (c.type === 'where') {
            const val = c.field === '__name__' ? id : docData[c.field];
            if (c.op === '==') { if (val !== c.value) return false; }
            else if (c.op === '>') { if (val <= c.value) return false; }
            else if (c.op === '<=') { if (val > c.value) return false; }
            else if (c.op === '<') { if (val >= c.value) return false; }
            else if (c.op === '>=') { if (val < c.value) return false; }
            else if (c.op === 'in') { if (!Array.isArray(c.value) || !c.value.includes(val)) return false; }
            else if (c.op === 'array-contains') { if (!Array.isArray(val) || !val.includes(c.value)) return false; }
        }
    }
    return true;
};

// ⚡ SQLite fast-path helpers (Electron desktop only) ------------------------
const SQLITE_ENABLED = (() => { try { return isSqliteAvailable(); } catch (e) { return false; } })();
const sqliteCompanyId = () => getActiveCompanyId() || '__master__';
const sqliteMirrored = new Set();
const sqliteMirrorPromises = {};

/**
 * One-time import of a company's RxDB offline_records into SQLite.
 * Runs once per company per app session (tracked by `sqliteMirrored`).
 */
async function importCompanyToSqlite(cid) {
    const db = await getDB();
    if (!db || !db.offline_records) return false;
    const docs = await db.offline_records.find().exec();
    const rows = (docs || []).map(d => d.toJSON());
    if (rows.length > 0) await sqlite.putRecords(cid, rows);
    try { await sqlite.setMeta(`mirrored_v1_${cid}`, String(Date.now())); } catch (e) { /* non-fatal */ }
    console.log(`[SQLITE] Imported ${rows.length} records for company "${cid}"`);
    return true;
}

function ensureSqliteMirror(cid) {
    if (sqliteMirrored.has(cid)) return Promise.resolve(true);
    if (sqliteMirrorPromises[cid]) return sqliteMirrorPromises[cid];
    sqliteMirrorPromises[cid] = importCompanyToSqlite(cid)
        .then((okVal) => { sqliteMirrored.add(cid); return okVal; })
        .catch((e) => { console.warn('[SQLITE] import failed:', e?.message || e); sqliteMirrored.add(cid); return false; });
    return sqliteMirrorPromises[cid];
}

/** Mirror a single doc write to SQLite (non-fatal on failure). */
async function sqliteMirrorDoc(cid, doc) {
    if (!SQLITE_ENABLED || !doc || !doc.id) return;
    try { await sqlite.putRecord(cid, doc); } catch (e) { /* non-fatal mirror */ }
}

/** Mirror a deletion to SQLite (non-fatal on failure). */
async function sqliteMirrorRemove(cid, id) {
    if (!SQLITE_ENABLED || !id) return;
    try { await sqlite.removeRecord(cid, id); } catch (e) { /* non-fatal mirror */ }
}

function emptySnapshot() {
    return { docs: [], size: 0, empty: true, forEach: () => { }, map: () => [], filter: () => [], some: () => false, index: () => undefined, docChanges: () => [] };
}

/** Build a Firestore-like snapshot from plain { id, data } rows, applying constraints. */
function buildDocsSnapshot(queryPath, results, q) {
    let list = results || [];
    if (q && q.constraints) {
        const order = q.constraints.find(c => c.type === 'orderBy');
        if (order) {
            list = [...list].sort((a, b) => {
                const va = a.data?.[order.field];
                const vb = b.data?.[order.field];
                if (va < vb) return order.dir === 'asc' ? -1 : 1;
                if (va > vb) return order.dir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        const lim = q.constraints.find(c => c.type === 'limit');
        if (lim) list = list.slice(0, lim.num);
    }
    const snapshot = {
        docs: list.map(r => ({
            id: r.id,
            data: () => r.data,
            exists: () => true,
            ref: { id: r.id, path: `${queryPath}/${r.id}` },
            metadata: { fromCache: true, hasPendingWrites: false }
        })),
        size: list.length,
        empty: list.length === 0,
        metadata: { fromCache: true, hasPendingWrites: false },
        forEach(cb) { snapshot.docs.forEach(cb); },
        map(cb) { return snapshot.docs.map(cb); },
        filter(cb) { return snapshot.docs.filter(cb); },
        some(cb) { return snapshot.docs.some(cb); },
        index(idx) { return snapshot.docs[idx]; },
        docChanges: () => []
    };
    return snapshot;
}

export const getDocs = async (q) => {
    const queryPath = q.path || q;

    // ⚡ Fast path: read from the SQLite mirror (Electron desktop)
    if (SQLITE_ENABLED) {
        try {
            const cid = sqliteCompanyId();
            await ensureSqliteMirror(cid);
            const { rows } = await sqlite.getRecords(cid, queryPath);
            const results = (rows || []).filter(r => matches(r.id, r.data, q.constraints));

            // Safety: if SQLite has nothing for this collection but RxDB does (stale/missing
            // mirror or company-context mismatch), fall back to RxDB — the authoritative store.
            if (results.length === 0) {
                const db2 = await getDB();
                if (db2 && db2.offline_records) {
                    const rxDocs = await db2.offline_records.find({ selector: { collectionName: queryPath } }).exec();
                    if (rxDocs.length > 0) {
                        const rxResults = (rxDocs || []).map(d => d.toJSON()).filter(d => matches(d.id, d.data, q.constraints));
                        console.log(`[rxfs][sqlite] getDocs ${queryPath} → RxDB fallback (${rxResults.length})`);
                        return buildDocsSnapshot(queryPath, rxResults, q);
                    }
                }
            }

            console.log(`[rxfs][sqlite] getDocs ${queryPath} → ${results.length}`);
            return buildDocsSnapshot(queryPath, results, q);
        } catch (e) {
            console.warn('[rxfs][sqlite] getDocs fallback to RxDB:', e?.message || e);
        }
    }

    const db = await getDB();
    // Safety check for collection
    if (!db.offline_records) return emptySnapshot(queryPath);

    let docs = [];
    try {
        docs = await db.offline_records.find({
            selector: { collectionName: queryPath }
        }).exec();
    } catch (e) {
        console.error("EXEC ERROR:", e);
    }

    // Map and filter docs
    const results = (docs || []).map(d => d.toJSON())
        .filter(d => matches(d.id, d.data, q.constraints));

    return buildDocsSnapshot(queryPath, results, q);
};

function makeDocSnapshot(docRef, id) {
    return {
        id,
        ref: { id, path: docRef?.path },
        metadata: { fromCache: true, hasPendingWrites: false },
        exists: () => false,
        data: () => undefined,
        // Add fake array-like methods to prevent crashes in generic code
        forEach: () => { },
        map: () => [],
        filter: () => [],
        some: () => false
    };
}

export const getDoc = async (docRef) => {
    if (!docRef || !docRef.path) return { id: '', ref: docRef, exists: () => false, data: () => undefined };

    const parts = docRef.path.split('/');
    const id = parts[parts.length - 1];
    const colName = parts.slice(0, -1).join('/');

    // ⚡ Fast path: read from the SQLite mirror (Electron desktop)
    if (SQLITE_ENABLED) {
        try {
            const cid = sqliteCompanyId();
            await ensureSqliteMirror(cid);
            const { record } = await sqlite.getRecord(cid, id);
            const snap = makeDocSnapshot(docRef, id);
            if (record && record.collectionName === colName) {
                snap.exists = () => true;
                snap.data = () => record.data;
                return snap;
            }
            if (id === 'nadeem_dev_uid') {
                snap.exists = () => true;
                snap.data = () => ({ name: 'Nadeem Al Saham', role: 'developer', email: 'nadeemalsaham@gmail.com', ownerId: 'offline-admin' });
            }
            return snap;
        } catch (e) {
            console.warn('[rxfs][sqlite] getDoc fallback to RxDB:', e?.message || e);
        }
    }

    const db = await getDB();
    if (!db.offline_records) return makeDocSnapshot(docRef, id);
    const rxDoc = await db.offline_records.findOne({ selector: { id, collectionName: colName } }).exec();

    const snap = makeDocSnapshot(docRef, id);

    if (rxDoc) {
        const data = rxDoc.toJSON();
        snap.exists = () => true;
        snap.data = () => data.data;
    } else if (id === 'nadeem_dev_uid') {
        snap.exists = () => true;
        snap.data = () => ({ name: 'Nadeem Al Saham', role: 'developer', email: 'nadeemalsaham@gmail.com', ownerId: 'offline-admin' });
    }
    return snap;
};

export const onSnapshot = (q, callback) => {
    const targetType = q.type || (q.path && q.path.split('/').length % 2 === 0 ? 'doc' : 'collection');
    const queryPath = q.path || q;

    let subscription = null;
    let isUnsubscribed = false;

    getDB().then(db => {
        if (isUnsubscribed) return;
        if (!db.offline_records) return;

        if (targetType === 'doc') {
            const parts = queryPath.split('/');
            const id = parts[parts.length - 1];
            const colName = parts.slice(0, -1).join('/');

            subscription = db.offline_records.findOne({ selector: { id, collectionName: colName } }).$.subscribe(rxDoc => {
                const snap = {
                    id,
                    ref: { id, path: queryPath },
                    metadata: { fromCache: true },
                    exists: () => false,
                    data: () => undefined,
                    forEach: () => { },
                    map: () => [],
                    filter: () => [],
                    some: () => false
                };
                if (rxDoc) {
                    const data = rxDoc.toJSON();
                    snap.exists = () => true;
                    snap.data = () => data.data;
                } else if (id === 'nadeem_dev_uid') {
                    snap.exists = () => true;
                    snap.data = () => ({ name: 'Nadeem Al Saham', role: 'developer', email: 'nadeemalsaham@gmail.com', ownerId: 'offline-admin' });
                }
                callback(snap);
            });
        } else {
            // ⚡ Fast first render from SQLite (Electron); the RxDB subscription keeps it reactive afterwards
            if (SQLITE_ENABLED) {
                try {
                    const cid = sqliteCompanyId();
                    ensureSqliteMirror(cid).then(() => sqlite.getRecords(cid, queryPath)).then(({ rows }) => {
                        if (isUnsubscribed) return;
                        const mapped = (rows || []).filter(d => matches(d.id, d.data, q.constraints));
                        if (mapped.length > 0) callback(buildDocsSnapshot(queryPath, mapped, q));
                    }).catch(() => { /* non-fatal */ });
                } catch (e) { /* ignore */ }
            }
            const rxQuery = db.offline_records.find({ selector: { collectionName: queryPath } });
            subscription = rxQuery.$.subscribe(rxDocs => {
                console.log(`[onSnapshot] Collection update for ${queryPath}`);
                const rxArr = rxDocs || [];
                const mapped = rxArr.map(d => d.toJSON())
                    .filter(d => matches(d.id, d.data, q.constraints));

                const snapSize = mapped.length;
                const snap = {
                    docs: mapped.map(r => ({
                        id: r.id,
                        data: () => r.data,
                        exists: () => true,
                        ref: { id: r.id, path: `${queryPath}/${r.id}` },
                        metadata: { fromCache: true }
                    })),
                    size: snapSize,
                    empty: snapSize === 0,
                    forEach(cb) { snap.docs.forEach(cb); },
                    map(cb) { return snap.docs.map(cb); },
                    filter(cb) { return snap.docs.filter(cb); },
                    some(cb) { return snap.docs.some(cb); },
                    docChanges: () => {
                        return mapped.map(r => ({
                            type: 'added',
                            doc: {
                                id: r.id,
                                data: () => r.data,
                                exists: () => true,
                                ref: { id: r.id, path: `${queryPath}/${r.id}` }
                            }
                        }));
                    }
                };
                callback(snap);
            });
        }
    });

    return () => {
        isUnsubscribed = true;
        if (subscription) subscription.unsubscribe();
    };
};

// Helper to ensure data is a plain JSON object (avoids DataCloneError in RxDB/BroadcastChannel)
function wash(data) {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) => {
        // If it's a Firestore Timestamp (resilient check for minified builds)
        if (value && typeof value === 'object' && (value.constructor?.name === 'Timestamp' || typeof value.toDate === 'function')) {
            const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value.seconds * 1000);
            return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 };
        }
        // Handle serverTimestamp sentinel
        if (value && value.type === 'serverTimestamp') {
            return Date.now();
        }
        return value;
    }));
}

export const addDoc = async (colRef, data) => {
    const db = await getDB();
    const newId = uuidv4();

    const cleanData = wash(data);

    await db.offline_records.insert({
        id: newId,
        collectionName: colRef.path,
        data: cleanData,
        timestamp: Date.now()
    });

    // ⚡ Mirror to SQLite (Electron fast read store)
    sqliteMirrorDoc(sqliteCompanyId(), { id: newId, collectionName: colRef.path, data: cleanData, timestamp: Date.now() });

    // Notify sync layer
    try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id: newId, collectionName: colRef.path, operation: 'INSERT' }); } catch(e) {}

    return { id: newId, path: `${colRef.path}/${newId}` };
};

export const setDoc = async (docRef, data, options = { merge: false }) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const colName = parts.slice(0, -1).join('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;
    const cleanData = wash(data);

    const isConflictError = (e) =>
        e?.rxdb === true ||
        e?.code === 'CONFLICT' ||
        (e?.message && e.message.includes('CONFLICT')) ||
        (e?.parameters?.writeError?.status === 409) ||
        e?.status === 409;

    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const exist = await db.offline_records.findOne({ selector: { id, collectionName: colName } }).exec();
        const existAny = exist ? null : await db.offline_records.findOne({ selector: { id } }).exec();
        try {
            if (exist) {
                if (options.merge) {
                    const existingData = JSON.parse(JSON.stringify(exist.toJSON().data || {}));
                    await exist.patch({ data: { ...existingData, ...cleanData }, timestamp: Date.now() });
                } else {
                    await exist.patch({ data: cleanData, timestamp: Date.now() });
                }
                // ⚡ Mirror to SQLite
                sqliteMirrorDoc(sqliteCompanyId(), { id, collectionName: colName, data: options.merge ? { ...JSON.parse(JSON.stringify(exist.toJSON().data || {})), ...cleanData } : cleanData, timestamp: Date.now(), lastSync: exist.toJSON().lastSync });
                // Notify sync layer for updates on existing docs
                try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'UPDATE' }); } catch(e) {}
            } else if (existAny) {
                // Same id exists in another collection: treat as a move to target collection.
                const anyData = JSON.parse(JSON.stringify(existAny.toJSON().data || {}));
                const nextData = options.merge ? { ...anyData, ...cleanData } : cleanData;
                await existAny.patch({ collectionName: colName, data: nextData, timestamp: Date.now() });
                // ⚡ Mirror to SQLite
                sqliteMirrorDoc(sqliteCompanyId(), { id, collectionName: colName, data: nextData, timestamp: Date.now(), lastSync: existAny.toJSON().lastSync });
                try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'UPDATE' }); } catch(e) {}
            } else {
                await db.offline_records.insert({
                    id: id,
                    collectionName: colName,
                    data: cleanData,
                    timestamp: Date.now()
                });
                // ⚡ Mirror to SQLite
                sqliteMirrorDoc(sqliteCompanyId(), { id, collectionName: colName, data: cleanData, timestamp: Date.now() });
                // Notify for new inserts too (backup)
                try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'INSERT' }); } catch(e) {}
            }
            return;
        } catch (e) {
            if (isConflictError(e) && attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 30 * (attempt + 1)));
                continue;
            }
            throw e;
        }
    }
};

export const updateDoc = async (docRef, data) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const colName = parts.slice(0, -1).join('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;
    const cleanData = wash(data);

    const isConflictError = (e) =>
        e?.rxdb === true ||
        e?.code === 'CONFLICT' ||
        (e?.message && e.message.includes('CONFLICT')) ||
        (e?.parameters?.writeError?.status === 409) ||
        e?.status === 409;

    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const exist = await db.offline_records.findOne({ selector: { id, collectionName: colName } }).exec();
        if (!exist) {
            // Try finding by id only (collectionName might differ)
            const existAny = await db.offline_records.findOne({ selector: { id } }).exec();
            if (!existAny) return;
            const mergedAny = { ...existAny.toJSON().data, ...cleanData };
            await existAny.patch({ data: mergedAny, timestamp: Date.now() });
            // ⚡ Mirror to SQLite
            sqliteMirrorDoc(sqliteCompanyId(), { id, collectionName: colName, data: mergedAny, timestamp: Date.now(), lastSync: existAny.toJSON().lastSync });
            // Notify sync layer
            try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'UPDATE' }); } catch(e) {}
            return;
        }
        try {
            const existingData = JSON.parse(JSON.stringify(exist.toJSON().data || {}));
            const merged = { ...existingData, ...cleanData };
            await exist.patch({ data: merged, timestamp: Date.now() });
            // ⚡ Mirror to SQLite
            sqliteMirrorDoc(sqliteCompanyId(), { id, collectionName: colName, data: merged, timestamp: Date.now(), lastSync: exist.toJSON().lastSync });
            // Notify sync layer directly (backup for RxDB $ observable)
            try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'UPDATE' }); } catch(e) {}
            return;
        } catch (e) {
            if (isConflictError(e) && attempt < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 30 * (attempt + 1)));
                continue;
            }
            throw e;
        }
    }
};

export const deleteDoc = async (docRef) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const colName = parts.slice(0, -1).join('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;

    // Re-fetch fresh on each attempt to avoid _rev conflict with background sync
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const fresh = await db.offline_records.findOne({ selector: { id, collectionName: colName } }).exec();
        if (!fresh) return; // already deleted
        try {
            await fresh.remove();
            // ⚡ Mirror deletion to SQLite
            sqliteMirrorRemove(sqliteCompanyId(), id);
            // Notify sync layer
            try { if (window.__accproNotifyDataChange) window.__accproNotifyDataChange({ id, collectionName: colName, operation: 'DELETE' }); } catch(e) {}
            return; // success
        } catch (e) {
            const isConflict = e?.rxdb === true || e?.code === 'CONFLICT' ||
                (e?.message && e.message.includes('CONFLICT')) ||
                (e?.parameters?.writeError?.status === 409);
            if (isConflict && attempt < MAX_RETRIES - 1) {
                // Small back-off then retry with freshly fetched revision
                await new Promise(r => setTimeout(r, 30 * (attempt + 1)));
                continue;
            }
            throw e;
        }
    }
};

export const writeBatch = () => {
    const ops = [];
    return {
        set: (ref, data, opts) => ops.push(() => setDoc(ref, data, opts)),
        update: (ref, data) => ops.push(() => updateDoc(ref, data)),
        delete: (ref) => ops.push(() => deleteDoc(ref)),
        commit: async () => {
            for (const op of ops) await op();
        }
    };
};

export const runTransaction = async (db, callback) => {
    console.warn(`[runTransaction] START`);
    const transaction = {
        get: async (ref) => {
            console.log(`[Transaction] GET ${ref.path}`);
            return await getDoc(ref);
        },
        set: async (ref, data, opts) => {
            console.log(`[Transaction] SET ${ref.path}`);
            return await setDoc(ref, data, opts);
        },
        update: async (ref, data) => {
            console.log(`[Transaction] UPDATE ${ref.path}`);
            return await updateDoc(ref, data);
        },
        delete: async (ref) => {
            console.log(`[Transaction] DELETE ${ref.path}`);
            return await deleteDoc(ref);
        }
    };
    try {
        const result = await callback(transaction);
        console.warn(`[runTransaction] SUCCESS`);
        return result;
    } catch (e) {
        console.error(`[runTransaction] ERROR:`, e);
        throw e;
    }
};

