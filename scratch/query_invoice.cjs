const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();

async function run() {
    try {
        const companyId = '064iu';
        const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
        const snap = await recordsCol.where('collectionName', '==', 'invoices').get();
        console.log(`Found ${snap.size} invoice records for company ${companyId}`);
        for (const doc of snap.docs) {
            const data = doc.data();
            const d = data.data || {};
            if (d.refNo === '9857' || d.refNo === 9857) {
                console.log(`Invoice doc ID: ${doc.id}`);
                console.log(JSON.stringify(data, null, 2));
            }
        }
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

run();
