# Feature 023: QuickAccPro Companion App

> **Purpose:** Lightweight standalone React SPA that connects to main ACCPRO
> via REST API. Designed for cashiers/team members who only need basic
> voucher entry and daybook viewing.

## Files Involved (in `quickaccpro/`)

| File | Role |
|------|------|
| `src/api.js` | REST API client — all backend communication |
| `src/components/Dashboard.jsx` | Main dashboard with favorite balances |
| `src/components/DaybookLive.jsx` | Real-time transaction feed with filters |
| `src/components/CashierVoucher.jsx` | Create/edit Payment/Receipt/Contra vouchers |
| `src/components/CashBankRegister.jsx` | Cash/bank account list with balances |
| `src/components/ApiKeyLogin.jsx` | Login via API key |
| `src/components/SubLogin.jsx` | Team member selection after API auth |
| `src/components/Layout.jsx` | App layout shell |

## Architecture

```
QuickAccPro (React SPA)
    ↓ REST API
https://cashshams.web.app/accproApi (Cloud Function)
    ↓
Main ACCPRO Firebase (Firestore + Auth)
```

## Key Features

- API key authentication (no Firebase SDK needed)
- Sub-user login with role selection
- Real-time daybook with filters, date modes, pagination
- Cashier voucher creation with searchable selects
- Auto-ref number generation
- Local caching for performance
- PDF download and share from daybook
- Responsive design for mobile/desktop

## Data Flow

```
User Action → api.js REST call → Cloud Function → Firestore
                                              → Response back to UI
```

## Version

- Current: v1.6.0
- Standalone deployment (separate from main ACCPRO build)
