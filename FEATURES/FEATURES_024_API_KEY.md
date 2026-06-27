# Feature 024: API Key System

> **Purpose:** Generate and manage API keys for external integration with ACCPRO data.
> Supports key generation, retrieval, usage monitoring, and device tracking.

## Files Involved

| File | Role |
|------|------|
| `src/ApiKeyModal.jsx` | UI for API key management |
| `functions/index.js` | Cloud functions: `generateApiKey`, `getApiKey`, `getApiUsageDetails` |

## Key Props (ApiKeyModal)

- `isOpen`, `onClose`, `zIndex` (default 200)

## Key State

| State | Description |
|-------|-------------|
| `apiKey` | Current API key value |
| `loading` | Loading state |
| `copied` | Flash indicator after copy |
| `error` | Error message |
| `usageExpanded` | Toggle usage details section |
| `usageData` | Usage statistics |
| `usageLoading` | Usage data loading |

## Key Features

- Generate new API key via cloud function
- Copy to clipboard with visual feedback
- View usage statistics:
  - Request count
  - Device info (Monitor icon)
  - Database operations
  - Timestamps
  - Team members
  - Connection status (Wifi/WifiOff)
- Cloud functions handle key generation and usage tracking

## Dependencies

- Firebase Functions (`httpsCallable`)
- `getActiveCompanyId` from `./localDB`
