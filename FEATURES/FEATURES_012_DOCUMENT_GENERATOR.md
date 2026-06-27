# Feature 012: Document Generator V2

> **Purpose:** Full-featured document generation UI with print options — single/selected docs,
> header/stamp/signature overlay, company image resolution from storage, document type selection.

## Files Involved

| File | Role |
|------|------|
| `src/DocumentGeneratorV2.jsx` | Main UI component |
| `src/storageAsset.js` | Image resolution from Firebase Storage |
| `src/invoiceGenerator.js` | PDF generation backend |

## Key Props

- `isOpen`, `onClose`, `data` (full transaction data)
- `type`: `'sales'` | `'purchase'` | `'payment'` | `'receipt'`
- `parties`, `products`, `accounts`, `companyProfile`, `dataOwnerId`

## Document Types

- Tax Invoice
- Packing List
- Bill of Exchange
- Bank Application
- Accounting Voucher

## Key Features

- Select single or multiple documents
- Preview before printing
- Download as PDF
- Print directly
- Company image overlay (header/stamp/signature)
- Image resolution from Firebase Storage via `resolveStoredImages`
- Company profile data injection

## Dependencies

- jsPDF
- jsPDF-AutoTable
- Firebase Storage (for company images)
