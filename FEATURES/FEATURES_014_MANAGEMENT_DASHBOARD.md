# Feature 014: Management Dashboard

> **Purpose:** Full admin panel for company configuration, user management, system tools,
> and developer features. Accessed by the company owner/admin.

## Files Involved

| File | Role |
|------|------|
| `src/ManagementDashboard.jsx` | Main component |

## Tabs/Sections

| Tab | Features |
|-----|----------|
| **Dashboard** | Cash flow summary, system overview |
| **General Rules** | Auto-ref numbering config, invoice settings, defaults |
| **Company Profile** | Edit company name, address, TRN, financial year |
| **User Management** | Create/edit/delete sub-users with roles (owner, accountant, viewer) |
| **Developer Tools** | License key generation/approval, live registry, API usage stats |

## Key Callbacks (Props)

- `onRecalculateAll`, `onRecalculateStock`, `onRecalculateParties`, `onRecalculateAccounts`
- `onRecalculateExpenses`, `onRecalculateCapital`, `onRecalculateJumboBags`
- `onInstall`, `onBackup`, `onRestore`
- `onScan`, `onPurgeSoftDeleted`

## Key Features

- Sub-user CRUD with Firebase Auth (`createUserWithEmailAndPassword`)
- License key generation and approval
- Live registry viewer (`nadtally_live_registry` collection)
- API usage tracking and device info
- Company profile editing
- General rules configuration (ref formats, invoice settings)
- Recalculation triggers for all entity types
- Backup & restore buttons
- Import CustomersProfileModule for admin editing of parties

## DB Collections

- `users` (sub-user profiles)
- `nadtally_licenses` (license records)
- `nadtally_live_registry` (live sync tracking)
- Company profile data (inline in company document)
