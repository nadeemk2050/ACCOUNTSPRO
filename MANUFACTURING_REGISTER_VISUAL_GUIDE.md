# Manufacturing Register - Visual Guide

## Menu Navigation

```
┌─────────────────────────────────────────┐
│          ACCNAD Application             │
├─────────────────────────────────────────┤
│  ☰ Menu                                 │
│  ├─ Masters                             │
│  ├─ Transactions                        │
│  ├─ Inventory                           │
│  └─ Reports ◄─────────────────┐        │
│     ├─ Receivables            │        │
│     ├─ Payables               │        │
│     ├─ Account Balances        │        │
│     ├─ Other Reports          │◄───┐  │
│     │  ├─ Capital Register    │    │  │
│     │  ├─ Assets Register     │    │  │
│     │  ├─ Expenses Register   │    │  │
│     │  ├─ Manufacturing ⚡    │◄──┴──┤
│     │  │  Register (NEW!)     │    │  │
│     │  ├─ Stock Inventory     │    │  │
│     │  └─ ...                 │    │  │
│     └─ View All Reports       │    │  │
└─────────────────────────────────────────┘
```

## Manufacturing Register Modal Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Manufacturing Register                                  X    <-  |
├──────────────────────────────────────────────────────────────────┤
│  Date Filter Section:                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  From: [2024-01-01] ◀─┐  To: [2024-01-31] ◀─────┐       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Summary Strip (Clickable Filters):                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Records: 24 | Consumed: 8 (2,500) | Produced: 8 (2,800)│   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Search & Export Toolbar:                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 🔍 Search...        [PDF] [EXCEL]                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Data Table (Scrollable):                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Date  │ Ref   │ Item  │ Type │ Qty  │ Rate │ Amt │Balance│   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 1-15  │MFG-01 │Cotton │📤Out │100.00│50.00│5000 │-100.00│   │
│  │ 1-15  │MFG-01 │Shirt  │📥In  │80.00 │65.00│5200 │-20.00 │   │
│  │ 1-16  │MFG-02 │Thread │📤Out │200.00│2.50│500  │-220.00│   │
│  │ 1-16  │MFG-02 │Button │📤Out │500.00│0.10│50   │-720.00│   │
│  │ 1-16  │MFG-02 │Shirt  │📥In  │90.00 │60.00│5400 │ -330.00│  │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ [Scroll for more entries...]                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Color Coding System

```
Item Type Color Legend:

Consumed Items Row:
┌──────────────────────────────────────────────┐
│ 🔴 Light Red Background (bg-red-50/30)      │
│ 📤 OUT Indicator (Emoji + Text)             │
│ Amount shown in RED text (text-red-600)      │
│ Example: Cotton consumed from production    │
└──────────────────────────────────────────────┘

Produced Items Row:
┌──────────────────────────────────────────────┐
│ 🟢 Light Green Background (bg-green-50/30)  │
│ 📥 IN Indicator (Emoji + Text)              │
│ Amount shown in GREEN text (text-green-600) │
│ Example: Finished shirts created            │
└──────────────────────────────────────────────┘

Running Balance Columns:
┌──────────────────────────────────────────────┐
│ 🔵 Running totals in BLUE text (text-blue)  │
│ Bold font for emphasis (font-bold)           │
│ Positive = Net production profit             │
│ Negative = Net production loss               │
└──────────────────────────────────────────────┘
```

## Data Flow Diagram

```
Stock Journal Entry Created
         │
         ▼
┌─────────────────────┐
│  Stock Journal DB   │
│  ID: MFG-001        │
│  Date: 2024-01-15   │
│  Consumed: [...]    │
│  Produced: [...]    │
└─────────────────────┘
         │
         ▼
Manufacturing Register
      Clicked
         │
         ▼
┌─────────────────────┐
│  getRegisterData()   │
│  type='manufacturing'│
└─────────────────────┘
         │
         ▼
Filter by Date Range
         │
         ▼
Sort by Date (ASC)
         │
         ▼
┌──────────────────────────────┐
│ For Each Journal:            │
│ • Iterate consumed items     │
│ • Iterate produced items     │
│ • Update running balance     │
│ • Create entry records       │
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Return Aggregated Data:      │
│ [{                           │
│   date, ref, label,          │
│   qty, amt, rate,            │
│   balanceQty, balanceAmt,    │
│   type: 'consumed|produced'  │
│ }, ...]                      │
└──────────────────────────────┘
         │
         ▼
SimpleListModal
(isMfgRegister=true)
         │
         ▼
Render Manufacturing View
```

## Filter Interaction Diagram

