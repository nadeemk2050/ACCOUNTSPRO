import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

async function run() {
    try {
        console.log("Fetching collections...");
        const bagsSnap = await getDocs(collection(db, 'jumbo_bags'));
        const reusableSnap = await getDocs(collection(db, 'reusable_jumbo_bags'));
        const journalsSnap = await getDocs(collection(db, 'stock_journals'));
        
        console.log(`Total jumbo_bags in Firestore: ${bagsSnap.size}`);
        console.log(`Total reusable_jumbo_bags in Firestore: ${reusableSnap.size}`);
        console.log(`Total stock_journals in Firestore: ${journalsSnap.size}`);
        
        const allJumboBags = bagsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const reusableBags = reusableSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const stockJournals = journalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        const getBagsForVoucher = (vch) => {
            const linkedInGlobal = allJumboBags.filter(b => {
                const vchId = String(vch.id);
                const vchRef = (vch.refNo || '').toLowerCase();
                const bIdMatch = (
                    (b.stockJournalId && String(b.stockJournalId) === vchId) ||
                    (b.linkedStockJournalId && String(b.linkedStockJournalId) === vchId) ||
                    (b.voucherId && String(b.voucherId) === vchId) ||
                    (b.originId && String(b.originId) === vchId)
                );
                const bRefMatch = vchRef && (
                    (b.stockJournalRefNo && String(b.stockJournalRefNo).toLowerCase() === vchRef) ||
                    (b.voucherRefNo && String(b.voucherRefNo).toLowerCase() === vchRef) ||
                    (b.refNo && String(b.refNo).toLowerCase() === vchRef)
                );
                const bListMatch = (
                    (vch.jumboBags && Array.isArray(vch.jumboBags) && vch.jumboBags.some(jb => (jb.id || jb) === b.id)) ||
                    (vch.jumbo_bags && Array.isArray(vch.jumbo_bags) && vch.jumbo_bags.some(jb => (jb.id || jb) === b.id))
                );
                return bIdMatch || bRefMatch || bListMatch;
            });
            
            const embedded = [
                ...(Array.isArray(vch.jumboBags) ? vch.jumboBags : []),
                ...(Array.isArray(vch.jumbo_bags) ? vch.jumbo_bags : []),
                ...(Array.isArray(vch.producedBags) ? vch.producedBags : []),
                ...(Array.isArray(vch.produced) ? vch.produced.flatMap(p => (Array.isArray(p.jumboBags) ? p.jumboBags : Array.isArray(p.jumbo_bags) ? p.jumbo_bags : [])) : [])
            ].filter(jb => jb && typeof jb === 'object');
            
            const uniqueEmbedded = [];
            const seenIds = new Set(linkedInGlobal.map(b => String(b.id)));
            const seenBagNos = new Set(linkedInGlobal.map(b => String(b.bagNo || '').toLowerCase()));
            
            embedded.forEach((eb, idx) => {
                const ebId = eb.id || `embedded-${vch.id}-${idx}`;
                const ebBagNo = String(eb.bagNo || '').toLowerCase();
                if (!seenIds.has(ebId) && (!ebBagNo || !seenBagNos.has(ebBagNo))) {
                    seenIds.add(ebId);
                    if (ebBagNo) seenBagNos.add(ebBagNo);
                    uniqueEmbedded.push({
                        ...eb,
                        id: ebId,
                        date: eb.date || vch.date,
                        voucherRefNo: eb.voucherRefNo || vch.refNo,
                        stockJournalRefNo: vch.refNo,
                        stockJournalId: vch.id
                    });
                }
            });
            
            return [...linkedInGlobal, ...uniqueEmbedded];
        };
        
        let inBags = [];
        stockJournals.forEach(vch => {
            const vchBags = getBagsForVoucher(vch);
            inBags.push(...vchBags);
        });
        
        console.log(`Total inBags (manufactured bags list): ${inBags.length}`);
        
        const activeInBags = inBags.filter(b => {
            const dbBag = allJumboBags.find(gb => gb.id === b.id);
            const isSold = b.status === 'sold' || (dbBag && dbBag.status === 'sold');
            return !isSold;
        });
        console.log(`Total remaining bags (unsold list): ${activeInBags.length}`);
        
        const soldInBags = inBags.filter(b => {
            const dbBag = allJumboBags.find(gb => gb.id === b.id);
            const isSold = b.status === 'sold' || (dbBag && dbBag.status === 'sold');
            return isSold;
        });
        console.log(`Total sold bags (in list): ${soldInBags.length}`);
        
        const activeReusableBags = reusableBags.filter(rb => rb.status === 'active');
        console.log(`Active reusable bags count: ${activeReusableBags.length}`);
        console.log(`Reusable bag numbers:`, reusableBags.map(rb => `${rb.bagNo} (${rb.status})`));
        
        const reusableInActive = [];
        const regularInActive = [];
        activeInBags.forEach(b => {
            const cleanBagNo = String(b.bagNo || '').toUpperCase().replace(/^#/, '').trim();
            const isReusable = reusableBags.some(rb => rb.bagNo?.toUpperCase().replace(/^#/, '').trim() === cleanBagNo);
            if (isReusable) {
                reusableInActive.push(b);
            } else {
                regularInActive.push(b);
            }
        });
        
        console.log(`Unsold reusable entries in activeInBags: ${reusableInActive.length}`);
        console.log(`Unsold regular entries in activeInBags: ${regularInActive.length}`);
        
        console.log(`Unsold reusable entries details:`, reusableInActive.map(b => `${b.bagNo} (id: ${b.id}, qty: ${b.qty}, status: ${b.status})`));
        
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

run();
