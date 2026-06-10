const admin = require('firebase-admin');

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
        for (const doc of snap.docs) {
            console.log(`Company ID: ${doc.id}, Name: ${doc.data().name}`);
            
            // Query accounts
            const recordsCol = db.collection('companies_live').doc(doc.id).collection('records');
            const accountsSnap = await recordsCol.where('collectionName', '==', 'accounts').get();
            for (const accDoc of accountsSnap.docs) {
                const item = accDoc.data();
                const d = item.data || {};
                if (d.name && d.name.toUpperCase().includes('RAK')) {
                    console.log(`  Account ID: ${accDoc.id}, Name: ${d.name}, Stored Balance: ${d.balance}, Opening Balance: ${d.openingBalance}`);
                }
            }
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
    process.exit(0);
}

run();
