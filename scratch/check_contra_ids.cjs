const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();
const companyId = '8u57h';

async function run() {
    try {
        const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
        const paySnap = await recordsCol.where('collectionName', '==', 'payments').get();
        const accSnap = await recordsCol.where('collectionName', '==', 'accounts').get();
        
        const nameMap = {};
        accSnap.forEach(doc => {
            const data = doc.data();
            nameMap[doc.id] = data.data?.name || 'No Name';
            if (data.id) {
                nameMap[data.id] = data.data?.name || 'No Name';
            }
        });

        console.log("Nested Account IDs in nameMap:");
        accSnap.forEach(doc => {
            console.log(`- doc.id: ${doc.id}, data.id: ${doc.data().id}, name: ${doc.data().data?.name}`);
        });

        console.log("\nInspecting contra payments:");
        let contraCount = 0;
        paySnap.forEach(doc => {
            const p = doc.data().data || {};
            if (p.type === 'contra') {
                contraCount++;
                const fromName = nameMap[p.accountId] || `Unknown (${p.accountId})`;
                const toName = nameMap[p.toAccountId] || `Unknown (${p.toAccountId})`;
                console.log(`Contra Payment ID: ${doc.id}`);
                console.log(`  accountId (from): ${p.accountId} -> ${fromName}`);
                console.log(`  toAccountId (to): ${p.toAccountId} -> ${toName}`);
                console.log(`  amount: ${p.amount}, date: ${p.date}`);
            }
        });
        console.log(`Total contras found: ${contraCount}`);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
