import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

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

async function inspectBag() {
  try {
    console.log("Searching for bag A10 in Firestore...");
    const q = query(collection(db, 'jumbo_bags'), where('bagNo', '==', 'A10'));
    const snap = await getDocs(q);
    if (snap.empty) {
      console.log("No bag A10 found!");
      return;
    }
    
    snap.docs.forEach(doc => {
      console.log(`Document ID: ${doc.id}`);
      console.log("Data:", JSON.stringify(doc.data(), null, 2));
    });
  } catch (err) {
    console.error("Error during inspection:", err);
  }
}

inspectBag();
