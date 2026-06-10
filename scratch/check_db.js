const admin = require('firebase-admin');
const serviceAccount = require('../functions/service-account.json'); // Let's check if this exists, or if we can initialize without key using local application credentials.
// Actually, let's initialize using local firebase emulator or default admin if configured, or look at how functions do it.
// In functions/index.js: admin.initializeApp();
// Since we are running on the developer's machine with firebase CLI logged in, we can use application default credentials or just initialize.
try {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
} catch (e) {
    // try default initialization
    try {
        admin.initializeApp();
    } catch (err) {
        console.error('Failed to initialize admin SDK:', err);
        process.exit(1);
    }
}

const db = admin.firestore();

async function run() {
    const apiKey = '34b1e7e92fcc8b42384ec055dffc680142c552f409c2cf25';
    console.log('Checking API Key:', apiKey);
    
    const keySnap = await db.collection('api_keys').where('apiKey', '==', apiKey).limit(1).get();
    if (keySnap.empty) {
        console.log('API Key not found in api_keys collection!');
        process.exit(1);
    }
    
    const keyData = keySnap.docs[0].data();
    console.log('API Key Data:', keyData);
    
    const { userId, companyId } = keyData;
    
    // Check company_live doc
    const companyDoc = await db.collection('companies_live').doc(companyId).get();
    if (companyDoc.exists) {
        console.log('Company Live Doc:', companyDoc.data());
    } else {
        console.log('Company Live Doc NOT FOUND for id:', companyId);
    }
    
    // Check recently written payments
    console.log('Checking payments under companies_live/' + companyId + '/records:');
    const recordsSnap = await db.collection('companies_live')
        .doc(companyId)
        .collection('records')
        .where('collectionName', '==', 'payments')
        .limit(10)
        .get();
        
    console.log(`Found ${recordsSnap.size} payment records in records subcollection.`);
    recordsSnap.forEach(doc => {
        const d = doc.data();
        console.log(`Record ID: ${doc.id}, Date: ${d.data?.date}, RefNo: ${d.data?.refNo}, Amount: ${d.data?.amount}, syncTimestamp: ${d.syncTimestamp}`);
    });
    
    process.exit(0);
}

run().catch(console.error);
