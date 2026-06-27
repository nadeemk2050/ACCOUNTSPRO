# Feature 013: Main Dashboard

> **Purpose:** Welcome screen with quick action cards — Working Sheet, System Log,
> User Manual, Settings. The main landing page after company selection.

## Files Involved

| File | Role |
|------|------|
| `App.jsx` | Dashboard section (inline component) |

## Key Elements

- Welcome greeting with user name
- Quick action cards (Working Sheet, System Log, User Manual, Settings)
- Company name and financial year display
- Navigation shortcuts to all modules
- Dashboard stats (optional)

## Data Flow

- Reads company profile from active company data
- Reads user info from auth state
- No DB collections directly — pure UI navigation hub
