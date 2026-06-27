# Feature 027: Manufacturing Journal

> **Purpose:** Production/consumption entries with BOM-style tracking.
> Records items consumed and items produced in manufacturing processes.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | Manufacturing journal entry (inline section) |

## DB Collection

```
Collection: stock_journals (in offline_records with collectionName = "stock_journals")

Document structure:
{
  id: string,
  collectionName: "stock_journals",
  data: {
    type: "manufacturing",
    date: string,
    refNo: string,
    narration: string,
    consumed: [{ productId, productName, quantity, rate, amount }],
    produced: [{ productId, productName, quantity, rate, amount }],
    createdBy: string,
    createdAt: number,
    updatedAt: number
  }
}
```

## Key Features

- Bill of Materials (BOM) style entry
- Multiple consumed items (raw materials)
- Multiple produced items (finished goods)
- Auto-ref number generation
- Duplicate ref check across all voucher types
- Updates stock quantities on save
- Manufacturing Register view in ReportsV2

## Related

- Stock recalculation can rebuild manufacturing journal effects
- Jumbo Bags can be tagged as "manufactured" from production runs
