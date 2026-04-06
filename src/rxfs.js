import { v4 as uuidv4 } from 'uuid';
import { getDB } from './localDB';

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
const matches = (docData, constraints) => {
    if (!constraints) return true;
    for (const c of constraints) {
        if (c.type === 'where') {
            const val = docData[c.field];
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

export const getDocs = async (q) => {
    console.warn(`[getDocs] start for ${q.path || q}`);
    const db = await getDB();
    const queryPath = q.path || q;

    // Safety check for collection
    if (!db.offline_records) return { docs: [], size: 0, empty: true, forEach: () => { }, map: () => [], filter: () => [], some: () => false };

    let docs = [];
    try {
        docs = await db.offline_records.find({
            selector: { collectionName: queryPath }
        }).exec();
    } catch (e) {
        console.error("EXEC ERROR:", e);
    }
    console.warn(`[getDocs] find finished for ${queryPath}`);

    // Map and filter docs
    let results = (docs || []).map(d => d.toJSON())
        .filter(d => matches(d.data, q.constraints));

    // sorting
    if (q.constraints) {
        const order = q.constraints.find(c => c.type === 'orderBy');
        if (order) {
            results.sort((a, b) => {
                const va = a.data[order.field];
                const vb = b.data[order.field];
                if (va < vb) return order.dir === 'asc' ? -1 : 1;
                if (va > vb) return order.dir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        const lim = q.constraints.find(c => c.type === 'limit');
        if (lim) {
            results = results.slice(0, lim.num);
        }
    }

    const snapshot = {
        docs: results.map(r => ({
            id: r.id,
            data: () => r.data,
            exists: () => true,
            ref: { id: r.id, path: `${queryPath}/${r.id}` },
            metadata: { fromCache: true, hasPendingWrites: false }
        })),
        size: results.length,
        empty: results.length === 0,
        metadata: { fromCache: true, hasPendingWrites: false },
        forEach(cb) { snapshot.docs.forEach(cb); },
        map(cb) { return snapshot.docs.map(cb); },
        filter(cb) { return snapshot.docs.filter(cb); },
        some(cb) { return snapshot.docs.some(cb); },
        index(idx) { return snapshot.docs[idx]; },
        docChanges: () => []
    };
    console.warn(`[getDocs] finished for ${queryPath}`); return snapshot;
};

export const getDoc = async (docRef) => {
    const db = await getDB();
    if (!db.offline_records || !docRef || !docRef.path) return { id: '', ref: docRef, exists: () => false, data: () => undefined };

    const parts = docRef.path.split('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return snap;
    const rxDoc = await db.offline_records.findOne({ selector: { id } }).exec();

    const snap = {
        id,
        ref: { id, path: docRef.path },
        metadata: { fromCache: true, hasPendingWrites: false },
        exists: () => false,
        data: () => undefined,
        // Add fake array-like methods to prevent crashes in generic code
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
    return snap;
};

export const onSnapshot = (q, callback) => {
    const targetType = q.type || (q.path && q.path.split('/').length % 2 === 0 ? 'doc' : 'collection');
    const queryPath = q.path || q;

    getDB().then(db => {
        if (!db.offline_records) return;

        if (targetType === 'doc') {
            const parts = queryPath.split('/');
            const id = parts[parts.length - 1];

            const sub = db.offline_records.findOne({ selector: { id } }).$.subscribe(rxDoc => {
                const snap = {
                    id,
                    ref: { id, path: queryPath },
                    metadata: { fromCache: true },
                    exists: () => false,
                    data: () => undefined,
                    // Add fake array-like methods
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
            const rxQuery = db.offline_records.find({ selector: { collectionName: queryPath } });
            const sub = rxQuery.$.subscribe(rxDocs => {
                const rxArr = rxDocs || [];
                const mapped = rxArr.map(d => d.toJSON())
                    .filter(d => matches(d.data, q.constraints));

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

    return () => { /* Unsubscribe logic */ };
};

export const addDoc = async (colRef, data) => {
    const db = await getDB();
    const newId = uuidv4();

    const cleanData = JSON.parse(JSON.stringify(data, (k, v) =>
        (v && v.type === 'serverTimestamp') ? Timestamp.now() : v
    ));

    await db.offline_records.insert({
        id: newId,
        collectionName: colRef.path,
        data: cleanData,
        timestamp: Date.now()
    });

    return { id: newId, path: `${colRef.path}/${newId}` };
};

export const setDoc = async (docRef, data, options = { merge: false }) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;
    const exist = await db.offline_records.findOne({ selector: { id } }).exec();

    const cleanData = JSON.parse(JSON.stringify(data, (k, v) =>
        (v && v.type === 'serverTimestamp') ? Timestamp.now() : v
    ));

    if (exist) {
        if (options.merge) {
            await exist.patch({ data: { ...exist.data, ...cleanData } });
        } else {
            await exist.patch({ data: cleanData });
        }
    } else {
        await db.offline_records.insert({
            id: id,
            collectionName: colName,
            data: cleanData,
            timestamp: Date.now()
        });
    }
};

export const updateDoc = async (docRef, data) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;
    const exist = await db.offline_records.findOne({ selector: { id } }).exec();
    if (exist) {
        const cleanData = JSON.parse(JSON.stringify(data, (k, v) =>
            (v && v.type === 'serverTimestamp') ? Timestamp.now() : v
        ));
        await exist.patch({ data: { ...exist.data, ...cleanData } });
    }
};

export const deleteDoc = async (docRef) => {
    const db = await getDB();
    if (!docRef || !docRef.path) return;
    const parts = docRef.path.split('/');
    const id = parts[parts.length - 1];

    if (!db.offline_records) return;
    const exist = await db.offline_records.findOne({ selector: { id } }).exec();
    if (exist) {
        await exist.remove();
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
    const transaction = {
        get: async (ref) => await getDoc(ref),
        set: (ref, data) => setDoc(ref, data),
        update: (ref, data) => updateDoc(ref, data),
        delete: (ref) => deleteDoc(ref)
    };
    return await callback(transaction);
};

