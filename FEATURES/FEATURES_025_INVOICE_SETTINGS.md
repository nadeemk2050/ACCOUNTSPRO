# Feature 025: Invoice Settings & Image Storage

> **Purpose:** Configure invoice document appearance — header/footer images, company details,
> TRN, stamp scale, document headings. Images stored in Firebase Storage with Firestore metadata.

## Files Involved

| File | Role |
|------|------|
| `src/InvoiceSettingsModal.jsx` | Invoice settings configuration UI |
| `src/ImageStorageModal.jsx` | Image upload/management UI |
| `src/storageAsset.js` | Image resolution from Firebase Storage |

## Invoice Settings

**DB Collection:** `invoice_settings`

Configurable settings:
- Header image (company logo)
- Footer image
- Stamp image and scale
- Signature image
- Company name, address, TRN
- Document headings (per document type)
- Default document type layout

## Image Storage

**DB Collection:** `company_images`
**Storage:** Firebase Storage (`gs://cashshams.appspot.com`)

Features:
- Upload company images (headers, stamps, signatures, headings)
- Preview before saving
- Delete/replace images
- Image resolution via `resolveStoredImages()` from `./storageAsset`
- Metadata stored in Firestore for quick listing

## Data Flow

```
Upload Image → Firebase Storage → Firestore metadata (company_images)
                                        ↓
Document Generation → resolveStoredImages() → overlay on PDF
```

## Dependencies

- Firebase Storage
- Firebase Firestore
- jsPDF (for image overlay in document generation)
