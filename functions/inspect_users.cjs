const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();

async function run() {
    try {
        console.log("--- API KEYS ---");
        const apiKeysSnap = await db.collection('api_keys').get();
        apiKeysSnap.forEach(doc => {
            const data = doc.data();
            console.log(`Company ID: ${data.companyId}, User ID: ${data.userId}, API Key: ${data.apiKey}`);
        });

        console.log("\n--- SUB USERS (from 'users' collection) ---");
        const usersSnap = await db.collection('users').get();
        usersSnap.forEach(doc => {
            const data = doc.data();
            console.log(`User ID: ${doc.id}, Name: ${data.name}, Email: ${data.email}, Role: ${data.role}, Password: ${data.password || data.teamPassword || 'none'}, Owner ID: ${data.ownerId}`);
        });

        console.log("\n--- offline users in companies_live ---");
        const companyIds = ['8u57h', 'f44q9']; // common companies
        for (const cid of companyIds) {
            const localUsers = await db.collection('companies_live').doc(cid).collection('records').where('collectionName', '==', 'users').get();
            if (!localUsers.empty) {
                console.log(`Company ${cid} local users:`);
                localUsers.forEach(d => {
                    const ud = d.data().data || {};
                    console.log(`- ID: ${d.id}, Name: ${ud.name}, Role: ${ud.role}, Password: ${ud.password || ud.teamPassword}`);
                });
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
