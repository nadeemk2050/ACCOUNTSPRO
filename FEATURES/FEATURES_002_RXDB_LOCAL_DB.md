# Feature 002: Offline-First Local Database (RxDB)

> **Purpose:** Full offline capability using RxDB with Dexie.js (IndexedDB) storage.
> Two database tiers: Master DB for company registry, Per-Company DB for all transactional data.

## Files Involved

| File | Role |
|------|------|
| `src/localDB.js` | Database initialization, schema, getDB(), getActiveCompanyId() |
| `src/rxfs.js` | Firestore-compatible API that reads/writes to local RxDB instead |

## Database Architecture

```
nadtally_master_db           (Master — 1 per app install)
  └── companies             (List of all companies the user created/opened)
  └── users                 
  └── ...master-level data

nadtally_company_{id}        (Per-Company — 1 per company)
  ├── offline_records       (Generic collection — ALL data stored here for sync)
  └── [other collections]   (Direct collections for non-synced data)
```

## Key Functions

### `getDB()`
- Returns a Promise that resolves to the RxDB instance for the **active company**.
- Cached in `companyDbPromise` — reset to `null` on rejection to allow retry.
- Uses `createRxDBWithDexie()` internally.

### `getActiveCompanyId()`
- Returns the currently active company ID string.
- Used by sync layer to determine which Firestore path to use.

### `createRxDBWithDexie(dbName, schema)`
- Creates an RxDB database with Dexie.js storage adapter.
- Adds collections: `offline_records` with the generic schema.
- Multi-instance support: `multiInstance: true` for BroadcastChannel cross-tab sync.

## Generic Schema

```javascript
const genericSchema = {
  title: 'generic schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    data: { type: 'object' },           // Actual document data
    collectionName: { type: 'string' },  // e.g., "invoices", "parties"
    timestamp: { type: 'number' },       // Last modified time
    lastSync: { type: 'number' }         // Last synced to cloud time
  },
  required: ['id', 'data', 'collectionName'],
  indexes: ['collectionName', 'timestamp', 'lastSync']
};
```

## How Data is Stored

ALL document types (invoices, payments, parties, accounts, etc.) are stored in
the SINGLE `offline_records` collection using the generic schema pattern:

| RxDB Field | Content |
|-----------|---------|
| `id` | Unique document ID (e.g., `INV-2026-0001`) |
| `data` | The full document object (all type-specific fields) |
| `collectionName` | Discriminator field (e.g., `"invoices"`, `"payments"`) |
| `timestamp` | Epoch millis when last modified locally |
| `lastSync` | Epoch millis when last synced to Firestore |

## Important Behavioral Notes

- **RxDB bug:** `offline_records.findByIds()` and `offline_records.bulkWrite()`
  may throw "not a function" errors. Always provide fallback code.
- **Working methods:** `insert`, `findOne`, `find`, `incrementalPatch`, `remove`
  all work correctly.
- **Cross-tab sync:** RxDB's `multiInstance: true` uses BroadcastChannel to
  sync changes across browser tabs automatically.
- **Electron:** Uses `memoryLocalCache()` to avoid IndexedDB corruption in Electron.
- **DB name:** `nadtally_company_{companyId}` — the company ID is always an
  alphanumeric string like `8u57h`.

## Console Logs (Diagnostic)

| Log Message | What It Means |
|------------|---------------|
| `DB: nadtally_company_8u57h` | Database opened successfully for company |
| `[rxfs] setDoc DB: nadtally_company_8u57h` | Document written to offline_records |
| `[rxfs] findOne result: {...}` | Single document retrieved |

## Dependencies

- `rxdb` ^15.39.0
- `dexie` (RxDB storage adapter)
- `rxjs` ^7.5.0 (RxDB dependency)
