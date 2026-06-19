import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
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

const targetDocId = 'c860c54a-906e-4ec4-ae77-24ad9759f046';

async function run() {
    await signInAnonymously(auth);
    console.log('Signed in to Firebase.');

    // 1. Fetch all live company IDs
    const registryCol = collection(db, 'nadtally_live_registry');
    const registrySnap = await getDocs(registryCol);
    console.log(`Found ${registrySnap.size} registered live companies.`);

    for (const companyDoc of registrySnap.docs) {
        const companyId = companyDoc.id;
        const companyName = companyDoc.data().name;
        console.log(`Checking company: ${companyName} (${companyId})`);

        const docRef = doc(db, 'companies_live', companyId, 'records', targetDocId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            console.log(`*** FOUND VOUCHER DOCUMENT IN Firestore under company ${companyId} ***`);
            console.log('Document Data:', JSON.stringify(docSnap.data(), null, 2));
        } else {
            console.log(`Document not found in ${companyId}`);
        }
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
