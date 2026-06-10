const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();

async function run() {
    const companyId = '064iu';
    
    // Load parties
    const partiesSnap = await db.collection('companies_live').doc(companyId).collection('records')
        .where('collectionName', '==', 'parties').get();
    const parties = partiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data().data }));
    
    // Load accounts
    const accountsSnap = await db.collection('companies_live').doc(companyId).collection('records')
        .where('collectionName', '==', 'accounts').get();
    const accounts = accountsSnap.docs.map(doc => ({ id: doc.id, ...doc.data().data }));

    // Load expenses
    const expensesSnap = await db.collection('companies_live').doc(companyId).collection('records')
        .where('collectionName', '==', 'expenses').get();
    const expenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data().data }));

    // Load invoice 9857
    const invSnap = await db.collection('companies_live').doc(companyId).collection('records')
        .where('collectionName', '==', 'invoices').get();
    const invoices = invSnap.docs.filter(doc => String(doc.data().data?.refNo) === '9857');
    
    if (invoices.length === 0) {
        console.log("Invoice 9857 not found!");
        process.exit(1);
    }
    
    const doc = invoices[0];
    const d = doc.data().data;
    
    console.log(`Loaded invoice ${d.refNo}. Party: ${d.partyName} (ID: ${d.partyId}), Payer: ${d.addlExpCreditId}, addlExpTotal: ${d.addlExpTotal}`);

    // Simulation helpers
    const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);
    const round3 = (num) => Math.round(Number(num || 0) * 1000) / 1000;
    const formatCurrency = (val) => Number(val).toFixed(3);
    const findName = (id) => {
        const found = [...parties, ...accounts, ...expenses].find(x => x.id === id);
        return found ? found.name : id;
    };
    const getProductName = (id) => id;
    const findUserName = (uid) => uid;

    const buildRow = (doc, d, extra) => {
        let drName = '-', crName = '-', typeLabel = d.type ? d.type.toUpperCase() : 'UNKNOWN';
        if (d.type === 'purchase') { drName = 'Purchase A/c'; crName = d.partyName || findName(d.partyId) || 'Supplier'; typeLabel = 'PURCHASE INV'; }
        return {
            id: doc.id, date: d.date || "", ref: d.refNo || 'INV',
            drName, crName, vchType: typeLabel,
            particulars: `${drName || '-'}${crName && crName !== '-' ? ` / ${crName}` : ''}`,
            amountIn: extra.amtIn || 0, amountOut: extra.amtOut || 0,
        };
    };

    function simulateFilter(activeFilter) {
        console.log(`\n=== Simulating Filter: type=${activeFilter.type}, id=${activeFilter.id} (${findName(activeFilter.id)}) ===`);
        let allTx = [];
        
        const isForeign = d.currencyId && d.currencyId !== 'BASE';
        const foreignVal = safeNum(d.foreignTotal || d.foreignAmount || 0);
        const baseVal = safeNum(d.totalAmount || d.amount || 0);

        const rate = safeNum(d.exchangeRate || 1);
        const expForeign = d.type === 'purchase' ? (d.expenses || []).reduce((sum, e) => sum + safeNum(e.amount), 0) : 0;
        const expBase = expForeign * rate;
        const addlExpForeign = d.type === 'purchase' ? ((d.addlExpenses || []).reduce((sum, e) => sum + safeNum(e.amount), 0) || safeNum(d.addlExpTotal || 0)) : 0;
        const addlExpBase = addlExpForeign * rate;
        const hasAddlSplit = d.type === 'purchase' && d.addlExpCreditId && addlExpBase > 0;
        const supplierBase = (d.type === 'purchase') ? Math.max(0, baseVal - expBase - addlExpBase) : baseVal;
        
        const addlCreditCategory = hasAddlSplit
            ? (accounts.find(a => a.id === d.addlExpCreditId) ? 'account'
                : parties.find(p => p.id === d.addlExpCreditId) ? 'party'
                    : expenses.find(e => e.id === d.addlExpCreditId) ? 'expense'
                        : null)
            : null;

        const amt = (d.type === 'purchase') ? supplierBase : baseVal;
        
        if (['sales', 'purchase', 'party', 'daybook', 'user'].includes(activeFilter.type)) {
            const isMainParty = activeFilter.type === 'party' && d.partyId === activeFilter.id;
            const isExpCredit = d.addlExpCreditId === activeFilter.id;
            const isDaybook = ['daybook', 'user', 'sales', 'purchase'].includes(activeFilter.type);

            if (isMainParty || isExpCredit || isDaybook) {
                const isDr = d.type === 'sales' || d.type === 'debit_note' || d.type === 'purchase_return';
                const isCr = d.type === 'purchase' || d.type === 'credit_note' || d.type === 'sales_return';

                if (isMainParty || isDaybook) {
                    let finalAmtIn = isDr ? amt : 0;
                    let finalAmtOut = isCr ? amt : 0;

                    if (activeFilter.type === 'purchase') {
                        finalAmtIn = amt; finalAmtOut = 0;
                    }

                    const row = buildRow(doc, d, {
                        amtIn: finalAmtIn,
                        amtOut: finalAmtOut,
                    });
                    allTx.push(row);
                }
            }
        }

        // Add separate ledger row for additional expenses paid via another ledger
        if (hasAddlSplit) {
            const matchesExpenseLedger = addlCreditCategory === 'expense' && activeFilter.type === 'expense' && activeFilter.id === d.addlExpCreditId;
            const matchesPartyLedger = addlCreditCategory === 'party' && activeFilter.type === 'party' && activeFilter.id === d.addlExpCreditId;
            const matchesAccountLedger = addlCreditCategory === 'account' && activeFilter.type === 'account' && activeFilter.id === d.addlExpCreditId;
            const matchesDaybook = ['daybook', 'user'].includes(activeFilter.type);

            if (matchesExpenseLedger || matchesPartyLedger || matchesAccountLedger || matchesDaybook) {
                const expRow = buildRow(doc, d, {
                    amtIn: 0,
                    amtOut: addlExpBase,
                });
                expRow.drName = 'Purchase Cost';
                expRow.crName = findName(d.addlExpCreditId) || 'Paid By';
                expRow.particulars = `${expRow.drName} / ${expRow.crName}`;
                expRow.vchType = 'PURCHASE EXP';
                allTx.push(expRow);
            }
        }

        console.log(JSON.stringify(allTx, null, 2));
    }

    // Payer: IZHAR AHMAD CO KHAWAR
    simulateFilter({ type: 'party', id: 'tq2oXCQMYpfNShjM5OAx' });
    
    // Supplier: MODERN PLASTIC COMPANY L.L.C-O.P.C
    simulateFilter({ type: 'party', id: '76470633-9cae-4719-abde-bfad080c45c0' });

    process.exit(0);
}

run().catch(console.error);
