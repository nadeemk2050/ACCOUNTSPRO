import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
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
    console.log('Authenticating...');
    await signInAnonymously(auth);
    console.log('Authenticated!');

    const companyId = '8u57h';
    const rakId = 'Pnus7QLBiGRSG6UBRIB8';
    const recordsCol = collection(db, 'companies_live', companyId, 'records');

    const paySnap = await getDocs(query(recordsCol, where('collectionName', '==', 'payments')));
    paySnap.forEach(doc => {
        const item = doc.data();
        if (item.deleted === true) return;
        const d = item.data || {};
        if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

        const amt = Number(d.amount || 0);
        if (Math.abs(amt - 95.50) < 0.01 || Math.abs(amt - 95.5) < 0.01) {
            console.log(`Payment: ${doc.id}, Date: ${d.date}, Amt: ${amt}, Acc: ${d.accountId}, toAcc: ${d.toAccountId}`);
        }
    });

    process.exit(0);
}

run().catch(console.error);
