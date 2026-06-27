# Feature 017: Working Sheet (Spreadsheet)

> **Purpose:** jSpreadsheet-based spreadsheet editor with formula bar, auto-save,
> file management (save/load/delete/search), zoom, and selection statistics.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | WorkingSheetModal (inline component) |

## Key Features

- jSpreadsheet CE grid with formula support
- Formula bar (fx) for entering expressions
- Auto-save to local RxDB
- File management: save, load, delete, search
- Zoom in/out
- Selection statistics: sum, average, count
- Multiple sheets per company

## DB Collection

```
Collection: sheets (in offline_records with collectionName = "sheets")
```

## Dependencies

- `jspreadsheet-ce` ^4.2.1
- `jsuites` ^4.9.13
