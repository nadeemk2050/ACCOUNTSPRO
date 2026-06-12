import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, limit } from 'firebase/firestore';
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

    const companyIds = ['8u57h', 'bul7x', '064iu', 'f44q9'];
    for (const cid of companyIds) {
        console.log(`\n--- INSPECTING NESTED LOGS FOR COMPANY: ${cid} ---`);
        const q = query(
            collection(db, `companies_live/${cid}/records`),
            where('collectionName', '==', 'audit_logs'),
            limit(3)
        );
        const snap = await getDocs(q);
        console.log(`Found ${snap.size} log records.`);
        snap.forEach(d => {
            console.log(`Doc ID: ${d.id}`, JSON.stringify(d.data(), null, 2));
        });
    }

    process.exit(0);
}

run().catch(console.error);
