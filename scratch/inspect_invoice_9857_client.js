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
    console.log('Signing in anonymously...');
    await signInAnonymously(auth);
    console.log('Signed in successfully.');

    console.log('Querying invoices where refNo == 9857...');
    const q = query(collection(db, 'invoices'), where('refNo', '==', '9857'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
        console.log('No invoice found with refNo == 9857.');
    } else {
        snapshot.forEach(doc => {
            console.log('Invoice Document ID:', doc.id);
            console.log('Data:', JSON.stringify(doc.data(), null, 2));
        });
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
