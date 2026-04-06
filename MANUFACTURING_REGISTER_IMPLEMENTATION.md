# Manufacturing Register Implementation

## Overview
Added a Manufacturing Register (Stock Journal Register) to the application that shows all manufacturing/stock journal transactions with consumed and produced items, similar to the Purchase Register.

## What Was Added

### 1. **Manufacturing Register Data Aggregation** (Line ~4056-4120)
- Extended `getRegisterData()` function to handle `type === 'manufacturing'`
- Aggregates all stock journals within the selected date range
- Creates individual line items for each consumed and produced item
- Calculates running balances for both quantity and amount

**Data Structure:**
```javascript
{
  id: unique_id,
  date: journal_date,
  ref: reference_number,
  label: item_description (with emoji indicator),
  qty: quantity,
  amt: amount,
  balanceQty: running_quantity_balance,
  balanceAmt: running_amount_balance,
  type: 'consumed' | 'produced',
  debit: amount_for_consumed,
  credit: amount_for_produced
}
```

### 2. **SimpleListModal Enhancements** (Lines ~9163-9415)
Modified the `SimpleListModal` component to support manufacturing register display:

#### Parameters:
- Added `isMfgRegister = false` parameter to identify manufacturing register mode

#### Filter Options:
- When `isMfgRegister = true`, displays:
  - Consumed items count
  - Produced items count
  - Total consumed amount
  - Total produced amount
- When `isMfgRegister = false`, displays standard filters (debit/credit/balance)

#### Table Display:
**Manufacturing Register (isMfgRegister=true) columns:**
- Date
- Ref No
- Item
- Type (📤 Out for consumed, 📥 In for produced)
- Qty (quantity)
- Rate (calculated unit rate)
- Amount (total amount)
- Bal Qty (running balance quantity)
- Bal Amt (running balance amount)

**Standard Register columns:**
- Name
- Balance

#### Color Coding:
- Consumed items: Red background (bg-red-50/30)
- Produced items: Green background (bg-green-50/30)
- Type labels: Red for consumed (📤 Out), Green for produced (📥 In)
- Balance columns: Blue text (text-blue-700) for running totals

#### Export Options:
- Excel export includes all manufacturing register columns
- PDF export with proper table layout for manufacturing data

### 3. **Menu Integration** (Line ~4723)
Added "Manufacturing Register" button to "Other Reports" menu dropdown:
```javascript
<MenuButton
  icon={Zap}
  label="Manufacturing Register"
  onClick={() => { setActiveModal('manufacturing_register'); onMenuClick(); }}
  className="text-slate-600 hover:bg-slate-50 text-xs"
/>
```

### 4. **Modal Rendering** (Line ~5410)
Added SimpleListModal instance for manufacturing register:
```javascript
<SimpleListModal
  isOpen={activeModal === 'manufacturing_register'}
  onClose={() => setActiveModal(null)}
  onBack={handleModalBack}
  title="Manufacturing Register"
  dateRange={registerDateRange}
  onDateChange={setRegisterDateRange}
  {...getRegisterData('manufacturing')}
  currencySymbol={currencySymbol}
  isMfgRegister={true}
/>
```

## Features

### Date Range Filtering
- Users can select custom date ranges using the date picker
- Only stock journals within the selected period are displayed

### Search & Filter
- Search bar to filter by item name or reference number
- Filter toggles for:
  - All items
  - Consumed only
  - Produced only

### Summary Statistics
- Records count
- Total consumed quantity/amount
- Total produced quantity/amount
- Running balances

### Export Capabilities
- **Excel Export**: Full data with all columns including running balances
- **PDF Export**: Formatted table with professional layout

### Visual Hierarchy
- White modal with max-width max-w-6xl (wider than standard 4xl for more columns)
- Color-coded rows (red/green background)
- Bold amounts and quantities
- Clear emoji indicators (📤 for consumed, 📥 for produced)

## Column Explanations

| Column | Description |
|--------|-------------|
| Date | Transaction date of the stock journal |
| Ref No | Reference number assigned to the journal |
| Item | Product/item name with emoji indicator |
| Type | Consumed (📤 Out) or Produced (📥 In) |
| Qty | Quantity of the item |
| Rate | Unit rate (amount ÷ quantity) |
| Amount | Total amount (qty × rate) |
| Bal Qty | Running balance of quantity (starting from 0) |
| Bal Amt | Running balance of amount (starting from 0) |

## Usage

1. Open the application menu
2. Navigate to "Other Reports" → "Manufacturing Register"
3. Select date range (defaults to today's date)
4. Optionally filter by consumed/produced items or search by name
5. Download as PDF or Excel if needed

## Technical Details

### Performance Considerations
- Data aggregation is calculated on-demand when getRegisterData('manufacturing') is called
- Filtering happens in memory (fast for typical data volumes)
- Running balance calculations done sequentially during aggregation

### Data Dependencies
- Requires `stockJournals` array (loaded from Firebase)
- Requires `products` array for item name lookups
- Uses `registerDateRange` state for date filtering

### Backward Compatibility
- No changes to existing register types (party, capital, asset, expense)
- SimpleListModal remains fully compatible with standard registers
- Manufacturing register display is opt-in via `isMfgRegister` prop

## Future Enhancements

Possible improvements:
- Add lot-wise breakdown for manufacturing entries
- Include production cost analysis
- Add yield percentage calculations
- Create manufacturing summary by product
- Add drill-down to view stock journal details
