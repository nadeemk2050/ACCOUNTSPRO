const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: 'cashshams'
    });
}

const db = admin.firestore();
const companyId = '8u57h';

async function run() {
    try {
        const recordsCol = db.collection('companies_live').doc(companyId).collection('records');
        
        // 1. Get accounts and find RAK BANK AL SAHAM ID
        const accountsSnap = await recordsCol.where('collectionName', '==', 'accounts').get();
        let rakId = null;
        accountsSnap.forEach(doc => {
            const d = doc.data().data || {};
            if ((d.name || '').toUpperCase().includes('RAK BANK AL SAHAM')) {
                rakId = doc.id;
                console.log(`Found RAK BANK AL SAHAM: ID=${rakId}, Name=${d.name}`);
            }
        });

        if (!rakId) {
            console.error('RAK BANK AL SAHAM account not found!');
            process.exit(1);
        }

        // Fetch nameMap
        const nameMap = new Map();
        const [partySnap, accSnap, expSnap, assetSnap, capSnap] = await Promise.all([
            recordsCol.where('collectionName', '==', 'parties').get(),
            recordsCol.where('collectionName', '==', 'accounts').get(),
            recordsCol.where('collectionName', '==', 'expenses').get(),
            recordsCol.where('collectionName', '==', 'asset_accounts').get(),
            recordsCol.where('collectionName', '==', 'capital_accounts').get()
        ]);
        partySnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Party'));
        accSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Account'));
        expSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Expense'));
        assetSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Asset'));
        capSnap.forEach(d => nameMap.set(d.id, d.data().data?.name || 'Capital'));

        // 2. Fetch payments, journal_vouchers, invoices
        const [paySnap, jvSnap, invSnap] = await Promise.all([
            recordsCol.where('collectionName', '==', 'payments').get(),
            recordsCol.where('collectionName', '==', 'journal_vouchers').get(),
            recordsCol.where('collectionName', '==', 'invoices').get()
        ]);

        console.log(`Fetched payments: ${paySnap.size}, JVs: ${jvSnap.size}, Invoices: ${invSnap.size}`);

        // Accounts logic calculation
        const stats = { debit: 0, credit: 0 };
        const accTransactions = [];

        // 1. Process Invoices (partyId, addlExpCreditId)
        invSnap.forEach(doc => {
            const item = doc.data();
            if (item.deleted === true) return;
            const d = item.data || {};
            if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

            const rate = Number(d.exchangeRate || 1);
            const amt = Number(d.grandTotal || d.totalAmount || 0) * rate;

            if (d.partyId === rakId) {
                const isDr = ['sales', 'debit_note', 'purchase_return', 'sales_inv'].includes(d.type);
                const isCr = ['purchase', 'credit_note', 'sales_return', 'purchase_inv'].includes(d.type);
                if (isDr) { stats.debit += amt; accTransactions.push({ id: doc.id, type: 'invoice', isDr: true, amt, date: d.date }); }
                if (isCr) { stats.credit += amt; accTransactions.push({ id: doc.id, type: 'invoice', isCr: true, amt, date: d.date }); }
            }
            if (d.addlExpCreditId === rakId && d.addlExpTotal) {
                const expAmt = Number(d.addlExpTotal) * rate;
                stats.credit += expAmt;
                accTransactions.push({ id: doc.id, type: 'invoice-addlExp', isCr: true, amt: expAmt, date: d.date });
            }
        });

        // 2. Process Payments (accountId, splits, targetId)
        paySnap.forEach(doc => {
            const item = doc.data();
            if (item.deleted === true) return;
            const d = item.data || {};
            if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

            const rate = Number(d.exchangeRate || 1);
            const amtBase = Number(d.baseAmount || (d.amount * rate));

            const srcId = d.accountId || d.sourceId;
            if (srcId === rakId) {
                if (d.type === 'in' || d.type === 'receipt') {
                    stats.debit += amtBase;
                    accTransactions.push({ id: doc.id, type: 'payment-src', isDr: true, amt: amtBase, date: d.date, desc: d.description });
                } else {
                    stats.credit += amtBase;
                    accTransactions.push({ id: doc.id, type: 'payment-src', isCr: true, amt: amtBase, date: d.date, desc: d.description });
                }
            }

            const applyTarget = (id, val, type) => {
                if (id !== rakId) return;
                if (type === 'in' || type === 'receipt') {
                    stats.credit += val;
                    accTransactions.push({ id: doc.id, type: 'payment-target', isCr: true, amt: val, date: d.date, desc: d.description });
                } else {
                    stats.debit += val;
                    accTransactions.push({ id: doc.id, type: 'payment-target', isDr: true, amt: val, date: d.date, desc: d.description });
                }
            };

            if (d.isMulti && d.splits) {
                d.splits.forEach(s => {
                    applyTarget(s.targetId, Number(s.amount || 0) * rate, d.type);
                });
            } else {
                let cat = d.transactionCategory;
                let tid = null;
                if (cat === 'party') tid = d.partyId;
                else if (cat === 'expense') tid = d.expenseId;
                else if (cat === 'account' || d.type === 'contra') { cat = 'account'; tid = d.toAccountId; }
                else if (cat === 'capital') tid = d.capitalId;
                else if (cat === 'asset') tid = d.assetId;
                else if (cat === 'income') tid = d.incomeId;

                if (tid) applyTarget(tid, amtBase, d.type);
            }
        });

        // 3. Process Journal Vouchers (drId, crId, rows)
        jvSnap.forEach(doc => {
            const item = doc.data();
            if (item.deleted === true) return;
            const d = item.data || {};
            if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

            const amt = Number(d.amount || 0);

            const applyJV = (id, val, mode) => {
                if (id !== rakId) return;
                if (mode === 'dr') {
                    stats.debit += val;
                    accTransactions.push({ id: doc.id, type: 'jv', isDr: true, amt: val, date: d.date });
                } else {
                    stats.credit += val;
                    accTransactions.push({ id: doc.id, type: 'jv', isCr: true, amt: val, date: d.date });
                }
            };

            if (d.isMulti && d.rows && Array.isArray(d.rows)) {
                d.rows.forEach(r => {
                    applyJV(r.id, Number(r.amount || 0), r.type);
                });
            } else {
                if (d.drId) applyJV(d.drId, amt, 'dr');
                if (d.crId) applyJV(d.crId, amt, 'cr');
            }
        });

        console.log(`\n--- list_accounts dynamic totals ---`);
        console.log(`Debit: ${stats.debit}`);
        console.log(`Credit: ${stats.credit}`);

        // Daybook logic calculation
        let daybookDr = 0;
        let daybookCr = 0;
        const dbTransactions = [];

        const types = ['invoices', 'payments', 'journal_vouchers'];
        const allSnaps = [invSnap, paySnap, jvSnap];

        allSnaps.forEach((snap, idx) => {
            snap.forEach(doc => {
                const item = doc.data();
                if (item.deleted === true) return;
                const d = item.data || {};
                if (d.status === 'deleted' || d.status === 'bulk_deleted' || d.isDeleted === true) return;

                let drName = nameMap.get(d.drAccountId || d.drId) || d.drName || '';
                let crName = nameMap.get(d.crAccountId || d.crId) || d.crName || '';

                if (types[idx] === 'payments') {
                    const bankName = nameMap.get(d.accountId) || d.accountName || '';
                    let otherName = 'Party';
                    
                    const toAccId = d.toAccountId || (d.splits && d.splits[0] && d.splits[0].targetId) || '';
                    
                    if (d.transactionCategory === 'expense') otherName = nameMap.get(d.expenseId) || 'Expense';
                    else if (d.transactionCategory === 'capital') otherName = 'Capital A/c';
                    else if (d.transactionCategory === 'asset') otherName = nameMap.get(d.assetId) || 'Asset';
                    else if (d.transactionCategory === 'income') otherName = nameMap.get(d.incomeId) || 'Income';
                    else if (d.partyId) otherName = nameMap.get(d.partyId) || 'Party';
                    else if (toAccId) otherName = nameMap.get(toAccId) || 'Bank';

                    if (d.isMulti && d.splits && d.splits.length > 0) {
                        const targetNames = d.splits.map(s => nameMap.get(s.targetId)).filter(Boolean);
                        if (targetNames.length > 0) {
                            otherName = targetNames.join(', ');
                        }
                    }

                    if (d.type === 'in' || d.type === 'receipt') {
                        drName = bankName;
                        crName = otherName;
                    } else {
                        drName = otherName;
                        crName = bankName;
                    }
                }

                let amount = 0;
                const rate = Number(d.exchangeRate || 1);
                if (types[idx] === 'invoices') {
                    amount = Number(d.grandTotal || d.totalAmount || 0) * rate;
                } else if (types[idx] === 'payments') {
                    amount = Number(d.baseAmount || (d.amount * rate));
                } else if (types[idx] === 'journal_vouchers') {
                    amount = Number(d.amount || 0);
                }

                const isRakAccount = (nameMap.get(d.accountId || d.partyId) || d.accountName || '').toUpperCase().includes('RAK BANK AL SAHAM');
                const isRakDr = (drName || '').toUpperCase().includes('RAK BANK AL SAHAM');
                const isRakCr = (crName || '').toUpperCase().includes('RAK BANK AL SAHAM');

                if (isRakAccount || isRakDr || isRakCr) {
                    let isDr = isRakDr;
                    let isCr = isRakCr;

                    if (isDr) { daybookDr += amount; }
                    if (isCr) { daybookCr += amount; }

                    dbTransactions.push({
                        id: doc.id,
                        type: types[idx],
                        subType: d.type || '',
                        isDr,
                        isCr,
                        amt: amount,
                        date: d.date,
                        desc: d.description || '',
                        drName,
                        crName
                    });
                }
            });
        });

        console.log(`\n--- list_daybook dynamic totals ---`);
        console.log(`Debit: ${daybookDr}`);
        console.log(`Credit: ${daybookCr}`);

        // Compare
        console.log(`\n--- Comparison (Debit Differences) ---`);
        const accDrMap = new Map(accTransactions.filter(t => t.isDr).map(t => [t.id, t]));
        const dbDrMap = new Map(dbTransactions.filter(t => t.isDr).map(t => [t.id, t]));

        console.log("In Daybook Debit, but NOT in Accounts Debit:");
        for (const [id, t] of dbDrMap.entries()) {
            if (!accDrMap.has(id)) {
                console.log(`ID: ${id}, Date: ${t.date}, Type: ${t.type}/${t.subType}, Amt: ${t.amt}, Desc: ${t.desc}, Dr: ${t.drName}, Cr: ${t.crName}`);
            } else {
                const accT = accDrMap.get(id);
                if (Math.abs(accT.amt - t.amt) > 0.01) {
                    console.log(`ID: ${id} Amount mismatch: Accounts=${accT.amt}, Daybook=${t.amt}`);
                }
            }
        }

        console.log("\nIn Accounts Debit, but NOT in Daybook Debit:");
        for (const [id, t] of accDrMap.entries()) {
            if (!dbDrMap.has(id)) {
                console.log(`ID: ${id}, Date: ${t.date}, Type: ${t.type}, Amt: ${t.amt}, Desc: ${t.desc}`);
            }
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
