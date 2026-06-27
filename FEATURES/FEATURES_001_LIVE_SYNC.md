# Feature 001: Live Sync Engine

> **Purpose:** Real-time bidirectional sync between local RxDB (IndexedDB) and Firebase Firestore.
> Every CRUD action on one PC should appear on all other PCs within 1-2 seconds.

## Files Involved

| File | Role |
|------|------|
| `src/liveSync.js` | Main sync orchestration — push local changes to Firestore, pull remote changes |
| `src/realFirebase.js` | Direct Firebase imports (bypasses Vite alias) — provides real Firestore instance |
| `src/rxfs.js` | Local Firestore shim — calls `notifyDataChange()` after every write to trigger push |
| `src/localDB.js` | RxDB database initialization — `getDB()` returns per-company RxDB instance |

## Architecture

```
User Action → rxfs.js (local write) → notifyDataChange() → liveSync.js

liveSync.js has TWO paths:
  1. PUSH: Periodic scan (30s) + instant trigger via notifyDataChange
     → Reads local RxDB → writeBatch to Firestore `companies_live/{companyId}/records`
  2. PULL: onSnapshot real-time listener + periodic fallback (60s)
     → Reads Firestore changes → bulkUpsert into local RxDB
```

## Key Functions

### `startLiveSync(companyId)`
- Entry point. Called when user opens a company.
- Sets up anonymous Firebase auth.
- Starts `startPullListener()` for real-time incoming changes.
- Starts `pushScanTimer` (30s periodic scan of `offline_records` collection).
- Starts `pullScanTimer` (60s periodic pull fallback).
- Calls `syncCompanyDataDelta()` to push all pending changes immediately.

### `startPullListener()`
- Sets up `onSnapshot(collectionRef, snapshotCallback, errorCallback)` on
  `companies_live/{companyId}/records`.
- On snapshot: calls `bulkUpsertLocalDocs()` to write incoming changes to local RxDB.
- On error: auto-reconnects after 5-second delay (recursive call).
- Returns unsubscribe function for cleanup.

### `syncCompanyDataDelta()`
- Initial bulk push: reads ALL docs from local `offline_records` collection,
  batches them (100 per batch), and writes to Firestore via `writeBatch`.
- Tracks progress via `onCloudSyncStatusChange` callback.
- Updates `lastSync` timestamp on pushed docs.

### `processPendingPushes(queue)`
- Processes a queue of pending push items (added via `notifyDataChange`).
- Uses `getDB().offline_records.findByIds(ids)` to fetch latest data.
- **Fallback:** If `findByIds` returns empty (known RxDB bug), falls back to
  `findOne({ selector: { id } })` for each document individually.
- Groups into Firestore `writeBatch` (max 500 operations per batch).
- Skips already-synced documents (checks `lastSync >= dataTimestamp`).

### `bulkUpsertLocalDocs(docs)`
- Receives remote documents from Firestore pull.
- Uses `rxdb.offline_records.bulkWrite()` for batch insert.
- If `bulkWrite` fails (not a function), falls back to individual
  `findOne` + `insert` for each document.

## Data Flow — Push (Local → Cloud)

```
1. User saves a voucher (e.g., Payment Voucher)
2. rxfs.js writes to local RxDB (offline_records collection)
3. rxfs.js calls notifyDataChange(id, collectionName, operation)
4. notifyDataChange triggers window.__accproNotifyDataChange callback
5. liveSync adds item to pendingPushes queue
6. processPendingPushes() reads latest data from RxDB
7. Writes to Firestore: companies_live/{companyId}/records/{docId}
8. Other PCs' onSnapshot listener fires → bulkUpsertLocalDocs
9. Local RxDB updated → UI re-renders
```

## Data Flow — Pull (Cloud → Local)

```
1. Firestore document changes (written by another PC)
2. onSnapshot listener fires on all connected PCs
3. bulkUpsertLocalDocs() writes to local RxDB
4. UI reactively updates
5. (Fallback) Periodic pull every 60s if onSnapshot misses changes
```

## Sync Path

```
Firestore path: companies_live/{companyId}/records/{documentId}

Document structure:
{
  id: string,
  collectionName: string,     // e.g., "invoices", "payments", "parties"
  data: object,               // Full document data
  timestamp: number,          // When data was last modified locally
  syncTimestamp: number,      // When it was synced to Firestore
  deleted: boolean            // Soft-delete flag
}
```

## Error Handling

- **onSnapshot disconnection:** Auto-reconnects after 5-second delay with error logging.
- **findByIds failure:** Falls back to individual findOne queries.
- **bulkWrite failure:** Falls back to individual insert operations.
- **Firestore write failure:** Logged but non-blocking.
- **Firebase auth failure:** Retries on next push cycle.

## Console Logs (Diagnostic)

| Log Message | What It Means |
|------------|---------------|
| `[SYNC] pushScanTimer fired` | 30s periodic push scan running |
| `[SYNC] processPendingPushes start: N items` | Processing push queue |
| `[SYNC] Batched push for {id}` | Document pushed to Firestore |
| `[SYNC] findOne fallback succeeded for {id}` | findByIds failed, findOne worked |
| `[SYNC] Pull listener received N changes` | Remote changes detected via onSnapshot |
| `[SYNC] bulkUpsertLocalDocs: N upserted` | Remote changes written locally |
| `[SYNC] Periodic pull scan: N changes` | Fallback pull detected changes |

## Global Debug Functions

```javascript
// In browser console:
window.forcePushUnsynced()   // Force-push all pending changes immediately
window.__accproNotifyDataChange({ id, collectionName, operation })  // Manually trigger push
```

## Dependencies

- `@firebase/firestore` (direct, bypasses Vite alias)
- `firebase/auth` (via realFirebase.js)
- RxDB `offline_records` collection with generic schema
- Firestore `companies_live/{companyId}/records` collection

## Important Notes

- **RxDB bug:** `findByIds()` and `bulkWrite()` may not exist on the `offline_records`
  collection. Always provide fallback to `findOne()` / individual `insert()`.
- **Stale DB instance:** Always use `getDB()` (not a captured variable) inside
  `processPendingPushes` and `bulkUpsertLocalDocs` to get the current RxDB instance.
- **Suppression timestamps:** Local writes update `lastSync` to prevent re-pushing
  changes that were just pulled from cloud.
- **Batch limit:** Firestore writeBatch supports max 500 operations per batch.
