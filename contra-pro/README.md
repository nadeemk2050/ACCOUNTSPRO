# Contra Pro (Kotlin Android)

Contra Pro is a focused voucher-entry app for Contra vouchers only. It connects to your main AccPro backend using your Base URL + API Key.

## What this app does

- Opens directly to Contra voucher entry.
- Pulls Cash/Bank account list from API and stores it on device.
- Refreshes accounts on app open, manual refresh, and periodic background sync.
- Saves vouchers locally first and pushes to main app API immediately.
- Retries failed or pending sync automatically.
- Provides History page with columns:
  - Date
  - Ref No
  - Description
  - Amount
  - Synced status

## Expected API endpoints

The app expects these endpoints under your Base URL:

- `GET /contra/accounts`
  - Header: `x-api-key: <key>`
  - Response example:
    ```json
    [
      {"id":"acc_1","name":"Cash A","type":"cash","updatedAt":1714730000000}
    ]
    ```

- `POST /contra/vouchers`
  - Header: `x-api-key: <key>`
  - Body example:
    ```json
    {
      "dateMillis": 1714730000000,
      "refNo": "CV-1001",
      "description": "Contra entry",
      "amount": 5000,
      "fromAccountId": "acc_1",
      "toAccountId": "acc_2"
    }
    ```
  - Response example:
    ```json
    {"voucherId":"vch_123"}
    ```

## Build locally

1. Open this folder in Android Studio: `contra-pro`
2. Ensure Android SDK is installed.
3. Run:
   - `gradle :app:assembleDebug`
4. APK output:
   - `app/build/outputs/apk/debug/app-debug.apk`

## GitHub APK download flow

A workflow is included at `.github/workflows/android-debug-apk.yml`.

On every push to `main` (or manual run), GitHub Actions:

- Builds debug APK
- Uploads it as workflow artifact `contra-pro-debug-apk`

Download from:
- GitHub repo -> Actions -> latest run -> Artifacts -> `contra-pro-debug-apk`
