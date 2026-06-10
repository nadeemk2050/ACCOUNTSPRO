import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDaKgWXJiz_NTYo4NBCXhVZ7qIo9SwkooY",
  authDomain: "cashshams.firebaseapp.com",
  projectId: "cashshams",
  storageBucket: "cashshams.firebasestorage.app",
  messagingSenderId: "565173718396",
  appId: "1:565173718396:web:c23d370ab7c629f86c28f9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const companyId = '8u57h';

async function run() {
  try {
    const ids = ['85f25AiYZuS4Af2C8GDq', 'inWU2yjWRuAxUtLBFq3j'];
    for (const id of ids) {
      const docRef = doc(db, `companies_live/${companyId}/records/${id}`);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        console.log(`\nDocument ${id}:`, JSON.stringify(docSnap.data(), null, 2));
      } else {
        console.log(`Document ${id} not found!`);
      }
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
