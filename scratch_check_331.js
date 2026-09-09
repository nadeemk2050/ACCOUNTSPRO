import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = {
    apiKey: "AIzaSyAgTuSqvk5qGtP5bHBOXRL3CTar-Uw9F7I",
    authDomain: "cashshams.firebaseapp.com",
    projectId: "cashshams",
    storageBucket: "cashshams.appspot.com",
    messagingSenderId: "125324545564",
    appId: "1:125324545564:web:e2b34567890"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
    try {
        const q = query(collection(db, 'invoices'), where('refNo', '==', 'S0319'));
        const snap = await getDocs(q);
        if (snap.empty) {
            console.log("S0319 not found");
            return;
        }
        const inv = snap.docs[0].data();
        console.log("Invoice ID:", snap.docs[0].id);
        
        let found = false;
        inv.items.forEach((item, idx) => {
            if (item.selectedBags) {
                console.log(`Item ${idx} has bags:`, item.selectedBags.map(b => b.bagNo).join(', '));
                if (item.selectedBags.some(b => b.bagNo === 'A331' || b.bagNo === '331')) {
                    found = true;
                }
            }
        });
        console.log("Is 331 in invoice items? ", found);
        
        // Also check jumbo_bags for A331
        const bagQ = query(collection(db, 'jumbo_bags'), where('bagNo', 'in', ['A331', '331']));
        const bagSnap = await getDocs(bagQ);
        bagSnap.forEach(d => {
            console.log("Bag doc:", d.id, d.data());
        });
    } catch (e) {
        console.error(e);
    }
}
check();
