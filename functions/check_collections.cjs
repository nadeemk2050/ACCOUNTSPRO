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
    const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
    
    // We can fetch a sample of records and group by collectionName
    const snap = await recordsCol.select('collectionName').get();
    const cols = new Set();
    snap.forEach(doc => {
        cols.add(doc.data().collectionName);
    });
    
    console.log('Unique collectionName values in records subcollection:', Array.from(cols));
    process.exit(0);
}

run().catch(console.error);
