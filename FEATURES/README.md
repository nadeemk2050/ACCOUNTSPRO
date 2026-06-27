# ACCPRO ELITE — Feature Documentation Vault

> **Purpose:** This directory contains detailed documentation of every major feature in ACCPRO.
> If any AI agent corrupts or breaks a feature in the future, provide the relevant file here
> as a reference to restore it to its correct working state.
>
> **Last Verified Working State:** Commit `8288b46` (tag: stable-sync)
> **App Version:** 2.6.8 | **Firebase Project:** cashshams

---

## Master Index

| # | Feature | File | Key Files Involved |
|---|---------|------|-------------------|
| 1 | **Live Sync Engine** | [FEATURES_001_LIVE_SYNC.md](./FEATURES_001_LIVE_SYNC.md) | `src/liveSync.js`, `src/realFirebase.js` |
| 2 | **Offline-First Local DB (RxDB)** | [FEATURES_002_RXDB_LOCAL_DB.md](./FEATURES_002_RXDB_LOCAL_DB.md) | `src/localDB.js`, `src/rxfs.js` |
| 3 | **Firebase Mock Layer** | [FEATURES_003_FIREBASE_MOCK.md](./FEATURES_003_FIREBASE_MOCK.md) | `src/rxfs.js`, `src/rxauth.js`, `vite.config.js` |
| 4 | **License Gate & Serial Key** | [FEATURES_004_LICENSE_GATE.md](./FEATURES_004_LICENSE_GATE.md) | `src/LicenseGate.jsx`, `src/licenseFirebase.js` |
| 5 | **Payment/Receipt/Contra Vouchers** | [FEATURES_005_VOUCHER_FINANCE.md](./FEATURES_005_VOUCHER_FINANCE.md) | `src/FinanceVoucherV2.jsx` |
| 6 | **Sales/Purchase Invoices** | [FEATURES_006_INVENTORY_VOUCHER.md](./FEATURES_006_INVENTORY_VOUCHER.md) | `src/InventoryVoucherV2.jsx` |
| 7 | **Parties (Customers/Suppliers)** | [FEATURES_007_PARTIES_MODULE.md](./FEATURES_007_PARTIES_MODULE.md) | `src/CustomersProfileModule.jsx` |
| 8 | **Accounts & Ledger Management** | [FEATURES_008_ACCOUNTS_LEDGER.md](./FEATURES_008_ACCOUNTS_LEDGER.md) | `App.jsx` (accounts section), `src/LedgerModal.jsx` |
| 9 | **Day Book & 22 Registers** | [FEATURES_009_REGISTERS.md](./FEATURES_009_REGISTERS.md) | `src/ReportsV2.jsx`, `src/RegistersDashboard.jsx` |
| 10 | **Ledger Modal (Unified Viewer)** | [FEATURES_010_LEDGER_MODAL.md](./FEATURES_010_LEDGER_MODAL.md) | `src/LedgerModal.jsx` |
| 11 | **Invoice PDF Generator** | [FEATURES_011_INVOICE_PDF.md](./FEATURES_011_INVOICE_PDF.md) | `src/invoiceGenerator.js` |
| 12 | **Document Generator V2** | [FEATURES_012_DOCUMENT_GENERATOR.md](./FEATURES_012_DOCUMENT_GENERATOR.md) | `src/DocumentGeneratorV2.jsx` |
| 13 | **Main Dashboard** | [FEATURES_013_MAIN_DASHBOARD.md](./FEATURES_013_MAIN_DASHBOARD.md) | `App.jsx` (dashboard section) |
| 14 | **Management Dashboard** | [FEATURES_014_MANAGEMENT_DASHBOARD.md](./FEATURES_014_MANAGEMENT_DASHBOARD.md) | `src/ManagementDashboard.jsx` |
| 15 | **Cash Flow Dashboard** | [FEATURES_015_CASHFLOW_DASHBOARD.md](./FEATURES_015_CASHFLOW_DASHBOARD.md) | `src/CashFlowDashboard.jsx` |
| 16 | **Recalculation Engine** | [FEATURES_016_RECALCULATE.md](./FEATURES_016_RECALCULATE.md) | `src/recalculate.js` |
| 17 | **Working Sheet (Spreadsheet)** | [FEATURES_017_WORKING_SHEET.md](./FEATURES_017_WORKING_SHEET.md) | `App.jsx` (WorkingSheetModal) |
| 18 | **System Log / Audit Log** | [FEATURES_018_SYSTEM_LOG.md](./FEATURES_018_SYSTEM_LOG.md) | `src/SystemLogModal.jsx` |
| 19 | **Jumbo Bags / Bag-Wise Inventory** | [FEATURES_019_JUMBO_BAGS.md](./FEATURES_019_JUMBO_BAGS.md) | `src/BagWiseInventoryModal.jsx` |
| 20 | **Packaging Smart Report** | [FEATURES_020_PACKAGING_REPORT.md](./FEATURES_020_PACKAGING_REPORT.md) | `src/PackagingSmartReportModal.jsx` |
| 21 | **Loans & Advances Tracker** | [FEATURES_021_LOANS_ADVANCES.md](./FEATURES_021_LOANS_ADVANCES.md) | `src/LoansAdvancesRegister.jsx` |
| 22 | **Cloud Functions Backend** | [FEATURES_022_CLOUD_FUNCTIONS.md](./FEATURES_022_CLOUD_FUNCTIONS.md) | `functions/index.js` |
| 23 | **QuickAccPro Companion App** | [FEATURES_023_QUICK_ACCPRO.md](./FEATURES_023_QUICK_ACCPRO.md) | `quickaccpro/` (all files) |
| 24 | **API Key System** | [FEATURES_024_API_KEY.md](./FEATURES_024_API_KEY.md) | `src/ApiKeyModal.jsx`, cloud functions |
| 25 | **Invoice Settings & Image Storage** | [FEATURES_025_INVOICE_SETTINGS.md](./FEATURES_025_INVOICE_SETTINGS.md) | `src/InvoiceSettingsModal.jsx`, `src/ImageStorageModal.jsx` |
| 26 | **Products & Stock Management** | [FEATURES_026_PRODUCTS_STOCK.md](./FEATURES_026_PRODUCTS_STOCK.md) | `App.jsx` (products section) |
| 27 | **Manufacturing Journal** | [FEATURES_027_MANUFACTURING_JOURNAL.md](./FEATURES_027_MANUFACTURING_JOURNAL.md) | `stock_journals` collection logic |
| 28 | **Order Vouchers** | [FEATURES_028_ORDER_VOUCHERS.md](./FEATURES_028_ORDER_VOUCHERS.md) | `src/OrderVouchersDashboard.jsx` |
| 29 | **User Manual System** | [FEATURES_029_USER_MANUAL.md](./FEATURES_029_USER_MANUAL.md) | `src/UserManualModal.jsx`, `system_docs` collection |
| 30 | **Backup & Restore** | [FEATURES_030_BACKUP_RESTORE.md](./FEATURES_030_BACKUP_RESTORE.md) | `App.jsx` (backup section) |

