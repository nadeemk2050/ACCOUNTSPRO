# Feature 015: Cash Flow Dashboard

> **Purpose:** Visual cash flow analysis with Recharts — 30-day incoming/outgoing trends,
> bar charts for sources/destinations, summary cards.

## Files Involved

| File | Role |
|------|------|
| `src/CashFlowDashboard.jsx` | Main component |

## Key Props

- `invoices`, `payments`, `journalVouchers`
- `dashboardDate`, `currencySymbol`
- `accounts`, `parties`, `expenses`, `incomeAccounts`
- `isLightVariant`

## Charts

| Chart | Type | Description |
|-------|------|-------------|
| Cash Flow Trend | Area Chart (Recharts) | 30-day incoming vs outgoing |
| Sources | Bar Chart | Top incoming sources |
| Destinations | Bar Chart | Top outgoing destinations |

## Summary Cards

- Total Incoming (30 days)
- Total Outgoing (30 days)
- Net Flow
- Wallet balance

## Data Processing

- `safeNum(v)` helper for number safety
- Processes invoices + payments data via `useMemo`
- Groups by date for 30-day trend
- Aggregates by source/destination for bar charts

## Dependencies

- `recharts` ^2.15.4 (AreaChart, BarChart, ResponsiveContainer, etc.)
- `lucide-react` icons (TrendingUp, TrendingDown, Wallet, etc.)
