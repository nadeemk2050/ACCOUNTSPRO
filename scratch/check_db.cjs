const admin = require('firebase-admin');

// Since we are running in the firebase CLI context, let's try to initialize.
// If it fails due to lack of credentials, we can inform the user or read locally.
try {
    admin.initializeApp();
} catch (e) {
    console.error('Failed to initialize admin SDK:', e.message);
    process.exit(1);
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
