# 🛠️ Fix for Firebase Storage CORS Issue

You are seeing "Blocked by CORS policy" because your Firebase Storage bucket needs to be configured to allow your local environment (`http://localhost:5174`) to access images for the PDF generator.

### **Option 1: Using Google Cloud Shell (Easiest)**
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click the **Google Cloud Icon** (terminal icon) in the top right to open **Cloud Shell**.
3. In the terminal that opens, copy and paste this command to create a config file:
   ```bash
   echo '[{"origin": ["*"],"method": ["GET"],"maxAgeSeconds": 3600}]' > cors.json
   ```
4. Run this command to apply the fix to your bucket:
   ```bash
   gsutil cors set cors.json gs://accnad-8a7d3.firebasestorage.app
   ```

### **Option 2: Manual Fix via GCP Console**
1. Go to the [Google Cloud Storage Browser](https://console.cloud.google.com/storage/browser).
2. Find your bucket: `accnad-8a7d3.firebasestorage.app`.
3. Open the **Cloud Shell** (top right terminal icon).
4. Run the same commands as in Option 1.

---

### **Why this is needed:**
Browsers block "cross-origin" requests for security. When the PDF generator tries to "read" the pixels of your header image to put them in the PDF, the browser asks the Firebase server: *"Is localhost:5174 allowed to see this?"*. By default, Firebase says no. The steps above change that setting to "Yes".

**After running these steps, refresh your app and try generating the invoice again!**
