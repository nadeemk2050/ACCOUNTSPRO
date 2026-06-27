# Feature 011: Invoice PDF Generator

> **Purpose:** Generates professional PDF documents using jsPDF. Supports Tax Invoices,
> Packing Lists, Bills of Exchange, Bank Letters, and Accounting Vouchers.

## Files Involved

| File | Role |
|------|------|
| `src/invoiceGenerator.js` | All PDF generation logic |

## Key Functions

| Function | Output |
|----------|--------|
| `generateInvoicePDF()` | Tax Invoice with item grid, amounts, TRN |
| `generatePackingListPDF()` | Packing list format |
| `generateBillOfExchangePDF()` | Bill of Exchange document |
| `generateBankApplicationPDF()` | Bank application letter |
| `generateAccountingVoucherPDF()` | Accounting voucher format |
| `downloadInvoiceExcel()` | Excel export |
| `generateSelectedDocsPDF()` | Batch document generation |

## Helper Functions

| Helper | Purpose |
|--------|---------|
| `formatDate(dateStr)` | YYYY-MM-DD → DD-MM-YYYY |
| `drawCheckbox(doc, x, y, size, isChecked)` | Draw checkboxes on PDF |
| `drawDigitBoxes(doc, x, y, boxes, w, h, value)` | Draw digit boxes (cheque amounts) |
| Amount-to-words | Converts numbers to Arabic text (Dirhams & Fils) |

## Key Features

- Arabic numerals support
- Digit boxes for cheque amounts
- Checkboxes for document options
- Amount-to-words (Dirhams & Fils)
- Company header/footer images
- Stamp and signature overlay
- TRN display

## Dependencies

- `jspdf` ^3.0.4
- `jspdf-autotable` (table generation)
