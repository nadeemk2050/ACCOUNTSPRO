import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
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

const OWNER_UID = 'fT2fJrS1gbQf5I9MmrNaHxEm7Qt2';
const SUB_USER_UID = 'modvr';
const COMPANY_ID = 'f44q9';

async function run() {
    console.log('Authenticating anonymously...');
    await signInAnonymously(auth);
    console.log('Authenticated!');

    // 1. Update nested records in companies_live/{companyId}/records
    console.log(`Searching nested records in companies_live/${COMPANY_ID}/records where collectionName == 'payments' and data.userId == '${SUB_USER_UID}'...`);
    const recordsColl = collection(db, 'companies_live', COMPANY_ID, 'records');
    const recordsQ = query(recordsColl, where('collectionName', '==', 'payments'), where('data.userId', '==', SUB_USER_UID));
    const recordsSnap = await getDocs(recordsQ);
    
    console.log(`Found ${recordsSnap.size} nested records to fix.`);
    
    for (const dDoc of recordsSnap.docs) {
        console.log(`Updating nested doc: ${dDoc.id}...`);
        const docRef = doc(db, 'companies_live', COMPANY_ID, 'records', dDoc.id);
        const currentData = dDoc.data().data || {};
        
        await updateDoc(docRef, {
            'data.userId': OWNER_UID,
            'timestamp': Date.now(),
            'syncTimestamp': Date.now()
        });
        console.log(`Doc ${dDoc.id} updated successfully!`);
    }

    // 2. Update top-level payments collection
    console.log(`Searching top-level payments where userId == '${SUB_USER_UID}'...`);
    const topColl = collection(db, 'payments');
    const topQ = query(topColl, where('userId', '==', SUB_USER_UID));
    const topSnap = await getDocs(topQ);
    
    console.log(`Found ${topSnap.size} top-level documents to fix.`);
    
    for (const dDoc of topSnap.docs) {
        console.log(`Updating top-level doc: ${dDoc.id}...`);
        const docRef = doc(db, 'payments', dDoc.id);
        await updateDoc(docRef, {
            'userId': OWNER_UID,
            'timestamp': Date.now()
        });
        console.log(`Doc ${dDoc.id} updated successfully!`);
    }

    console.log('All updates complete!');
    process.exit(0);
}

run().catch(console.error);
