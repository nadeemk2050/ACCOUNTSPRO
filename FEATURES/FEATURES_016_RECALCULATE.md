# Feature 016: Recalculation Engine

> **Purpose:** Rebuilds ALL balances from scratch by scanning every transaction.
> Supports scoped recalculation for specific entity types. Used when balances get
> out of sync or after data restoration.

## Files Involved

| File | Role |
|------|------|
| `src/recalculate.js` | Main recalculation logic |

## Main Function

```
handleRecalculateSystem(scope = 'all')
```

## Supported Scopes

| Scope | Label | What It Recalculates |
|-------|-------|---------------------|
| `'all'` | Full System | Everything |
| `'products'` | Stock | Product quantities & values |
| `'parties'` | Party Balances | Customer/supplier outstanding |
| `'accounts'` | Account Balances | Cash/bank balances |
| `'expenses'` | Expense Balances | Expense ledger totals |
| `'capital'` | Capital Balances | Equity balances |
| `'assets'` | Asset Balances | Fixed asset values |
| `'income'` | Income Balances | Income ledger totals |

## Data Flow

```
1. User clicks recalculate (from Management Dashboard or menu)
2. Confirmation dialog shown
3. Loading toast displayed
4. Fetches ALL data in parallel via Promise.all:
   - Entity masters: products, parties, accounts, expenses, etc.
   - Transactions: invoices, payments, journals, stockJournals
5. All queries filtered by userId (dataOwnerId || user.uid)
6. Rebuilds balances by scanning every transaction chronologically
7. Updates each entity's balance field
8. Success toast on completion
```

## Key Logic

- Opening balance + all transactions = closing balance
- Scans transactions in date order
- Debits increase some account types, credits increase others
- Updates the balance field on each entity document
- Non-destructive — can be run multiple times safely

## Important Notes

- Recalculation is SAFE to run multiple times — it's idempotent
- Uses RxDB for local data (not Firestore directly)
- Progress updates via toast notifications
- Full system recalc may take 30-60 seconds for large datasets
