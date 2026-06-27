# Feature 005: Payment / Receipt / Contra Vouchers (FinanceVoucherV2)

> **Purpose:** Tally-style accounting vouchers for cash/bank transactions.
> Three voucher types in one component: Payment (outflow), Receipt (inflow), Contra (transfer).
> Supports multi-split allocations (e.g., one payment to multiple parties).

## Files Involved

| File | Role |
|------|------|
| `src/FinanceVoucherV2.jsx` | Main component — all 3 voucher types |
| `src/liveSync.js` | Sync engine that pushes created/edited vouchers to cloud |
| `src/rxfs.js` | Local RxDB writes via Firestore-compatible API |
| `src/App.jsx` | Routes to this component |

## Voucher Types

| Type | Mode | Direction |
|------|------|-----------|
| Payment | `'out'` | Cash/Bank → Party (outflow) |
| Receipt | `'in'` | Party → Cash/Bank (inflow) |
| Contra | `'contra'` | Cash/Bank ↔ Cash/Bank (transfer) |

## Key Features

- **Tally-style keyboard navigation:** Tab through fields, auto-focus on next field.
- **Multi-split allocations:** One voucher can distribute amount across multiple
  parties/accounts with split tracking.
- **Auto-reference numbering:** Unique ref numbers per type + financial year.
- **Duplicate ref check:** Validates against ALL voucher types (invoices, payments,
  journals) to prevent duplicate reference numbers.
- **Advance/Loan tracking:** Payment/Receipt vouchers can tag splits as
  OA (Our Advance), TA (Their Advance), OL (Our Loan), TL (Their Loan).
- **Opening balance display:** Shows party/account balance before entry.
- **Amount-to-words:** Auto-generates Arabic (Dirhams & Fils) text.

## DB Collection

```
Collection: payments (in offline_records with collectionName = "payments")

Document structure:
{
  id: string,              // e.g., "PAY-2026-0001"
  collectionName: "payments",
  data: {
    type: "in" | "out" | "contra",
    date: string,          // DD/MM/YYYY
    refNo: string,
    narration: string,
    splits: [{
      type: "party" | "account" | "expense" | ...,
      entityId: string,
      entityName: string,
      amount: number,
      tag?: "OA" | "TA" | "OL" | "TL"
    }],
    cashAccount: { id, name },
    totalAmount: number,
    createdBy: string,
    createdAt: number,
    updatedAt: number
  }
}
```

## Save Logic

```javascript
// Saving a voucher:
runTransaction(async (transaction) => {
  // 1. Validate all fields
  // 2. Check duplicate refNo across all collections
  // 3. Calculate totals from splits
  // 4. Save to RxDB via setDoc
  // 5. Sync layer pushes to Firestore automatically
});
```

## Key UI Components (within the file)

- **Header:** Voucher type title, date picker, ref no with auto-generation
- **Splits Table:** Editable grid of allocation rows
- **Cash/Bank Account Selector:** Dropdown for the main cash/bank account
- **Narration:** Multi-line description field
- **Totals:** Auto-calculated from splits
- **Action Buttons:** Save, Save & New, Delete, Print

## Important Notes

- **runTransaction** here goes through `rxfs.js` (local mock), NOT real Firestore.
- **Split tags (OA/TA/OL/TL)** are used by the Loans & Advances Register.
- **Ref no format:** Configurable in Management Dashboard → General Rules.
- **Duplicate check:** Scans `invoices`, `payments`, `journal_vouchers`,
  `stock_journals` collections (all within `offline_records`).
