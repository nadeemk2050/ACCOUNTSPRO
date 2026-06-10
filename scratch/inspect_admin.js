const admin = require('firebase-admin');

// Initialize with default credentials or application default
if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();

async function run() {
    try {
        console.log("Fetching companies_live...");
        const snap = await db.collection('companies_live').get();
        console.log(`Found ${snap.size} companies.`);
        snap.forEach(doc => {
            console.log(`Company ID: ${doc.id}, Name: ${doc.data().name}`);
        });
    } catch (e) {
        console.error("Error:", e.message);
    }
    process.exit(0);
}

run();
