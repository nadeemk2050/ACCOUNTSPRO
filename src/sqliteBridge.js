/**
 * ACC PRO — Renderer bridge to the Electron main-process SQLite store.
 *
 * Detects the Electron runtime (window.require('electron').ipcRenderer) and
 * exposes a small promise API mirroring the RxDB `offline_records` document
 * shape: { id, collectionName, data, timestamp, lastSync }.
 *
 * In a normal browser this module is inert — `isSqliteAvailable()` returns
 * false and every call rejects, so callers fall back to RxDB.
 */

const getIpc = () => {
    try {
        if (window.require) {
            const electron = window.require('electron');
            if (electron && electron.ipcRenderer) return electron.ipcRenderer;
        }
    } catch (e) { /* not in Electron */ }
    return null;
};

const ipc = getIpc();

export const isSqliteAvailable = () => !!ipc;

const invoke = (channel, ...args) => {
    if (!ipc) return Promise.reject(new Error('SQLite IPC unavailable'));
    return ipc.invoke(channel, ...args);
};

/** Unwrap { ok, ... } envelope; throw on failure. */
const unwrap = (res) => {
    if (res && res.ok === false) throw new Error(res.error || 'SQLite operation failed');
    return res || {};
};

export const sqlite = {
    isAvailable: isSqliteAvailable,

    info: () => invoke('accpro-sql:info').then(unwrap),
    health: () => invoke('accpro-sql:health').then(unwrap),

    // Raw read-only SQL (SELECT/PRAGMA/WITH)
    query: (sql, params) => invoke('accpro-sql:query', sql, params).then(unwrap),

    // Records (offline_records mirror)
    getRecords: (companyId, collectionName) => invoke('accpro-sql:getRecords', companyId, collectionName).then(unwrap),
    getRecord: (companyId, id) => invoke('accpro-sql:getRecord', companyId, id).then(unwrap),
    countRecords: (companyId, collectionName) => invoke('accpro-sql:countRecords', companyId, collectionName).then(unwrap),
    putRecords: (companyId, docs) => invoke('accpro-sql:putRecords', companyId, docs).then(unwrap),
    putRecord: (companyId, doc) => invoke('accpro-sql:putRecord', companyId, doc).then(unwrap),
    removeRecord: (companyId, id) => invoke('accpro-sql:removeRecord', companyId, id).then(unwrap),
    removeCollection: (companyId, collectionName) => invoke('accpro-sql:removeCollection', companyId, collectionName).then(unwrap),
    removeCompanyData: (companyId) => invoke('accpro-sql:removeCompanyData', companyId).then(unwrap),

    // Companies registry
    getCompanies: () => invoke('accpro-sql:getCompanies').then(unwrap),
    putCompany: (company) => invoke('accpro-sql:putCompany', company).then(unwrap),
    removeCompany: (id) => invoke('accpro-sql:removeCompany', id).then(unwrap),

    // Device names
    getDeviceNames: () => invoke('accpro-sql:getDeviceNames').then(unwrap),
    putDeviceName: (hostname, customName) => invoke('accpro-sql:putDeviceName', hostname, customName).then(unwrap),

    // Meta
    getMeta: (key) => invoke('accpro-sql:getMeta', key).then(unwrap),
    setMeta: (key, value) => invoke('accpro-sql:setMeta', key, value).then(unwrap)
};

export default sqlite;
