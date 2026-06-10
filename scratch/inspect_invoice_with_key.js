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

const projectApiKey = '34b1e7e92fcc8b42384ec055dffc680142c552f409c2cf25';

async function run() {
    await signInAnonymously(auth);
    console.log('Signed in anonymously.');

    console.log('Querying api_keys to resolve userId...');
    const keysSnap = await getDocs(query(collection(db, 'api_keys'), where('apiKey', '==', projectApiKey)));
    if (keysSnap.empty) {
        console.log('API key not found.');
        process.exit(1);
    }
    const keyData = keysSnap.docs[0].data();
    const { userId, companyId } = keyData;
    console.log(`Resolved: userId = ${userId}, companyId = ${companyId}`);

    console.log(`Querying invoices with userId == ${userId} and refNo == '9857'...`);
    const q = query(collection(db, 'invoices'), where('userId', '==', userId), where('refNo', '==', '9857'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
        console.log('Invoice not found with refNo == 9857.');
    } else {
        snapshot.forEach(doc => {
            console.log('Invoice ID:', doc.id);
            console.log('Data:', JSON.stringify(doc.data(), null, 2));
        });
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
