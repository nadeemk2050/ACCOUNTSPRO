# Feature 008: Accounts & Ledger Management

> **Purpose:** Chart of accounts management — Cash/Bank, Expenses, Income, Capital, Assets.
> Each account type has its own collection and can be viewed in the unified Ledger Modal.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | Account CRUD sections (inline modals) |
| `src/LedgerModal.jsx` | Unified ledger viewer for all account types |
| `src/rxfs.js` | Local RxDB writes |

## DB Collections

| Collection | Description |
|-----------|-------------|
| `accounts` | Cash/Bank accounts |
| `expenses` | Expense ledgers (direct & indirect) |
| `income_accounts` | Income ledgers |
| `capital_accounts` | Capital/Equity ledgers |
| `asset_accounts` | Fixed & current asset ledgers |

## Key Features

- Separate collections for each account type
- Create, edit, delete accounts
- Opening balance entry per account
- Ledger viewing via `LedgerModal` with date range filters
- Balance calculated from transactions (not stored directly)
- Recalculation engine can rebuild all balances from scratch

## Account Types (in UI)

- Cash & Bank Accounts
- Direct Expenses (Manufacturing/COGS)
- Indirect Expenses (Operating/Admin)
- Direct Incomes
- Indirect Incomes
- Capital Accounts
- Asset Accounts
