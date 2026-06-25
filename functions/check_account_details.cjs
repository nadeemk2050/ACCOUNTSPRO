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
    console.log(`Checking accounts under companies_live/${companyId}/records:`);
    const recordsSnap = await db.collection('companies_live')
        .doc(companyId)
        .collection('records')
        .where('collectionName', '==', 'accounts')
        .get();
        
    console.log(`Found ${recordsSnap.size} accounts records.`);
    recordsSnap.forEach(doc => {
        const d = doc.data();
        const accData = d.data || {};
        if (accData.name === 'AXIOM CASHIER' || accData.name?.includes('CASHIER')) {
            console.log(`Account ID: ${doc.id}`);
            console.log(`Name: ${accData.name}`);
            console.log(`Raw accData:`, JSON.stringify(accData, null, 2));
        }
    });
    
    process.exit(0);
}

run().catch(console.error);
