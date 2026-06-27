# Feature 010: Ledger Modal (Unified Viewer)

> **Purpose:** Comprehensive ledger viewer for parties, accounts, expenses, and more.
> Shows all transactions for an entity with running balance, date filtering, and advanced tools.

## Files Involved

| File | Role |
|------|------|
| `src/LedgerModal.jsx` | Main component |

## Key Props

- `isOpen`, `onClose`, `onBack`, `zIndex`
- `user`, `dataOwnerId`, `userRole`
- Data arrays: `parties`, `products`, `expenses`, `incomeAccounts`, `accounts`, `capitalAccounts`, `assetAccounts`, `taxRates`, `subUsers`, `units`
- `initialState`, `onViewTransaction`, `onDeleteTransaction`, `onBulkDelete`
- `savedFilter`, `onFilterSave`, `currencySymbol`

## Key State

| State | Description |
|-------|-------------|
| `filter` | Entity filter (type/id/date range) |
| `viewCurrency` | Multi-currency view toggle |
| `transactions` | Loaded transactions for the entity |
| `linkedPairsMap` | Contra/linked transaction pairs |
| `searchTerm` | Text search within ledger |
| `expandDetails` | Expand/collapse transaction details |
| `sortOrder` | Sort direction |
| `currentPage` | 12 items per page |
| `selectedIds` | For bulk operations |
| `itemValuationMethod` | wac/fifo/last_purchase/last_sold |
| `hiddenStack`/`hiddenSet` | Tally-style hidden transaction management |
| `showTools`/`showSearch` | Collapsible tool panels |

## Key Features

- Unified viewer for ALL entity types (parties, accounts, expenses, etc.)
- Running balance display
- Opening balance entry/display
- Date range filtering
- Hide/restore transactions (Tally-style hidden stack)
- Bulk delete selected transactions
- Multi-currency view
- Item valuation methods (WAC/FIFO/Last Purchase/Last Sold)
- Collapsible tools panel
- Search within ledger
- Export capability
- 12 items per page with pagination
