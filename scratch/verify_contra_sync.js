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

    // Since we are checking if it was saved in the top-level collection:
    // Oh, wait! Top-level payments read has:
    // allow read: if resource.data.userId == request.auth.uid or belongs to company/owner.
    // Since we're logged in anonymously, we won't have permission to read top-level payments.
    // BUT we CAN query the nested companies_live records collection!
    const companyId = 'f44q9';
    console.log(`Checking nested records in companies_live/${companyId}/records where data.refNo == 'CTR-TEST-001'...`);
    const q1 = query(
        collection(db, 'companies_live', companyId, 'records'),
        where('data.refNo', '==', 'CTR-TEST-001')
    );
    const snap1 = await getDocs(q1);
    console.log(`Found ${snap1.size} nested records.`);
    snap1.forEach(d => {
        console.log(`Nested ID: ${d.id}`, d.data());
    });

    console.log('Verification finished!');
    process.exit(0);
}

run().catch(console.error);
