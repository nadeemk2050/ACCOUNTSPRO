// ==============================================================
// NADTALLY LICENSE SYSTEM — Firestore REST API (no SDK needed)
// Uses direct fetch() calls to avoid Firebase SDK multi-app
// initialization issues in Electron environments.
// ==============================================================

const FIREBASE_API_KEY = 'AIzaSyAgTuSqvk5qGtP5bHBOXRL3CTar-Uw9F7I';
const PROJECT_ID = 'cashshams';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Read a license document ─────────────────────────────────────────────────
export async function getLicenseDoc(serialKey) {
    const url = `${BASE_URL}/nadtally_licenses/${serialKey}?key=${FIREBASE_API_KEY}`;
    console.log('[LicenseAPI] GET:', url);
    const res = await fetch(url);
    if (res.status === 404) return null; // Document does not exist
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore read error HTTP ${res.status}: ${text}`);
    }
    const json = await res.json();
    console.log('[LicenseAPI] Raw response:', json);
    return parseDoc(json);
}

// ─── Update a license document (submit activation request) ───────────────────
export async function updateLicenseDoc(serialKey, fields) {
    const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const url = `${BASE_URL}/nadtally_licenses/${serialKey}?key=${FIREBASE_API_KEY}&${fieldPaths}`;
    const body = { fields: toFirestoreFields(fields) };
    console.log('[LicenseAPI] PATCH:', serialKey, fields);
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore update error HTTP ${res.status}: ${text}`);
    }
    return true;
}

// ─── Find a license by email and password (for Direct Login) ──────────────────
export async function findLicenseByCredentials(email, passwordHash) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const queryBody = {
        structuredQuery: {
            from: [{ collectionId: 'nadtally_licenses' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
                        { fieldFilter: { field: { fieldPath: 'passwordHash' }, op: 'EQUAL', value: { stringValue: passwordHash } } },
                        { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'approved' } } }
                    ]
                }
            },
            limit: 1
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryBody)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Firestore query error: ${text}`);
    }

    const results = await res.json();
    // runQuery returns an array of { document: { name, fields, ... } }
    // If no results, it might return an empty array or an array with an empty object depending on API version
    const firstResult = results.find(r => r.document);
    if (!firstResult) return null;

    const doc = firstResult.document;
    const serialKey = doc.name.split('/').pop();
    const data = parseDoc(doc);
    return { ...data, serialKey };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDoc(json) {
    const raw = json.fields || {};
    const result = {};
    for (const [key, val] of Object.entries(raw)) {
        if ('stringValue' in val) result[key] = val.stringValue;
        else if ('booleanValue' in val) result[key] = val.booleanValue;
        else if ('integerValue' in val) result[key] = parseInt(val.integerValue);
        else if ('doubleValue' in val) result[key] = val.doubleValue;
        else if ('timestampValue' in val) result[key] = new Date(val.timestampValue);
        else if ('nullValue' in val) result[key] = null;
    }
    return result;
}

function toFirestoreFields(obj) {
    const fields = {};
    for (const [key, val] of Object.entries(obj)) {
        if (typeof val === 'string') fields[key] = { stringValue: val };
        else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
        else if (typeof val === 'number') fields[key] = { doubleValue: val };
        else if (val === null) fields[key] = { nullValue: 'NULL_VALUE' };
        else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
        else fields[key] = { stringValue: String(val) };
    }
    return fields;
}
