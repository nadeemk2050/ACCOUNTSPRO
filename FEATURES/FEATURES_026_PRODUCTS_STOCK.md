# Feature 026: Products & Stock Management

> **Purpose:** Product master with opening stock, rates, units. Stock inventory viewer
> with date ranges, column visibility toggles, and global date shortcuts.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | Product CRUD section + StockInventoryModal (inline) |

## DB Collection

```
Collection: products (in offline_records with collectionName = "products")

Document fields:
- name, description
- openingStock, openingRate
- unit (reference to units collection)
- group/category
- location
- hsnCode (tax)
- rate, saleRate
- gst applicable
- createdAt, updatedAt
```

## Stock Inventory Modal

The `StockInventoryModal` is defined inline in `App.jsx` (around line 26278).

Key props:
- `isOpen`, `onClose`, `onBack`, `zIndex`
- `user`, `dataOwnerId`, `products`
- `stockGroups`, `locations`
- `onItemClick`, `userRole`, `currencySymbol`
- `globalDateCmd`, `onDateCmdProcessed`
- `onTriggerDateModal`, `onTriggerPeriodModal`

Key state:
- `dateRange` (from/to, defaults to today)
- `viewMode` (default 'closing')
- `showDateMenu`
- `zoomScale`
- `hiddenCols` (Set of hidden column names)
- Column visibility toggles and restore

Features:
- Date range filtering
- Zoom in/out
- Column visibility toggles
- Global date command support (F2/Alt+F2)
- Closing/opening stock views
- Multiple view modes
