import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

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

async function debugBag331() {
    try {
        console.log("=== CHECKING JUMBO_BAGS ===");
        const bagQ = query(collection(db, 'jumbo_bags'), where('bagNo', 'in', ['A331', '331', '#A331']));
        const bagSnap = await getDocs(bagQ);
        bagSnap.forEach(d => {
            console.log("Bag doc:", d.id, d.data());
        });

        console.log("=== CHECKING ALL INVOICES FOR BAG 331 ===");
        const invSnap = await getDocs(collection(db, 'invoices'));
        invSnap.forEach(d => {
            const data = d.data();
            let hasBag = false;
            if (data.soldBags && Array.isArray(data.soldBags)) {
                if (data.soldBags.some(b => String(b.bagNo).includes('331'))) hasBag = true;
            }
            if (data.items && Array.isArray(data.items)) {
                data.items.forEach(i => {
                    if (i.selectedBags && Array.isArray(i.selectedBags)) {
                        if (i.selectedBags.some(b => String(b.bagNo).includes('331'))) hasBag = true;
                    }
                });
            }
            if (hasBag) {
                console.log(`Found in Invoice ${d.id} (Ref: ${data.refNo})`);
            }
        });
        console.log("=== DONE ===");
    } catch (e) {
        console.error(e);
    }
}
debugBag331();
