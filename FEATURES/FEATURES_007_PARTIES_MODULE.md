# Feature 007: Parties (Customers / Suppliers) Profile Module

> **Purpose:** Full CRUD for customer and supplier profiles with comprehensive fields
> including contacts, addresses, banking, tax info, and opening balances.

## Files Involved

| File | Role |
|------|------|
| `src/CustomersProfileModule.jsx` | Main component |
| `src/rxfs.js` | Local RxDB writes |

## DB Collection

```
Collection: parties (in offline_records with collectionName = "parties")

Document fields:
- name, company, email, mobile, WhatsApp
- address (full address fields)
- ID/passport details
- partners (multi-partner support)
- openingBalance, creditPeriod
- TRN (Tax Registration Number)
- bankAccounts (multi-bank support)
- createdAt, updatedAt, createdBy
```

## Key Features

- Complete party profile management
- Opening balance entry
- Credit period tracking
- Multi-bank account storage
- TRN validation
- Search and filter
