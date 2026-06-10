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

const companyId = '064iu';
const modernPlasticId = '76470633-9cae-4719-abde-bfad080c45c0';
const izharAhmadId = 'tq2oXCQMYpfNShjM5OAx';

const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);

async function run() {
    await signInAnonymously(auth);
    console.log('Signed in.');

    const recordsCol = collection(db, 'companies_live', companyId, 'records');
    
    // Fetch all records for the ledger
    const snapshot = await getDocs(recordsCol);
    console.log(`Total records: ${snapshot.size}`);

    // Filter to invoices, payments, etc.
    const invoices = [];
    snapshot.forEach(doc => {
        const rData = doc.data();
        if (rData.collectionName === 'invoices') {
            invoices.push({ id: doc.id, ...rData.data });
        }
    });

    const getLedger = (partyId, partyLabel) => {
        console.log(`\n=================== LEDGER FOR: ${partyLabel} (${partyId}) ===================`);
        
        invoices.forEach(inv => {
            const isMainParty = inv.partyId === partyId;
            const isExpCredit = inv.addlExpCreditId === partyId;
            
            if (!isMainParty && !isExpCredit) return;

            const baseVal = safeNum(inv.totalAmount || inv.grandTotal || inv.amount || 0);
            const rate = safeNum(inv.exchangeRate || 1);
            
            const expForeign = inv.type === 'purchase' ? (inv.expenses || []).reduce((sum, e) => sum + safeNum(e.amount), 0) : 0;
            const expBase = expForeign * rate;
            const addlExpForeign = inv.type === 'purchase' ? ((inv.addlExpenses || []).reduce((sum, e) => sum + safeNum(e.amount), 0) || safeNum(inv.addlExpTotal || 0)) : 0;
            const addlExpBase = addlExpForeign * rate;
            const hasAddlSplit = inv.type === 'purchase' && inv.addlExpCreditId && addlExpBase > 0;
            
            const supplierBase = (inv.type === 'purchase') ? Math.max(0, baseVal - expBase - addlExpBase) : baseVal;

            console.log(`Invoice Date: ${inv.date}, RefNo: ${inv.refNo}, type: ${inv.type}`);
            console.log(`  baseVal=${baseVal}, expBase=${expBase}, addlExpBase=${addlExpBase}, supplierBase=${supplierBase}`);

            // Main invoice row simulation
            if (isMainParty) {
                const amt = (inv.type === 'purchase') ? supplierBase : baseVal;
                console.log(`  -> Row type: PURCHASE INV (Supplier), amount: ${amt}`);
            }

            // Path 1 Expense Credit Row
            if (isExpCredit && inv.type === 'purchase' && inv.addlExpCreditId !== inv.partyId) {
                console.log(`  -> Row type: Purchase Expenses (Paid By) [Path 1], amount: ${addlExpBase}`);
            }

            // Path 2 Split Expense Row
            if (hasAddlSplit) {
                const matchesPartyLedger = inv.addlExpCreditId === partyId; // simplified
                if (matchesPartyLedger) {
                    console.log(`  -> Row type: PURCHASE EXP [Path 2], amount: ${addlExpBase}`);
                }
            }
        });
    };

    getLedger(modernPlasticId, 'MODERN PLASTIC COMPANY L.L.C-O.P.C');
    getLedger(izharAhmadId, 'IZHAR AHMAD CO KHAWAR');

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
