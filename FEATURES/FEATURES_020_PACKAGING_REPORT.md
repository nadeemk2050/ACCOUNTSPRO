# Feature 020: Packaging Smart Report

> **Purpose:** Comprehensive packaging analytics — jumbo bag inward/outward,
> manufacturing register, ready stock tracking, reusable bag management,
> orphan bag detection, deep analysis view.

## Files Involved

| File | Role |
|------|------|
| `src/PackagingSmartReportModal.jsx` | Main component |

## Key Features

- Jumbo bag inward tracking (bags received)
- Jumbo bag outward tracking (bags dispatched/sold)
- Manufacturing register interface
- Ready stock tracking for packaged products
- Reusable bag management
- Orphan bag detection (bags with missing source/sale info)
- Deep analysis view for detailed audit

## DB Collections

- `jumbo_bags` (bag-level inventory)
- `stock_journals` (manufacturing/production records)
- `invoices` (sales containing bag data)
