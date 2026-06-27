# Feature 028: Order Vouchers Dashboard

> **Purpose:** UI dashboard for 8 order types — mostly placeholder/coming soon.
> Central hub for managing orders, quotations, delivery notes, and requests.

## Files Involved

| File | Role |
|------|------|
| `src/OrderVouchersDashboard.jsx` | Main component |

## Props

- `onClose` — close handler

## Order Types (8 total)

| # | Type | Icon | Color | Status |
|---|------|------|-------|--------|
| 1 | Purchase Order | ShoppingBag | Blue | Active |
| 2 | Quotation | FileText | Orange | Active |
| 3 | Sales Order | ShoppingBag | Green | Active |
| 4 | Claim Debit Request | ArrowRightLeft | Red | Active |
| 5 | Delivery Note/Challan | Truck | Purple | Active |
| 6 | Rejection Out | Package | Red | Active |
| 7 | Rejection In | Package | Green | Active |
| 8 | Material Request Internal | FileText | Slate | Active |

## UI

- Full-screen fixed overlay with:
  - Header with icon + title + close button (X)
  - Grid of order type cards with icons
  - Color-coded by type
- Keyboard navigation support

## Important Notes

- Most order types are placeholder/UI shells — actual CRUD logic may not be fully implemented
- The dashboard serves as a navigation hub for future order management features
