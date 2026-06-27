# Feature 003: Firebase Mock Layer (Vite Aliased)

> **Purpose:** Replaces real Firebase Firestore/Auth/etc. with local offline implementations.
> The app uses standard Firebase SDK syntax everywhere, but at build time Vite aliases
> `firebase/firestore` → `src/rxfs.js` so all Firestore calls go to local IndexedDB instead.

## Files Involved

| File | Alias Target | Purpose |
|------|-------------|---------|
| `src/rxfs.js` | `firebase/firestore` | Local Firestore mock — all CRUD to RxDB |
| `src/rxauth.js` | `firebase/auth` | Local auth mock |
| `src/rxrtdb.js` | `firebase/database` | Local RTDB mock |
| `src/rxstorage.js` | `firebase/storage` | Local storage mock |
| `src/rxfunctions.js` | `firebase/functions` | Local functions mock |
| `src/rxapp.js` | `firebase/app` | Local app mock |
| `vite.config.js` | N/A | Vite aliases configuration |
| `src/firebase.js` | User-facing | Fake Firebase init (uses aliased imports) |
| `src/realFirebase.js` | Direct | Real Firebase init (uses `@firebase/*` directly) |

## How Vite Alias Works

In `vite.config.js`:
```javascript
resolve: {
  alias: {
    'firebase/firestore': path.resolve(__dirname, 'src/rxfs.js'),
    'firebase/auth': path.resolve(__dirname, 'src/rxauth.js'),
    // ... etc
  }
}
```

So when any file does `import { setDoc } from 'firebase/firestore'`, Vite resolves
it to `src/rxfs.js` which exports its own `setDoc` that writes to RxDB.

## Bypassing the Alias

`src/realFirebase.js` uses `@firebase/firestore` instead of `firebase/firestore`:
```javascript
import { getFirestore, doc, setDoc, ... } from '@firebase/firestore';
```
The `@firebase/*` packages are NOT aliased, so they access real Firestore directly.
This is used by `liveSync.js` to read/write the actual cloud Firestore.

## Key rxfs.js Functions

| Function | What It Does |
|----------|-------------|
| `setDoc(docRef, data, options)` | Writes to RxDB `offline_records` + calls `notifyDataChange()` + calls `pushToFirestore()` |
| `updateDoc(docRef, data)` | Gets existing doc, merges data, writes back + notifies |
| `deleteDoc(docRef)` | Deletes from RxDB + notifies |
| `addDoc(collectionRef, data)` | Generates auto-ID, writes to RxDB + notifies |
| `getDoc(docRef)` | Reads from RxDB via `findOne` |
| `getDocs(query)` | Reads from RxDB via `find` |
| `onSnapshot(query, callback)` | Sets up RxDB observable for real-time local changes |
| `runTransaction(callback)` | Wraps callback in retry loop with RxDB read/write |
| `writeBatch(db)` | Returns a batch object (local implementation) |
| `query(collectionRef, ...)` | Builds query constraints |
| `where(fieldPath, op, value)` | Query filter |
| `orderBy(field, direction)` | Sort |
| `limit(n)` | Limit results |
| `doc(db, path, ...ids)` | Creates document reference |
| `collection(db, path)` | Creates collection reference |

## pushToFirestore Function (Added for Sync Reliability)

```javascript
function pushToFirestore(id, collectionName, data, operation) {
  // Directly writes to REAL Firestore using @firebase/firestore
  // This bypasses the RxDB query layer entirely
  // Called AFTER every local write (setDoc, updateDoc, addDoc, deleteDoc)
  // Updates lastSync on local doc after successful push
}
```

## Important Notes

- **Two Firebase apps:** Both `firebase.js` and `realFirebase.js` call `initializeApp()`
  with the same config. Firebase deduplicates — only one app is created.
- **`@firebase/firestore`** is NOT aliased. It's the real Firestore SDK used by
  `liveSync.js` and `pushToFirestore` for cloud operations.
- **`runTransaction`** in rxfs.js is a local simulation — it reads from RxDB,
  runs the callback, writes back. It does NOT use real Firestore transactions.
