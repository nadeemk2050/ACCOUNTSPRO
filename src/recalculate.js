
// --- UNIFIED RECALCULATE SYSTEM (THE "BEST" WAY) ---
const handleRecalculateSystem = async (scope = 'all') => {
    // scope: 'all', 'products', 'parties', 'accounts', 'expenses', 'capital', 'assets', 'income'

    const validScopes = ['all', 'products', 'parties', 'accounts', 'expenses', 'capital', 'assets', 'income'];
    if (!validScopes.includes(scope)) {
        console.error("Invalid scope");
        return;
    }

    const labels = {
        all: "Full System",
        products: "Stock",
        parties: "Party Balances",
        accounts: "Cash/Bank",
        expenses: "Expenses",
        capital: "Capital Accounts",
        assets: "Assets",
        income: "Income Accounts"
    };

    if (!window.confirm(`⚠️ RECALCULATE: ${labels[scope]}\n\nThis will scan ALL transactions and rebuild balances from scratch.\n\nAre you sure you want to proceed?`)) return;

    setToast({ type: 'loading', title: 'Analyzing...', message: 'Fetching system data...' });

    try {
        const targetUid = dataOwnerId || user?.uid;
        if (!targetUid) throw new Error("User session invalid.");

        // 1. FETCH EVERYTHING (Parallel)
        const [
            productsS, partiesS, accountsS, expensesS, capitalS, assetS, incomeS,
            invoicesS, paymentsS, journalsS, stockJournalsS
        ] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'parties'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'accounts'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'expenses'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'capital_accounts'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'asset_accounts'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'income_accounts'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'invoices'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'payments'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'journal_vouchers'), where('userId', '==', targetUid))),
            getDocs(query(collection(db, 'stock_journals'), where('userId', '==', targetUid)))
        ]);

        // 2. INITIALIZE BALANCES (from Opening)
        const bal = {
            products: {}, parties: {}, accounts: {}, expenses: {},
            capital: {}, assets: {}, income: {}
        };

        const init = (snap, key, field = 'openingBalance') => {
            snap.forEach(d => {
                bal[key][d.id] = Number(d.data()[field] || 0);
            });
        };
        init(productsS, 'products', 'openingStock');
        init(partiesS, 'parties');
        init(accountsS, 'accounts');
        init(expensesS, 'expenses');
        init(capitalS, 'capital');
        init(assetS, 'assets');
        init(incomeS, 'income');

        // 3. PROCESS TRANSACTIONS

        // --- INVOICES ---
        invoicesS.forEach(d => {
            const v = d.data();
            const rate = Number(v.exchangeRate || 1);
            // v.totalAmount and v.grandTotal are already stored in base currency.
            const grandTotalBase = Number(v.grandTotal || v.totalAmount || 0);
            // Note: grandTotal usually includes tax/expenses. TotalAmount might be the subtotal. 
            // Standard Tally logic: Customer Ledger hits Grand Total.

            // Stock
            if (v.items) {
                v.items.forEach(i => {
                    const qty = Number(i.quantity || 0);
                    if (v.type === 'purchase' || v.type === 'sales_return') bal.products[i.productId] = (bal.products[i.productId] || 0) + qty;
                    else if (v.type === 'sales' || v.type === 'purchase_return') bal.products[i.productId] = (bal.products[i.productId] || 0) - qty;
                    // Note: debit_note/credit_note usually hit accounting but might also hit stock. 
                    // In this system, they seem to be aliases for returns in some contexts.
                    else if (v.type === 'credit_note') bal.products[i.productId] = (bal.products[i.productId] || 0) + qty; // Sales Return
                    else if (v.type === 'debit_note') bal.products[i.productId] = (bal.products[i.productId] || 0) - qty; // Purchase Return
                });
            }

            // Party Balance
            const addlExpBase = Number(v.addlExpTotal || 0) * rate;
            const supplierBase = (v.type === 'purchase' && v.addlExpCreditId && v.addlExpCreditId !== v.partyId)
                ? Math.max(0, grandTotalBase - addlExpBase)
                : grandTotalBase;

            if (v.partyId) {
                const amt = (v.type === 'purchase') ? supplierBase : grandTotalBase;
                if (v.type === 'sales' || v.type === 'debit_note' || v.type === 'purchase_return') bal.parties[v.partyId] = (bal.parties[v.partyId] || 0) + amt; // Dr (+)
                else if (v.type === 'purchase' || v.type === 'credit_note' || v.type === 'sales_return') bal.parties[v.partyId] = (bal.parties[v.partyId] || 0) - amt; // Cr (-)
            }

            // Expenses paid by Account or Party (Purchase Invoice context)
            if (v.addlExpCreditId && v.addlExpTotal && v.addlExpCreditId !== v.partyId) {
                if (bal.accounts[v.addlExpCreditId] !== undefined) bal.accounts[v.addlExpCreditId] -= addlExpBase;
                else if (bal.parties[v.addlExpCreditId] !== undefined) bal.parties[v.addlExpCreditId] -= addlExpBase;
            }
        });

        // --- PAYMENTS (Base Amount Aware) ---
        paymentsS.forEach(d => {
            const v = d.data();
            const rate = Number(v.exchangeRate || 1);
            // Provide resilience against legacy logic
            // We know that v.totalAmount and v.amount are stored in BASE currency.
            const amtBase = Number(v.baseAmount || v.totalAmount || v.amount || 0);

            // 1. Source (Account)
            const srcId = v.accountId || v.sourceId;
            if (srcId && bal.accounts[srcId] !== undefined) {
                if (v.type === 'in') bal.accounts[srcId] += amtBase; // Dr (+)
                else bal.accounts[srcId] -= amtBase; // Cr (-)
            }

            // 2. Targets
            const applyTarget = (id, cat, val, type) => {
                let map = null;
                if (cat === 'party') map = bal.parties;
                else if (cat === 'account') map = bal.accounts;
                else if (cat === 'expense') map = bal.expenses;
                else if (cat === 'capital') map = bal.capital;
                else if (cat === 'asset') map = bal.assets;
                else if (cat === 'income') map = bal.income;

                if (map && map[id] !== undefined) {
                    // In (Receipt) -> Party Cr (-)
                    if (type === 'in') map[id] -= val;
                    // Out (Payment) -> Party Dr (+), Expense Dr(+)
                    else map[id] += val;
                }
            };

            if (v.isMulti && v.splits) {
                v.splits.forEach(s => {
                    const sBase = Number(s.amount || 0) * rate;
                    applyTarget(s.targetId, s.category, sBase, v.type);
                });
            } else {
                let cat = v.transactionCategory;
                let tid = null;
                if (cat === 'party') tid = v.partyId;
                else if (cat === 'expense') tid = v.expenseId;
                else if (cat === 'account' || v.type === 'contra') { cat = 'account'; tid = v.toAccountId; }
                else if (cat === 'capital') tid = v.capitalId;
                else if (cat === 'asset') tid = v.assetId;
                else if (cat === 'income') tid = v.incomeId;

                if (tid) applyTarget(tid, cat, amtBase, v.type);
            }
        });

        // --- JOURNAL VOUCHERS (Simple & Multi) ---
        journalsS.forEach(d => {
            const v = d.data();
            const amt = Number(v.amount || 0);

            const applyJV = (id, cat, val, mode) => {
                let map = null;
                if (cat === 'party') map = bal.parties;
                else if (cat === 'account') map = bal.accounts;
                else if (cat === 'expense') map = bal.expenses;
                else if (cat === 'capital') map = bal.capital;
                else if (cat === 'asset') map = bal.assets;
                else if (cat === 'income') map = bal.income;

                if (map && map[id] !== undefined) {
                    if (mode === 'dr') map[id] += val;
                    else map[id] -= val;
                }
            };

            // Rows priority
            if (v.isMulti && v.rows && Array.isArray(v.rows)) {
                v.rows.forEach(r => {
                    applyJV(r.id, r.category, Number(r.amount || 0), r.type);
                });
            } else {
                // Simple
                if (v.drId) applyJV(v.drId, v.drType, amt, 'dr');
                if (v.crId) applyJV(v.crId, v.crType, amt, 'cr');
            }
        });

        // --- STOCK JOURNALS ---
        stockJournalsS.forEach(d => {
            const v = d.data();
            if (v.produced) v.produced.forEach(i => bal.products[i.productId] = (bal.products[i.productId] || 0) + Number(i.quantity));
            if (v.consumed) v.consumed.forEach(i => bal.products[i.productId] = (bal.products[i.productId] || 0) - Number(i.quantity));
        });

        // 4. COMMIT UPDATES (Batching)
        setToast({ type: 'loading', title: 'Saving...', message: 'Updating records...' });

        const commit = async (key, colName, field = 'balance') => {
            if (scope !== 'all' && scope !== key) return;

            let batch = writeBatch(db);
            let count = 0;

            for (const [id, val] of Object.entries(bal[key])) {
                // We simply overwrite.
                batch.update(doc(db, colName, id), { [field]: val });
                count++;
                if (count >= 450) {
                    await batch.commit();
                    batch = writeBatch(db);
                    count = 0;
                }
            }
            if (count > 0) await batch.commit();
        };

        await commit('products', 'products', 'currentStock');
        await commit('parties', 'parties');
        await commit('accounts', 'accounts');
        await commit('expenses', 'expenses');
        await commit('capital', 'capital_accounts');
        await commit('assets', 'asset_accounts');
        await commit('income', 'income_accounts');

        setToast({ type: 'success', title: 'Success', message: 'System Recalculation Complete.' });

    } catch (e) {
        console.error(e);
        setToast({ type: 'error', title: 'Failed', message: e.message });
    }
};
