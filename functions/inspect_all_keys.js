const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();

async function run() {
    try {
        console.log("Fetching api_keys...");
        const apiKeysSnap = await db.collection('api_keys').get();
        console.log(`Found ${apiKeysSnap.size} keys.`);
        for (const doc of apiKeysSnap.docs) {
            const data = doc.data();
            console.log(`API Key composite ID: ${doc.id}`);
            console.log(`  apiKey: ${data.apiKey}`);
            console.log(`  userId: ${data.userId}`);
            console.log(`  companyId: ${data.companyId}`);
        }

        console.log("\nFetching companies...");
        const companiesSnap = await db.collection('companies_live').get();
        for (const doc of companiesSnap.docs) {
            console.log(`Company ID: ${doc.id}, Name: ${doc.data().name}`);
            const recordsCol = db.collection('companies_live').doc(doc.id).collection('records');
            const accountsSnap = await recordsCol.where('collectionName', '==', 'accounts').get();
            console.log(`  Accounts count: ${accountsSnap.size}`);
            accountsSnap.forEach(acc => {
                const accData = acc.data().data || {};
                console.log(`    - Account ID: ${acc.id}, Name: ${accData.name}, Stored Balance: ${accData.balance}`);
            });
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
    process.exit(0);
}

run();
