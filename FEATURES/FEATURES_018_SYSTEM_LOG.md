# Feature 018: System Log / Audit Log

> **Purpose:** Activity log viewer with search, date filtering, entity name resolution,
> soft-delete purge, and ghost cleanup.

## Files Involved

| File | Role |
|------|------|
| `src/SystemLogModal.jsx` | Main component |

## Key Props

- `isOpen`, `onClose`, `onBack`, `zIndex`
- `user`, `dataOwnerId`
- `onScan`, `onPurgeSoftDeleted`
- Data arrays: `accounts`, `parties`, `expenses`, `incomeAccounts`, `products`, `subUsers`, `staff`, `locations`

## Key State

| State | Description |
|-------|-------------|
| `allLogs` | All loaded log entries |
| `loading` | Loading state |
| `searchTerm` | Text search filter |
| `selectedLog` | Expanded log detail view |

## Key Features

- Activity log with timestamp, user, action, description
- Search across all log fields
- Date range filtering
- Entity name resolution (links log entries to actual entity names)
- Soft-delete purge (remove deleted items permanently)
- Ghost cleanup (remove orphaned log entries)
- Date parsing helper (`parseDate`) handles Timestamp, seconds, string, number formats

## DB Collection

```
Collection: audit_logs (in offline_records with collectionName = "audit_logs")
```

## Ghost Cleanup (useEffect)

On mount, performs temporary cleanup of ghost invoices — removes audit log entries
that reference deleted invoice documents.
