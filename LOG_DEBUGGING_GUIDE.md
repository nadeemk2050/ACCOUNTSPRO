# System Log Debugging Guide

## Changes Made to Fix Log Display Issues

### 1. **Timestamp Comparison Fix** ✅
**Problem:** JavaScript `Date` objects don't compare properly with Firestore `Timestamp` objects.

**Solution:** 
- Added `Timestamp` import from `firebase/firestore`
- Convert date strings to Firestore Timestamps using `Timestamp.fromDate()`
- Added client-side filtering as backup

```javascript
const fromTimestamp = Timestamp.fromDate(fromDate);
const toTimestamp = Timestamp.fromDate(toDate);
```

### 2. **Query Error Handling** ✅
**Problem:** Composite index errors weren't clear to users.

**Solution:**
- Added try-catch around query building
- Fallback to simpler query (just ownerId) if date-range query fails
- Clear error messages about missing Firestore indexes

### 3. **Console Debugging** ✅
Added detailed console logs:
```
🔍 LOG QUERY - Shows parameters being queried
📊 LOGS RETRIEVED - Shows how many documents returned
❌ LOG QUERY ERROR - Shows exact error details
```

---

## What to Check if Logs Still Don't Appear

### Step 1: Check Browser Console
1. Open DevTools (F12)
2. Go to **Console** tab
3. Look for messages starting with `🔍 LOG QUERY` or `❌ LOG QUERY ERROR`

### Step 2: Verify Firestore Collection
1. Go to Firebase Console: https://console.firebase.google.com
2. Select project "accnad-8a7d3"
3. Go to **Firestore Database**
4. Look for collection named **`audit_logs`**
5. Check if any documents exist

**If collection is empty:** Logs aren't being saved. Check if operations are triggering log saves.

### Step 3: Check Firestore Index Status
If you see error like: `"indexes are required for this query"`

**Fix:**
1. Firebase usually provides a clickable link in the error
2. Click it to auto-create the required index
3. Wait 2-5 minutes for index to build
4. Refresh the page

**Alternative:** Create manually:
1. Firebase Console → Firestore → Indexes tab
2. Create composite index with:
   - Collection: `audit_logs`
   - Fields: `ownerId (Ascending)`, `date (Descending)`

### Step 4: Verify dataOwnerId is Correct
1. Open Console
2. Run: `console.log(localStorage.getItem('dataOwnerId'))`
3. Compare with the `ownerId` values in audit_logs collection

If they don't match, logs won't appear.

---

## Data Flow for Logs

### Where Logs Are Created

1. **InvoiceModal.handleSave()** - Line ~3167
   ```javascript
   transaction.set(logRef, {
       ownerId: targetUid,
       date: serverTimestamp(),
       // ... other fields
   });
   ```

2. **PaymentModal.handleSave()** - Line ~4037
3. **JournalVoucherModal.handleSave()** - Line ~4273

### Example Log Document Structure
```javascript
{
    date: Timestamp { seconds: 1702000000, nanoseconds: 0 },
    ownerId: "user123",
    userId: "user123",
    userName: "John Doe",
    action: "CREATED",
    docType: "Sales Invoice",
    refNo: "INV-001",
    amount: 1000.50,
    description: "Party: ABC Corp",
    docId: "invoice_abc123"
}
```

---

## Quick Test

### To verify logs are being saved:
1. Create a new Invoice/Payment/Journal Voucher
2. Open DevTools Console
3. Look for: `📊 LOGS RETRIEVED: X documents`
4. If X > 0, logs are being saved ✅

### To verify query is correct:
1. Console should show: `🔍 LOG QUERY - ownerId: xxx`
2. Should match the user's actual UID

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| No logs appear | Check if `audit_logs` collection has data (Firebase Console) |
| "No logs found" message | Date range may be wrong, try "From: 2020" "To: Today" |
| Console error about index | Click Firebase link or create composite index manually |
| Wrong ownerId showing | Check if `dataOwnerId` is being passed correctly to SystemLogModal |
| Logs from other users appear | Verify `where('ownerId', '==', targetUid)` is working |

---

## Recent Code Changes

**File:** `App.jsx`

### Changes:
1. ✅ Added `Timestamp` to imports (Line 8-11)
2. ✅ Modified `SystemLogModal` to use `Timestamp.fromDate()` (Line 468-509)
3. ✅ Added better error handling with fallback queries
4. ✅ Added detailed console logging for debugging

### Testing the Fix:
1. Clear browser cache or hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
2. Create a new transaction (Invoice/Payment/etc)
3. Open System Log Modal
4. Check both console and the table for logs

---

## Need More Help?

If logs still don't appear after these steps, enable these advanced logs:

**In Browser Console, run:**
```javascript
// Get all logs from database
db.collection('audit_logs').orderBy('date', 'desc').limit(10).get()
   .then(snap => console.table(snap.docs.map(d => d.data())))
   .catch(err => console.error(err));
```

This will show the raw Firestore data bypassing all filters.
