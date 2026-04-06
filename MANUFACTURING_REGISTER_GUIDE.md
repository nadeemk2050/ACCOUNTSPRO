# Manufacturing Register - Quick Start Guide

## Accessing Manufacturing Register

**Menu Path:** Reports → Other Reports → Manufacturing Register

**Keyboard Shortcut:** None (can be added via hotkey handler if needed)

## What You'll See

A comprehensive table showing all manufacturing/stock journal entries with:

```
Date | Ref No | Item | Type | Qty | Rate | Amount | Bal Qty | Bal Amt
```

### Example Row:
```
2024-01-15 | MFG-001 | Raw Cotton (📤 Consumed) | 📤 Out | 100.00 | 50.00 | 5,000.00 | -100.00 | -5,000.00
2024-01-15 | MFG-001 | Finished Shirt (📥 Produced) | 📥 In | 80.00 | 65.00 | 5,200.00 | -20.00 | 200.00
```

## Features Available

### 1. **Date Range Selection**
- Default: Today's date
- Custom range: Select "From" and "To" dates
- Automatically recalculates all entries

### 2. **Filtering Options**
- **All**: Show all consumed and produced items
- **Consumed (📤)**: Show only items consumed in production
- **Produced (📥)**: Show only items produced/created

### 3. **Search**
- Type item name to filter results
- Search works across all visible columns

### 4. **Summary Statistics**
Displayed in the toolbar:
- **Records**: Total number of line items
- **Consumed**: Count and total amount of consumed items (red)
- **Produced**: Count and total amount of produced items (green)

### 5. **Export Options**

#### Download Excel
- Includes all columns with full precision
- Suitable for detailed analysis in spreadsheet software

#### Download PDF
- Professional formatted table
- Suitable for printing or archiving
- Includes date range information

## Understanding the Columns

| Column | What It Shows |
|--------|---------------|
| **Date** | When the manufacturing entry was recorded |
| **Ref No** | Reference number (usually "MFG" followed by entry number) |
| **Item** | Product name with type indicator icon |
| **Type** | 📤 Out (Consumed) or 📥 In (Produced) |
| **Qty** | How many units of this item |
| **Rate** | Price per unit |
| **Amount** | Total value (Qty × Rate) |
| **Bal Qty** | Running total of quantity (positive for net production) |
| **Bal Amt** | Running total of value (cumulative profit/loss) |

## Color Coding

- **Red rows** = Items consumed/used
- **Green rows** = Items produced/created
- **Blue numbers** = Running balance totals
- **Bold numbers** = Key values (quantities and amounts)

## Common Tasks

### View Only This Month's Production
1. Set "From" date to 1st of month
2. Set "To" date to today
3. Results update automatically

### Find Specific Product
1. Type product name in search box
2. See all entries for that product

### Check Production Efficiency
1. Look at running balance columns
2. If Bal Amt is increasing = profitable period
3. If Bal Amt is decreasing = loss-making period

### Export for Accounting Review
1. Select desired date range
2. Click Excel icon (green)
3. Use in spreadsheet for further analysis

## Tips & Tricks

✅ **Do:**
- Use date filters to focus on specific production periods
- Export monthly data for records
- Use running balance columns to track cumulative performance

❌ **Don't:**
- Edit exported files as source of truth (always refer to app for updates)
- Assume balances are profit/loss (they're production value only)

## Troubleshooting

**Q: No entries showing?**
- Check date range - manufacturing entries may be outside selected dates
- Verify stock journals exist in the database

**Q: Running balances seem wrong?**
- Balances are sorted by date - verify entries are in chronological order
- Balances reset for each new date range selected

**Q: Can't find specific item?**
- Use exact item name or partial name
- Check filters aren't hiding the item type

## Related Features

- **Stock Journal Entry**: Create new manufacturing entries
- **Stock Inventory**: View current stock levels
- **Ledger View**: See detailed journal entry information
- **Financial Reports**: View production cost analysis
