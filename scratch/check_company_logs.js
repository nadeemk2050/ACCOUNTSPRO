import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
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

    for (const cid of ['8u57h', 'bul7x']) {
        console.log(`\n================= COMPANY: ${cid} =================`);
        const q = query(
            collection(db, `companies_live/${cid}/records`),
            where('collectionName', '==', 'audit_logs'),
            limit(10)
        );
        const snap = await getDocs(q);
        console.log(`Found ${snap.size} recent log records.`);
        snap.forEach(d => {
            const data = d.data();
            console.log(`Doc ID: ${d.id}, timestamp: ${data.timestamp}, syncTimestamp: ${data.syncTimestamp}`);
            console.log(`  description: ${data.data?.description}`);
            console.log(`  ownerId in data: ${data.data?.ownerId}`);
        });
    }

    process.exit(0);
}

run().catch(console.error);
