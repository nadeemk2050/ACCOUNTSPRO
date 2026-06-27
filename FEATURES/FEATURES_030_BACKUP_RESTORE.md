# Feature 030: Backup & Restore

> **Purpose:** Company data backup and restore operations. Exports/imports all
> company data including transactions, master records, and settings.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | Backup/Restore UI (inline section) |

## Backup Process

1. User clicks "Backup" from Management Dashboard or settings
2. All data for the active company is collected:
   - All collections from `offline_records`
   - Company profile and settings
   - Invoice settings and images
3. Data is packaged into a downloadable format (JSON/zip)
4. File saved locally via browser download

## Restore Process

1. User clicks "Restore" and selects a backup file
2. File is parsed and validated
3. Data is written to local RxDB — replaces all existing data
4. User can trigger recalculation after restore
5. Data will sync to cloud on next sync cycle

## Important Notes

- Backup includes ALL collections (invoices, payments, parties, accounts, etc.)
- Restore is a full replacement of the company data
- Run recalculation after restore to ensure balances are correct
- Cloud sync will re-push restored data to Firestore
- Backup files are device-local — not stored in cloud automatically
