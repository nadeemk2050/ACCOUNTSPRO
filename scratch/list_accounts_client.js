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
    console.log('Authenticating anonymously...');
    await signInAnonymously(auth);
    console.log('Authenticated!');

    const companyId = 'f44q9';
    console.log(`Querying companies_live/${companyId}/records for accounts...`);
    const q = query(
        collection(db, 'companies_live', companyId, 'records'),
        where('collectionName', '==', 'accounts')
    );
    const snap = await getDocs(q);
    console.log(`Found ${snap.size} account documents.`);
    snap.forEach(d => {
        const docData = d.data();
        console.log(`Account ID: ${d.id}, Name: ${docData.data?.name || 'Unknown'}`);
    });
    process.exit(0);
}

run().catch(console.error);