```
                    Manufacturing Register Modal
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         All (Default)    Consumed (Red)  Produced (Green)
              │               │               │
      Show All Entries   Show Only      Show Only
      from Both Types    Consumed       Produced
              │               │               │
              └───────────────┼───────────────┘
                              │
                    Display Filtered Data
```

## Column Relationships

```
Calculation Flow:

QTY × RATE = AMOUNT

Example:
┌──────────────────────────────────────────┐
│ Qty:       100 units                     │
│ Rate:      $50 per unit                  │
│ Amount:    100 × 50 = $5,000             │
│                                          │
│ Running Balance (from top to bottom):    │
│ Entry 1 (Consumed -100): -$5,000         │
│ Entry 2 (Produced +80):  +$4,000 (net)   │
│ Entry 3 (Consumed -50):  -$2,500 (net)   │
└──────────────────────────────────────────┘
```

## Export Output Format

### Excel Export (9 Columns)
```
┌─────────┬──────────┬──────────┬──────────┬─────┬──────┬──────────┬─────────┬─────────┐
│ Date    │ Ref No   │ Item     │ Type     │ Qty │ Rate │ Amount   │ Bal Qty │ Bal Amt │
├─────────┼──────────┼──────────┼──────────┼─────┼──────┼──────────┼─────────┼─────────┤
│ 1-15-24 │ MFG-001  │ Cotton   │ Consumed │ 100 │ 50   │ 5000     │ -100    │ -5000   │
│ 1-15-24 │ MFG-001  │ Shirt    │ Produced │ 80  │ 62.5 │ 5000     │ -20     │ 0       │
│ ...     │ ...      │ ...      │ ...      │ ... │ ...  │ ...      │ ...     │ ...     │
└─────────┴──────────┴──────────┴──────────┴─────┴──────┴──────────┴─────────┴─────────┘
```

### PDF Export
```
┌────────────────────────────────────────────────────────────┐
│                 Manufacturing Register                     │
│              Report for: Jan 1, 2024 to Jan 31, 2024       │
├────────────────────────────────────────────────────────────┤
│ Date  │ Ref  │ Item    │ Type     │ Qty    │ Rate │ Amount │
├────────────────────────────────────────────────────────────┤
│ 1/15  │ MFG  │ Cotton  │Consumed  │ 100.00 │  50  │ 5000   │
│ 1/15  │ MFG  │ Shirt   │ Produced │  80.00 │  62.5│ 5000   │
│ TOTAL │      │         │          │        │      │ 5000   │
└────────────────────────────────────────────────────────────┘
```

## User Interaction Flow

```
User Story: "I want to see all manufacturing activity for January"

1. Click Menu
   ▼
2. Navigate to Reports → Other Reports
   ▼
3. Click "Manufacturing Register"
   ▼
4. Modal opens with default date (today)
   ▼
5. Change "From" to 2024-01-01
   ▼
6. Change "To" to 2024-01-31
   ▼
7. System updates display with filtered data
   ▼
8. Review summary: "24 records, 8 consumed, 8 produced"
   ▼
9. Optional: Click filter to show only "Consumed" or "Produced"
   ▼
10. Optional: Search for specific item name
    ▼
11. Optional: Download as Excel or PDF for archiving
    ▼
12. Click Close or navigate to another screen
```

## Key Metrics Displayed

```
Summary Strip shows:

┌─────────────────────────────────────────────────────────┐
│ # Records │ Consumed Count & Total │ Produced Count & Total
│           │                        │
│    24     │    8 items ($2,500)    │   8 items ($2,800)
│           │    (Click to filter)   │   (Click to filter)
└─────────────────────────────────────────────────────────┘

Table Running Balances show:

Bal Qty: Net quantity (Produced - Consumed so far)
Bal Amt: Net value (Produced value - Consumed value so far)

Positive Balance = Production surplus (good)
Negative Balance = Production deficit (need more input)
```

## Example Scenario

```
Manufacturing Register for January 2024:

Journal 1 (Jan 1):
  - Consume 100 Cotton @ $5 = $500 ────► Bal: -100 units, -$500
  - Produce 80 Shirts @ $8 = $640 ────► Bal: -20 units, +$140

Journal 2 (Jan 5):
  - Consume 50 Thread @ $1 = $50 ─────► Bal: -70 units, +$90
  - Produce 60 Pants @ $10 = $600 ────► Bal: -10 units, +$690

Journal 3 (Jan 10):
  - Consume 40 Buttons @ $0.50 = $20 ► Bal: -50 units, +$670
  - Produce 45 Jackets @ $15 = $675 ──► Bal: -5 units, +$1,345

By Jan 31: We have a net production of -5 units but +$1,345 profit
```

This visual guide should help users quickly understand and navigate the Manufacturing Register feature!
