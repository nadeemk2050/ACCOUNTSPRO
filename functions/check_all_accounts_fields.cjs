const admin = require('firebase-admin');
try {
    admin.initializeApp({
        projectId: 'cashshams'
    });
} catch (err) {
    console.error('Failed to initialize admin SDK:', err);
    process.exit(1);
}

const db = admin.firestore();

async function run() {
    const companyId = '8u57h';
    const recordsSnap = await db.collection('companies_live')
        .doc(companyId)
        .collection('records')
        .where('collectionName', '==', 'accounts')
        .get();
        
    console.log(`Checking ${recordsSnap.size} accounts:`);
    const allKeys = new Set();
    recordsSnap.forEach(doc => {
        const d = doc.data().data || {};
        Object.keys(d).forEach(k => allKeys.add(k));
    });
    console.log('All unique fields in accounts.data:', Array.from(allKeys));
    
    // Let's also print the data for a couple of other bank/cash accounts
    recordsSnap.forEach(doc => {
        const d = doc.data().data || {};
        if (d.type === 'bank' || d.type === 'cash') {
            console.log(`Account Name: ${d.name}, Type: ${d.type}, Fields:`, Object.keys(d), `Balance: ${d.balance}`);
        }
    });
    
    process.exit(0);
}

run().catch(console.error);
