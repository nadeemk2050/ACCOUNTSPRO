# Feature 022: Cloud Functions Backend

> **Purpose:** Firebase Cloud Functions providing server-side logic for party statements,
> user management, transaction deletion, stock recalculation, and API key management.

## Files Involved

| File | Role |
|------|------|
| `functions/index.js` | All cloud function definitions |
| `functions/package.json` | Dependencies |

## Cloud Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `getPartyStatement` | HTTPS Callable | Full ledger with opening balance, all invoices, payments, journal vouchers for a party/account |
| `createSubUser` | HTTPS Callable | Create team member with role (owner only) |
| `updateSubUser` | HTTPS Callable | Update team member role/permissions |
| `deleteSubUser` | HTTPS Callable | Delete team member (owner only) |
| `deleteTransaction` | HTTPS Callable | Soft-delete with balance reversal across invoices, payments, journals, stock journals; bag cleanup for manufacturing |
| `recalculateStock` | HTTPS Callable | Server-side stock recalculation from opening + invoices + stock journals |
| `generateApiKey` | HTTPS Callable | Generate new API key for external access |
| `getApiKey` | HTTPS Callable | Retrieve existing API key |
| `getApiUsageDetails` | HTTPS Callable | Get API usage statistics with device info |

## Key Features

- All functions use `onCall` (HTTPS callable) for direct app integration
- Authentication: most functions check `context.auth` for authorization
- Role-based access control (owner vs accountant vs viewer)
- Transaction deletion reverses balances on affected entities
- API key generation with usage tracking
- Party statement returns pre-computed ledger with opening balance

## Dependencies

- `firebase-functions` SDK
- `firebase-admin` SDK
- Various internal helper modules in `functions/` directory
