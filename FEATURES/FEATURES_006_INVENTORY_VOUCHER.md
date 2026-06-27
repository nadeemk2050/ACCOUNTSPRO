# Feature 006: Sales / Purchase Invoices (InventoryVoucherV2)

> **Purpose:** Sales and purchase invoice entry with item grid, party selection, tax,
> auto-reference numbering, and duplicate ref check across all voucher types.

## Files Involved

| File | Role |
|------|------|
| `src/InventoryVoucherV2.jsx` | Main component — both Sales and Purchase modes |
| `src/rxfs.js` | Local RxDB writes |
| `src/liveSync.js` | Cloud sync |

## DB Collection

```
Collection: invoices (in offline_records with collectionName = "invoices")

Document structure:
{
  id: string,
  collectionName: "invoices",
  data: {
    type: "sales" | "purchase",
    date: string,
    refNo: string,
    partyId: string,
    partyName: string,
    items: [{ productId, productName, quantity, rate, amount, ... }],
    taxDetails: { ... },
    narration: string,
    totalAmount: number,
    createdBy: string,
    createdAt: number,
    updatedAt: number
  }
}
```

## Key Features

- Sales and Purchase modes in single component
- Item grid with product search, quantity, rate, amount columns
- Auto-ref number generation per financial year
- Duplicate ref check across ALL voucher collections
- Party selection with balance display
- Tax calculation support
- Save to RxDB → auto-sync to cloud

## Important Notes

- Duplicate ref check scans: `invoices`, `payments`, `journal_vouchers`, `stock_journals`
