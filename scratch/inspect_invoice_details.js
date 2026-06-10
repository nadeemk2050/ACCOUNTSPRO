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

const companyId = 'f44q9';

async function run() {
    await signInAnonymously(auth);
    console.log('Signed in.');

    const recordsCol = collection(db, 'companies_live', companyId, 'records');
    const q = query(recordsCol, where('collectionName', '==', 'invoices'));
    const snapshot = await getDocs(q);
    
    snapshot.forEach(doc => {
        const rData = doc.data();
        const inv = rData.data || {};
        if (inv.date === '2026-06-04' || (inv.partyName && inv.partyName.includes('MODERN PLASTIC'))) {
            console.log('*** FOUND MATCHED INVOICE ***');
            console.log('DocID:', doc.id);
            console.log('Record Data:', JSON.stringify(rData, null, 2));
        }
    });
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
