# Feature 029: User Manual System

> **Purpose:** In-app user manual loaded from Firestore (system_docs collection)
> with keyboard shortcuts guide and static HTML content.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | UserManualModal (inline component) |
| `src/UserManualModal.jsx` | (may exist as standalone) |

## DB Collection

```
Collection: system_docs
- Stores HTML content for user manual pages
- Versioned documentation content
```

## Key Features

- HTML content rendered in-app
- Keyboard shortcuts guide (F1 for help)
- Loaded from Firestore for updatable documentation
- Cached locally for offline access
- Company-specific documentation content

## Content Types

- Getting Started guide
- Voucher entry instructions
- Register navigation guide
- Keyboard shortcuts reference
- Settings and configuration guide
