# Feature 004: License Gate & Serial Key System

> **Purpose:** Protects the app with serial-key-based licensing. Supports online activation,
> offline grace period (365 days), SHA-256 password hashing, and educational mode fallback.

## Files Involved

| File | Role |
|------|------|
| `src/LicenseGate.jsx` | License activation UI and validation logic |
| `src/licenseFirebase.js` | Firebase REST API calls for license verification |

## How It Works

1. User enters a Serial Key and Password on the License Gate screen.
2. Password is hashed with SHA-256 before sending.
3. App calls Firebase REST API to query `nadtally_licenses` collection.
4. If valid: license details saved to localStorage, app proceeds.
5. If offline: checks localStorage for previously activated license with
   grace period of 365 days from last online verification.
6. Educational mode: fallback option for demo/trial access.

## Key Functions

### License Validation Flow
```
User enters serial + password
  → SHA-256(password)
  → Firebase REST GET: nadtally_licenses?filters
  → If match found → save to localStorage → grant access
  → If no match → show error
  → If network error → check localStorage grace period (365 days)
```

## Data Flow

```
nadtally_licenses collection (Firestore):
{
  serialKey: string,      // e.g., "ACCPRO-XXXX-XXXX"
  hashedPassword: string, // SHA-256 hash
  deviceId: string,
  activatedAt: timestamp,
  expiresAt: timestamp,
  isEducational: boolean
}
```

## Dependencies

- Firebase Firestore REST API (no SDK needed for license check)
- Web Crypto API (SHA-256 hashing)
- localStorage (offline grace period cache)

## Important Notes

- **Password hashing:** SHA-256 is done client-side before transmission.
- **Grace period:** 365 days from last successful online verification.
- **Educational mode:** Bypasses license check for demo/trial usage.
