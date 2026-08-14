/**
 * ACC PRO — SQLite local store for the Electron desktop build.
 *
 * Uses Node's built-in `node:sqlite` (bundled with Electron 40+ / Node 24).
 * No native modules, no ABI rebuild, no packaging changes required.
 *
 * The renderer (React app) talks to this store over IPC (`accpro-sql:*`).
 * RxDB remains the write/observable/sync store; SQLite is a fast read mirror
 * so list-heavy screens render much faster in the desktop app.
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let db = null;
let dbPath = null;
let lastError = null;

/** Lazily open the SQLite database (after config may have moved userData). */
function getDb() {
    if (db) return db;
    const { DatabaseSync } = require('node:sqlite');
    const dir = app.getPath('userData');
    dbPath = path.join(dir, 'accpro-sqlite.db');
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate();
    console.log('[SQLITE] Opened:', dbPath);
    return db;
}

function migrate() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS records (
            company_id      TEXT NOT NULL,
            id              TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            data            TEXT NOT NULL DEFAULT '{}',
            timestamp       INTEGER NOT NULL DEFAULT 0,
            last_sync       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (company_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_records_company_col ON records(company_id, collection_name);
        CREATE INDEX IF NOT EXISTS idx_records_company_col_ts ON records(company_id, collection_name, timestamp);

        CREATE TABLE IF NOT EXISTS companies (
            id        TEXT PRIMARY KEY,
            name      TEXT,
            data      TEXT,
            timestamp INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS device_names (
            hostname    TEXT PRIMARY KEY,
            custom_name TEXT
        );

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    `);
}

function safeParse(s) {
    if (s === null || s === undefined) return {};
    try { return JSON.parse(s); } catch (e) { return {}; }
}

function parseRows(rows) {
    return (rows || []).map(r => ({ ...r, data: safeParse(r.data) }));
}

function ok(result) { return { ok: true, ...result }; }
function err(e) { lastError = String(e?.message || e); return { ok: false, error: lastError }; }

function registerHandlers() {
    // ---- Diagnostics / health ----
    ipcMain.handle('accpro-sql:info', () => {
        try {
            const d = getDb();
            const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
            let counts = {};
            try {
                counts.records = d.prepare('SELECT COUNT(*) AS c FROM records').get().c;
                counts.companies = d.prepare('SELECT COUNT(*) AS c FROM companies').get().c;
                counts.device_names = d.prepare('SELECT COUNT(*) AS c FROM device_names').get().c;
            } catch (e) { counts.error = String(e); }
            return ok({
                path: dbPath,
                size,
                counts,
                node: process.versions.node,
                electron: process.versions.electron
            });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:health', () => {
        try {
            const d = getDb();
            const r = d.prepare('SELECT 1 AS ok').get();
            return ok({ healthy: r?.ok === 1 });
        } catch (e) { return err(e); }
    });

    // ---- Raw read-only queries (SELECT / PRAGMA / WITH only) ----
    ipcMain.handle('accpro-sql:query', (e, sql, params) => {
        try {
            const d = getDb();
            const s = String(sql || '').trim();
            if (!/^(SELECT|PRAGMA|WITH)\b/i.test(s)) throw new Error('Only read-only queries are allowed');
            const stmt = d.prepare(s);
            return ok({ rows: stmt.all(...(params || [])) });
        } catch (e) { return err(e); }
    });

    // ---- Structured reads ----
    ipcMain.handle('accpro-sql:getRecords', (e, companyId, collectionName) => {
        try {
            const d = getDb();
            const cid = String(companyId || '');
            const col = String(collectionName || '');
            const rows = d.prepare(
                'SELECT id, collection_name AS collectionName, data, timestamp, last_sync AS lastSync FROM records WHERE company_id = ? AND collection_name = ? ORDER BY timestamp DESC'
            ).all(cid, col);
            return ok({ rows: parseRows(rows) });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:getRecord', (e, companyId, id) => {
        try {
            const d = getDb();
            const r = d.prepare(
                'SELECT id, collection_name AS collectionName, data, timestamp, last_sync AS lastSync FROM records WHERE company_id = ? AND id = ?'
            ).get(String(companyId || ''), String(id || ''));
            return ok({ record: r ? parseRows([r])[0] : null });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:countRecords', (e, companyId, collectionName) => {
        try {
            const d = getDb();
            const cid = String(companyId || '');
            if (collectionName) {
                return ok({ count: d.prepare('SELECT COUNT(*) AS c FROM records WHERE company_id = ? AND collection_name = ?').get(cid, String(collectionName)).c });
            }
            return ok({ count: d.prepare('SELECT COUNT(*) AS c FROM records WHERE company_id = ?').get(cid).c });
        } catch (e) { return err(e); }
    });

    // ---- Structured writes ----
    ipcMain.handle('accpro-sql:putRecords', (e, companyId, docs) => {
        try {
            const d = getDb();
            const cid = String(companyId || '');
            if (!Array.isArray(docs)) throw new Error('docs must be an array');
            const upsert = d.prepare(`
                INSERT INTO records (company_id, id, collection_name, data, timestamp, last_sync)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(company_id, id) DO UPDATE SET
                    collection_name = excluded.collection_name,
                    data = excluded.data,
                    timestamp = excluded.timestamp,
                    last_sync = excluded.last_sync
            `);
            d.exec('BEGIN');
            try {
                for (const doc of docs) {
                    if (!doc || !doc.id) continue;
                    upsert.run(
                        cid,
                        String(doc.id),
                        String(doc.collectionName || ''),
                        JSON.stringify(doc.data ?? {}),
                        Number(doc.timestamp) || 0,
                        Number(doc.lastSync) || 0
                    );
                }
                d.exec('COMMIT');
            } catch (e) {
                try { d.exec('ROLLBACK'); } catch (_) {}
                throw e;
            }
            return ok({ written: docs.length });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:putRecord', (e, companyId, doc) => {
        try {
            const d = getDb();
            const cid = String(companyId || '');
            if (!doc || !doc.id) throw new Error('doc.id required');
            const upsert = d.prepare(`
                INSERT INTO records (company_id, id, collection_name, data, timestamp, last_sync)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(company_id, id) DO UPDATE SET
                    collection_name = excluded.collection_name,
                    data = excluded.data,
                    timestamp = excluded.timestamp,
                    last_sync = excluded.last_sync
            `);
            upsert.run(
                cid,
                String(doc.id),
                String(doc.collectionName || ''),
                JSON.stringify(doc.data ?? {}),
                Number(doc.timestamp) || 0,
                Number(doc.lastSync) || 0
            );
            return ok({ written: 1 });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:removeRecord', (e, companyId, id) => {
        try {
            const d = getDb();
            const info = d.prepare('DELETE FROM records WHERE company_id = ? AND id = ?').run(String(companyId || ''), String(id || ''));
            return ok({ removed: Number(info.changes) || 0 });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:removeCollection', (e, companyId, collectionName) => {
        try {
            const d = getDb();
            const info = d.prepare('DELETE FROM records WHERE company_id = ? AND collection_name = ?').run(String(companyId || ''), String(collectionName || ''));
            return ok({ removed: Number(info.changes) || 0 });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:removeCompanyData', (e, companyId) => {
        try {
            const d = getDb();
            const info = d.prepare('DELETE FROM records WHERE company_id = ?').run(String(companyId || ''));
            return ok({ removed: Number(info.changes) || 0 });
        } catch (e) { return err(e); }
    });

    // ---- Companies registry ----
    ipcMain.handle('accpro-sql:getCompanies', () => {
        try {
            const d = getDb();
            const rows = d.prepare('SELECT id, name, data, timestamp FROM companies ORDER BY timestamp DESC').all();
            return ok({ rows: (rows || []).map(r => ({ ...r, data: safeParse(r.data) })) });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:putCompany', (e, company) => {
        try {
            const d = getDb();
            if (!company || !company.id) throw new Error('company.id required');
            d.prepare(`
                INSERT INTO companies (id, name, data, timestamp)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    data = excluded.data,
                    timestamp = excluded.timestamp
            `).run(String(company.id), String(company.name || ''), JSON.stringify(company.data ?? {}), Number(company.timestamp) || Date.now());
            return ok({ written: 1 });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:removeCompany', (e, id) => {
        try {
            const d = getDb();
            d.prepare('DELETE FROM companies WHERE id = ?').run(String(id || ''));
            d.prepare('DELETE FROM records WHERE company_id = ?').run(String(id || ''));
            return ok({ removed: 1 });
        } catch (e) { return err(e); }
    });

    // ---- Device names ----
    ipcMain.handle('accpro-sql:getDeviceNames', () => {
        try {
            const d = getDb();
            const rows = d.prepare('SELECT hostname, custom_name AS customName FROM device_names').all();
            return ok({ rows });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:putDeviceName', (e, hostname, customName) => {
        try {
            const d = getDb();
            d.prepare(`
                INSERT INTO device_names (hostname, custom_name) VALUES (?, ?)
                ON CONFLICT(hostname) DO UPDATE SET custom_name = excluded.custom_name
            `).run(String(hostname || ''), String(customName || ''));
            return ok({ written: 1 });
        } catch (e) { return err(e); }
    });

    // ---- Meta (import flags etc.) ----
    ipcMain.handle('accpro-sql:getMeta', (e, key) => {
        try {
            const d = getDb();
            const r = d.prepare('SELECT value FROM meta WHERE key = ?').get(String(key || ''));
            return ok({ value: r ? r.value : null });
        } catch (e) { return err(e); }
    });

    ipcMain.handle('accpro-sql:setMeta', (e, key, value) => {
        try {
            const d = getDb();
            d.prepare(`
                INSERT INTO meta (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(String(key || ''), value === null || value === undefined ? null : String(value));
            return ok({ written: 1 });
        } catch (e) { return err(e); }
    });
}

function initSqlite() {
    try {
        registerHandlers();
        console.log('[SQLITE] IPC handlers registered.');
        return true;
    } catch (e) {
        console.error('[SQLITE] init failed:', e);
        return false;
    }
}

module.exports = { initSqlite, getDb, getDbPath: () => dbPath };
