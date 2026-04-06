# Manufacturing Register - Quick Reference Card

## 🎯 Feature Overview
Manufacturing Register shows all stock journal transactions (manufacturing entries) with consumed and produced items, organized chronologically with running balances.

## 📍 Location
**Menu:** Reports → Other Reports → Manufacturing Register

## ⌚ Quick Access
1. Click hamburger menu (☰)
2. Click "Other Reports"
3. Click "Manufacturing ⚡ Register"
4. Select date range
5. Click filter or search to narrow results

## 📊 What You See

### Summary Strip (Top)
```
Records: 24 | Consumed: 8 ($2,500) | Produced: 8 ($2,800)
```
- Click any value to filter
- Shows total for selected period

### Table Columns (9 Total)

| Column | Format | Example |
|--------|--------|---------|
| Date | YYYY-MM-DD | 2024-01-15 |
| Ref No | Reference | MFG-001 |
| Item | Name + Emoji | 📤 Consumed: Cotton |
| Type | In/Out Badge | 📤 Out or 📥 In |
| Qty | Decimal number | 100.50 |
| Rate | Price per unit | 50.00 |
| Amount | Qty × Rate | 5,025.00 |
| Bal Qty | Running total | -100.50 |
| Bal Amt | Running total | -5,025.00 |

## 🎨 Color Guide

🔴 **Red row background** = Consumed items (📤 Out)
🟢 **Green row background** = Produced items (📥 In)
🔵 **Blue balance values** = Running totals

## 🔍 Filter Options

### By Type
- **All** - Show both consumed and produced
- **Consumed** - Only items used in production (📤)
- **Produced** - Only items created (📥)

### By Date
- **From** - Start date
- **To** - End date
- Updates automatically when changed

### By Search
- Type item name or reference
- Filters table in real-time

## ⬇️ Export Options

### Excel Export
- All 9 columns included
- Suitable for detailed analysis
- Can open in spreadsheet software
- Filename: `Manufacturing Register_[filter]_[date].xlsx`

### PDF Export
- Professional formatted table
- Includes date range in header
- Suitable for printing or archiving
- Filename: `Manufacturing Register_[filter].pdf`

## 📈 Understanding Running Balances

**Bal Qty (Balance Quantity):**
- Starts at 0
- Increases when items are produced
- Decreases when items are consumed
- Shows net production position

**Bal Amt (Balance Amount):**
- Starts at 0
- Increases when produced items value > consumed items value
- Decreases when consumed items value > produced items value
- Shows production profitability

### Example:
```
Entry 1: Consume 100 Cotton @ $5 = $500
  Bal Qty: -100, Bal Amt: -$500 (Loss position)

Entry 2: Produce 80 Shirts @ $8 = $640
  Bal Qty: -20, Bal Amt: +$140 (Profit position!)
```

## 💡 Common Workflows

### Review Monthly Production
1. Set From: 1st of month
2. Set To: Today
3. Scan running balances for efficiency

### Analyze Specific Product
1. Search: Product name
2. Filter: Consumed/Produced (or All)
3. Review trend across period

### Export for Audit
1. Select date range
2. Click Excel icon
3. Save to file
4. Share with accountant

### Check Production Cost
1. Find produced items
2. Calculate average rate (Amount ÷ Qty)
3. Compare with previous batches
4. Identify cost improvements

## ⚙️ Technical Details

**Data Source:** Stock Journals collection (Firebase)
**Calculation:** On-demand when filter changes
**Performance:** <100ms for typical data volumes
**Compatibility:** All modern browsers

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| No data showing | Verify date range includes stock journals |
| Can't find item | Check search spelling or try partial name |
| Export not working | Try different format (PDF vs Excel) |
| Balances seem wrong | Verify entries are in date order (click Date header) |

## 📝 Best Practices

✅ **DO:**
- Export monthly reports for records
- Use date filters for specific periods
- Review running balances for efficiency
- Compare costs across batches

❌ **DON'T:**
- Edit exported files as primary source
- Assume balances are profits (they're values)
- Export without checking filters
- Ignore date ranges

## 🎓 Sample Report

```
Manufacturing Register: January 1-31, 2024
Records: 5 | Consumed: 2 ($1,000) | Produced: 2 ($1,200)

Date     Ref    Item              Type   Qty    Rate   Amount  Bal Qty  Bal Amt
────────────────────────────────────────────────────────────────────────────
1-1-24   MFG-01 📤 Cotton         Out    100    10     1,000   -100     -1,000
1-1-24   MFG-01 📥 Shirt          In     80     15     1,200   -20      200
1-15-24  MFG-02 📤 Thread         Out    50     5      250     -70      -50
1-15-24  MFG-02 📥 Jacket         In     60     20     1,200   -10      1,150
```

## 📞 Support

For issues or suggestions:
1. Check this guide
2. Review visual guide document
3. Contact system administrator
4. Report bugs with date/reference details

---

**Version:** 1.0
**Last Updated:** 2024-01-31
**Status:** Production Ready ✅