---

## How to Use These Docs

1. **When a feature breaks:** Give the relevant `.md` file to your AI agent and say
   "Restore this feature to match the documented behavior exactly."
2. **When adding a new feature:** Create a new `FEATURES_###_NAME.md` file here.
3. **After verifying a fix:** Update the doc if the logic changed significantly.
4. **Git tag:** The working state is tagged as `stable-sync` — you can always
   `git checkout stable-sync` to restore the entire app.

---

## Database Collections Overview

| Collection | Where Used | Purpose |
|-----------|------------|---------|
| `invoices` | Sales/Purchase vouchers | Invoice transactions |
| `payments` | Finance vouchers | Payment/Receipt/Contra with splits |
| `journal_vouchers` | Journal entry | Adjustment entries |
| `stock_journals` | Manufacturing | Production/consumption journals |
| `jumbo_bags` | Bag inventory | Individual bag tracking |
| `parties` | Customer/Supplier | Party master profiles |
| `products` | Inventory | Stock item master |
| `accounts` | Chart of accounts | Cash/bank ledgers |
| `expenses` | Expense master | Expense categories |
| `income_accounts` | Income master | Income categories |
| `capital_accounts` | Capital master | Equity ledgers |
| `asset_accounts` | Asset master | Fixed asset ledgers |
| `units` | Units | Units of measure |
| `currencies` | Multi-currency | Exchange rates |
| `tax_rates` | Tax config | Tax settings |
| `users` | Team | User roles & profiles |
| `sheets` | Working sheet | Spreadsheet data |
| `company_images` | Documents | Headers, stamps, signatures |
| `invoice_settings` | Documents | Invoice layout config |
| `audit_logs` | System | Activity audit trail |
| `system_docs` | Manual | User manual content |
| `nadtally_licenses` | Licensing | Serial key records |
| `nadtally_live_registry` | Sync | Live sync company registry |
| `companies_live/{id}/records` | Sync | Per-company live sync data |

---

## Stable Git Reference

```
Commit: 8288b46
Tag:    (set as stable-sync)
Message: "feat: enforce unique account names and global duplicate voucher check validations"
Status:  Verified working — sync, vouchers, registers all functional
```
