import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDaKgWXJiz_NTYo4NBCXhVZ7qIo9SwkooY",
  authDomain: "cashshams.firebaseapp.com",
  projectId: "cashshams",
  storageBucket: "cashshams.firebasestorage.app",
  messagingSenderId: "565173718396",
  appId: "1:565173718396:web:c23d370ab7c629f86c28f9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
    await signInAnonymously(auth);
    console.log('Signed in.');

    // Let's get all companies
    const companiesSnap = await getDocs(collection(db, 'companies_live'));
    console.log(`Found ${companiesSnap.size} companies.`);

    for (const companyDoc of companiesSnap.docs) {
        const companyId = companyDoc.id;
        console.log(`Searching company: ${companyId} (${companyDoc.data().name || 'no name'})...`);
        const recordsCol = collection(db, 'companies_live', companyId, 'records');
        
        // We can query collectionName == 'invoices'
        const q = query(recordsCol, where('collectionName', '==', 'invoices'));
        const snap = await getDocs(q);
        
        snap.forEach(doc => {
            const rData = doc.data();
            const inv = rData.data || {};
            // check both refNo and vNo
            if (inv.refNo == '9857' || inv.vNo == '9857') {
                console.log(`FOUND INVOICE in company: ${companyId}`);
                console.log('Record ID:', doc.id);
                console.log('Invoice Data:', JSON.stringify(inv, null, 2));
            }
        });
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
