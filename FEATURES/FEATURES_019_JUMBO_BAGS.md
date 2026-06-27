# Feature 019: Jumbo Bags / Bag-Wise Inventory

> **Purpose:** Tracks inventory at individual bag/jumbo-bag level. Shows bag history,
> source (manufactured/purchased), sale details, date-range filtering,
> item-wise/day-wise views.

## Files Involved

| File | Role |
|------|------|
| `src/BagWiseInventoryModal.jsx` | Main component |

## Key Props

- `isOpen`, `onClose`, `onBack`, `zIndex`
- `user`, `dataOwnerId`, `products`
- `globalDateCmd`, `onDateCmdProcessed`, `onOpenVoucher`, `units`

## Key State

| State | Description |
|-------|-------------|
| `bags` | All loaded bag records |
| `loading` | Loading state |
| `searchTerm` | Search by bag number |
| `selectedBagNo` | Currently selected bag for detail view |
| `bagHistory` | History of selected bag |
| `filterProductId` | Filter by product |
| `showItemWise` | Toggle item-wise view |
| `showDayWise` | Toggle day-wise view |
| `viewMode` | `'all'` / `'in_stock'` / `'sold'` |
| `saleDetails` | Sale information for selected bag |
| `dateRange` | Defaults to year-to-date |

## Views

| View | Description |
|------|-------------|
| All Bags | Complete bag inventory list |
| In Stock | Bags currently in inventory |
| Sold | Bags that have been sold |
| Day-Wise | Grouped by date |
| Item-Wise | Grouped by product |

## Key Features

- Individual bag-level tracking
- Bag history (source, movements, sale)
- Source tracking: manufactured vs purchased
- Date range filtering
- Item-wise and day-wise views
- Delete bag with password confirmation
- Excel export support (XLSX)

## DB Collection

```
Collection: jumbo_bags (direct Firestore access via getFirestore)
```

## Dependencies

- Firebase Firestore (real, not aliased — uses `getFirestore` directly)
- Firebase Functions (`httpsCallable` for bag operations)
- XLSX for export
