# Feature 021: Loans & Advances Tracker

> **Purpose:** Tracks loans and advances from multi-split payment/receipt vouchers.
> Four types: Our Advance (OA), Their Advance (TA), Our Loan (OL), Their Loan (TL).

## Files Involved

| File | Role |
|------|------|
| `src/LoansAdvancesRegister.jsx` | Main component |

## Key Props

- `isOpen`, `onClose`, `onBack`, `user`, `dataOwnerId`
- `parties`, `currencySymbol`, `zIndex`

## Loan/Advance Types

| Type Code | Label | Color | Description |
|-----------|-------|-------|-------------|
| `OA` | Our Advance | Blue | Money we gave as advance |
| `TA` | Their Advance | Purple | Money received as advance |
| `OL` | Our Loan | Amber | Money we lent |
| `TL` | Their Loan | Rose | Money borrowed |

## Key State

| State | Description |
|-------|-------------|
| `rows` | Aggregated loan/advance rows |
| `loading` | Loading state |
| `statusFilter` | Filter by type or 'all' |
| `selectedRow` | Selected row for mini-ledger panel |

## Data Sources

- Payment vouchers (`payments` collection) with split tags
- Each split in a payment/receipt can have a `tag` field:
  `"OA"`, `"TA"`, `"OL"`, `"TL"`
- Data aggregated by party + tag type

## Key Features

- Aggregates loan/advance balances from voucher splits
- Mini-ledger panel for selected row (shows individual transactions)
- Filter by type (OA/TA/OL/TL)
- Due date tracking
- Balance display per type per party
- Formatting: 3-decimal numbers, DD-MMM-YYYY dates
