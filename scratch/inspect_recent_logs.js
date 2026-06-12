import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
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

    console.log('\n--- RECENT AUDIT LOGS (TOP LEVEL) ---');
    const logsQuery = query(collection(db, 'audit_logs'), orderBy('date', 'desc'), limit(5));
    const logsSnap = await getDocs(logsQuery);
    logsSnap.forEach(d => {
        console.log(`Doc ID: ${d.id}`, JSON.stringify(d.data(), null, 2));
    });

    process.exit(0);
}

run().catch(console.error);
