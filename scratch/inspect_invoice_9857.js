const admin = require('firebase-admin');

try {
    admin.initializeApp();
} catch (e) {
    console.error('Failed to initialize admin SDK:', e.message);
    process.exit(1);
}

const db = admin.firestore();

async function run() {
    console.log('Querying invoices where refNo == 9857...');
    const snapshot = await db.collection('invoices').where('refNo', '==', '9857').get();
    if (snapshot.empty) {
        console.log('No invoice found with refNo == 9857.');
    } else {
        snapshot.forEach(doc => {
            console.log('Invoice Document ID:', doc.id);
            console.log('Data:', JSON.stringify(doc.data(), null, 2));
        });
    }
    process.exit(0);
}

run().catch(console.error);
