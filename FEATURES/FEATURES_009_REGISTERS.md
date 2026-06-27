# Feature 009: Day Book & 22 Registers

> **Purpose:** Central reporting system with 22 different registers and a Day Book.
> All driven by the `ReportsV2.jsx` component with mode/type selection.

## Files Involved

| File | Role |
|------|------|
| `src/ReportsV2.jsx` | Main reporting engine — handles all register types |
| `src/RegistersDashboard.jsx` | Navigation hub with keyboard shortcuts (Alt+Letter) |

## Registers List

| Register | Mode/Type | Source Collection |
|----------|-----------|-----------------|
| Day Book | `'daybook'` | All collections |
| Sales Register | `'sales'` | `invoices` |
| Purchase Register | `'purchase'` | `invoices` |
| Payment Register | `'payment'` | `payments` |
| Receipt Register | `'receipt'` | `payments` |
| Contra Register | `'contra'` | `payments` |
| Journal Register | `'journal'` | `journal_vouchers` |
| Debit Notes | `'debit-note'` | `invoices` |
| Credit Notes | `'credit-note'` | `invoices` |
| Stock Inventory | `'stock'` | `products` + transactions |
| Piece-Wise Inventory | `'piece-wise'` | Stock breakdown |
| Lot-Wise Detail | `'lot-wise'` | Batch/Lot tracking |
| Cashier Register | `'cashier'` | Payments filtered |
| Customer Register | `'entities'` | Parties + transactions |
| Capital Register | `'capital'` | `capital_accounts` |
| Assets Register | `'assets'` | `asset_accounts` |
| Direct Expenses Register | `'direct-expenses'` | `expenses` |
| Indirect Expenses Register | `'indirect-expenses'` | `expenses` |
| Indirect Incomes Register | `'indirect-incomes'` | `income_accounts` |
| Manufacturing Register | `'manufacturing'` | `stock_journals` |
| Tax Register | `'tax'` | All collections (tax calc) |
| Loans & Advances | Special | `payments` (split tags) |

## Key Features

- Single component handles all 22 register types
- Date range filtering on all registers
- Export to Excel (xlsx)
- Print support
- Keyboard shortcuts from RegistersDashboard (Alt+letter)
- Real-time updates via RxDB reactivity
