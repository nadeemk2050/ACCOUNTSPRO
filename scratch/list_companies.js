import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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
    console.log('Registered Live Companies in Firestore:');
    const snap = await getDocs(collection(db, 'nadtally_live_registry'));
    snap.forEach(doc => {
        const d = doc.data();
        console.log(`Company ID: ${doc.id}, Name: ${d.name}, ownerEmail: ${d.ownerEmail}`);
    });
    process.exit(0);
}

run().catch(console.error);
