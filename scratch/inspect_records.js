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

    const companyIds = [
        '064iu', '8tk7s', '8u57h', 'bul7x', 'cqews', 'f1luh', 'f44q9', 
        'iefbg', 'qbgnu', 'ssvix', 'vr8d2', 'zrix3', '6w2sg', 'dxm7i', 
        'mj2s9', 'uhuea', 'umne6', 'vjmswk'
    ];
    
    for (const companyId of companyIds) {
        const recordsCol = collection(db, 'companies_live', companyId, 'records');
        const collections = ['accounts', 'parties', 'expenses', 'asset_accounts'];
        for (const col of collections) {
            try {
                const snap = await getDocs(query(recordsCol, where('collectionName', '==', col)));
                snap.forEach(d => {
                    const data = d.data().data || {};
                    if (data.name && data.name.toUpperCase().includes('RAK')) {
                        console.log(`  MATCHED in Company=${companyId}, Collection=${col}: ${d.id}`, JSON.stringify(d.data(), null, 2));
                    }
                });
            } catch (e) {
                // Ignore collection-specific errors
            }
        }
    }

    process.exit(0);
}

run().catch(console.error);
