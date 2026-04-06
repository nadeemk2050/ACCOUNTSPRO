// --- UPDATED LEDGER MODAL (With Collapsible Tools & Persistent Header) ---
const LedgerModal = ({ isOpen, onClose, onBack, zIndex, user, dataOwnerId, userRole, parties, products, expenses, incomeAccounts, accounts, capitalAccounts, assetAccounts, taxRates, subUsers = [], initialState, onViewTransaction, onDeleteTransaction, onBulkDelete, savedFilter, onFilterSave, currencySymbol, units }) => {
    const baseUnitSymbol = units?.find(u => u.isBase)?.symbol || 'kg';


    // Filters
    const [filter, setFilter] = useState({ type: 'daybook', id: '', startDate: '', endDate: '' });

    // Currency Filter State
    const [viewCurrency, setViewCurrency] = useState('ALL');
    const [currencies, setCurrencies] = useState([]);

    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandDetails, setExpandDetails] = useState(false);
    const [sortOrder, setSortOrder] = useState('date_desc');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE_DETAILED = 12;
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [viewFilter, setViewFilter] = useState('all');
    const [itemValuationMethod, setItemValuationMethod] = useState('wac'); // 'wac' | 'fifo' | 'last_purchase' | 'last_sold'
    const [showItemConfig, setShowItemConfig] = useState(false);
    const [showOpeningBalance, setShowOpeningBalance] = useState(true);

    // ✅ NEW: State for Collapsible Tools
    const [showTools, setShowTools] = useState(false); // Legacy tools disabled
    const [showSearch, setShowSearch] = useState(false); // ✅ Added for toggleable search

    useEffect(() => {
        if (filter.type !== 'item' && showItemConfig) setShowItemConfig(false);
    }, [filter.type, showItemConfig]);

    // ✅ NEW: Hiding Transactions Logic (Tally Style: Alt+R / Alt+U)
    const [hiddenStack, setHiddenStack] = useState([]); // Stack of arrays of IDs
    const hiddenSet = useMemo(() => new Set(hiddenStack.flat()), [hiddenStack]);

    const handleHideSelected = () => {
        if (selectedIds.size === 0) return alert("Please select transactions to hide first.");
        const idsToHide = Array.from(selectedIds);
        setHiddenStack(prev => [...prev, idsToHide]);
        setSelectedIds(new Set());
    };

    const handleRestoreLast = () => {
        if (hiddenStack.length === 0) return;
        setHiddenStack(prev => prev.slice(0, -1));
    };

    const handleBulkRemove = async () => {
        if (selectedIds.size === 0) return alert("Please select transactions to remove first.");
        
        const itemsToDelete = [];
        selectedIds.forEach(id => {
            const item = fullList.find(t => t.id === id);
            if (item && !item.isOpening) {
                itemsToDelete.push({ id: item.id, type: item.type });
            }
        });

        if (itemsToDelete.length === 0) return;

        if (onBulkDelete) {
            const success = await onBulkDelete(itemsToDelete);
            if (success) {
                setSelectedIds(new Set());
                setTimeout(() => generateReport(), 300);
            }
        }
    };

    // ✅ Reset page on search
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;
            // console.log("Key pressed:", e.key, "Alt:", e.altKey);
            if (e.key === 'F1') {
                e.preventDefault();
                e.stopPropagation();
                setExpandDetails(prev => !prev);
            }
            if (e.altKey && e.key.toLowerCase() === 'r') {
                e.preventDefault();
                e.stopPropagation();
                handleHideSelected();
            }
            if (e.altKey && e.key.toLowerCase() === 'u') {
                e.preventDefault();
                e.stopPropagation();
                handleRestoreLast();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, selectedIds, hiddenStack]);

    // Load Currencies
    useEffect(() => {
        if (!isOpen) return;
        const targetUid = dataOwnerId || user.uid;
        const unsub = onSnapshot(query(collection(db, 'currencies'), where('userId', '==', targetUid)), (snap) => {
            setCurrencies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, [isOpen, dataOwnerId, user]);

    // Helpers
    const safeNum = (val) => isNaN(Number(val)) ? 0 : Number(val);
    const formatCurrency = (amount) => Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatThree = (value) => Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
    const toQtyNum = (val) => {
        if (typeof val === 'string') {
            const cleaned = val.replace(/,/g, '').trim();
            const parsed = Number(cleaned);
            return Number.isNaN(parsed) ? 0 : parsed;
        }
        const parsed = Number(val);
        return Number.isNaN(parsed) ? 0 : parsed;
    };
    const formatQtyInOut = (qtyIn, qtyOut, netOverride) => {
        const hasOverride = netOverride !== undefined && netOverride !== null && !Number.isNaN(Number(typeof netOverride === 'string' ? netOverride.replace(/,/g, '') : netOverride));
        const netQty = hasOverride ? toQtyNum(netOverride) : (toQtyNum(qtyIn) - toQtyNum(qtyOut));
        if (netQty === 0) return '-';
        const absQty = formatThree(Math.abs(netQty));
        return netQty < 0 ? `(${absQty})` : absQty;
    };
    const getQtyMovement = (row, rowIndex, rows) => {
        if (!row) return 0;

        // Always prefer row-native movement so sorting never changes Qty In/Out meaning.
        if (row.qtyIn !== undefined || row.qtyOut !== undefined) return toQtyNum(row.qtyIn) - toQtyNum(row.qtyOut);
        if (row.qtyInOut !== undefined && row.qtyInOut !== null) return toQtyNum(row.qtyInOut);
        if (row.displayQty !== undefined && row.displayQty !== null) return toQtyNum(row.displayQty);
        return 0;
    };
    const formatDate = (d) => {
        if (!d) return '-';
        const [year, month, day] = d.split('-');
        return `${day}/${month}/${year}`;
    };

    const findName = (id) => [...parties, ...accounts, ...expenses, ...(incomeAccounts || []), ...capitalAccounts, ...assetAccounts, ...products, ...taxRates].find(x => x.id === id)?.name || 'Unknown';
    const getProductName = (id) => products.find(p => p.id === id)?.name || 'Unknown Item';

    useEffect(() => {
        if (isOpen) {
            if (initialState) {
                setFilter(prev => ({ ...prev, ...initialState }));
                if (initialState.id) setTimeout(() => generateReport(initialState), 100);
            } else {
                setFilter(prev => ({ ...prev, type: 'daybook', id: '' }));
            }
            setSelectedIds(new Set());
            setCurrentPage(1);
            setSortOrder('date_desc');
            setExpandDetails(false);
            setViewFilter('all');
            setViewCurrency('ALL');
            setShowTools(true); // Open initially so user sees options
            setShowItemConfig(false);
            setShowOpeningBalance(true);
        }
    }, [isOpen, initialState]);

    const toggleSelectAll = (filteredData) => { if (selectedIds.size === filteredData.length) setSelectedIds(new Set()); else setSelectedIds(new Set(filteredData.map(t => t.id))); };
    const toggleSelectRow = (id) => { const newSet = new Set(selectedIds); if (newSet.has(id)) newSet.delete(id); else newSet.add(id); setSelectedIds(newSet); };

    const generateReport = async (overrideFilter = null) => {
        const activeFilter = overrideFilter || filter;
        if (['party', 'account', 'item', 'expense', 'income', 'capital', 'asset', 'tax', 'user'].includes(activeFilter.type) && !activeFilter.id) return;

        setLoading(true); setTransactions([]); setSelectedIds(new Set()); setCurrentPage(1);

        // ✅ AUTO-HIDE TOOLS ON GENERATE
        setShowTools(false);

        const targetUid = dataOwnerId || user.uid;

        try {
            let allTx = [];
            const isSingleLedger = activeFilter.id && ['party', 'account', 'expense', 'income', 'capital', 'asset', 'item'].includes(activeFilter.type);
            const dateConstraints = [];

            // If Single Ledger, fetch ALL history to calculate Opening Balance accurately. 
            // Otherwise (Daybook etc), filter by date at DB level.
            if (!isSingleLedger) {
                if (activeFilter.startDate) dateConstraints.push(where('date', '>=', activeFilter.startDate));
                if (activeFilter.endDate) dateConstraints.push(where('date', '<=', activeFilter.endDate));
            }

            const baseConstraints = [where('userId', '==', targetUid), ...dateConstraints];
            if (userRole === 'data_entry_1') {
                baseConstraints.push(where('createdBy', '==', user.uid));
            }

            // Helper to build row data
            const buildRow = (doc, d, extra) => {
                let drName = '-', crName = '-', typeLabel = d.type ? d.type.toUpperCase() : 'UNKNOWN';

                if (d.type === 'sales') { drName = d.partyName || 'Customer'; crName = 'Sales A/c'; typeLabel = 'SALES INV'; }
                else if (d.type === 'purchase') { drName = 'Purchase A/c'; crName = d.partyName || 'Supplier'; typeLabel = 'PURCHASE INV'; }
                else if (d.type === 'in') {
                    const payerName = d.isMulti
                        ? 'Multiple'
                        : (d.transactionCategory === 'account' || d.toAccountId)
                            ? (accounts.find(a => a.id === d.toAccountId)?.name || 'Cash/Bank')
                            : (findName(d.partyId) || 'Payer');
                    drName = accounts.find(a => a.id === d.accountId)?.name || 'Cash/Bank';
                    crName = payerName;
                    typeLabel = 'RECEIPT';
                }
                else if (d.type === 'out') {
                    const payeeName = d.isMulti
                        ? 'Multiple'
                        : (d.transactionCategory === 'account' || d.toAccountId)
                            ? (accounts.find(a => a.id === d.toAccountId)?.name || 'Cash/Bank')
                            : (findName(d.partyId || d.expenseId) || 'Payee');
                    drName = payeeName;
                    crName = accounts.find(a => a.id === d.accountId)?.name || 'Cash/Bank';
                    typeLabel = 'PAYMENT';
                }
                else if (d.type === 'contra') { drName = accounts.find(a => a.id === d.toAccountId)?.name || 'Receiver'; crName = accounts.find(a => a.id === d.accountId)?.name || 'Giver'; typeLabel = 'CONTRA'; }
                else if (d.type === 'journal') { drName = d.drName || findName(d.drId); crName = d.crName || findName(d.crId); typeLabel = 'JOURNAL'; }
                else if (d.type === 'manufacturing') { drName = 'Production (In)'; crName = 'Consumption (Out)'; typeLabel = 'MFG JOURNAL'; }

                return {
                    id: doc.id, date: d.date || "", ref: d.refNo || (d.type === 'journal' ? 'JV' : (d.type === 'manufacturing' ? 'MFG' : 'PAY')),
                    drName, crName, vchType: typeLabel,

                    // BASE AMOUNTS (Converted)
                    amountIn: extra.amtIn || 0, amountOut: extra.amtOut || 0,
                    qtyIn: extra.qtyIn || 0, qtyOut: extra.qtyOut || 0,
                    rateIn: extra.rateIn || 0, rateOut: extra.rateOut || 0,

                    // FOREIGN AMOUNTS (Original)
                    foreignIn: extra.foreignIn || 0,
                    foreignOut: extra.foreignOut || 0,
                    currencyId: d.currencyId || 'BASE',

                    type: d.type,
                    subItems: d.items || (d.type === 'manufacturing' ? [...(d.produced || []), ...(d.consumed || [])] : []),
                    subSplits: d.splits || [],
                    taxAmount: d.taxAmount, taxName: d.taxName, invExpenses: d.expenses || [],
                    narration: d.narration || d.description || '',
                    createdBy: d.createdBy,
                    searchStr: `${d.refNo} ${drName} ${crName} ${extra.amtIn} ${extra.amtOut} ${d.description || ''} ${d.narration || ''}`.toLowerCase()
                };
            };

            const [invSnap, paySnap, jvSnap, mfgSnap] = await Promise.all([
                getDocs(query(collection(db, 'invoices'), ...baseConstraints)),
                getDocs(query(collection(db, 'payments'), ...baseConstraints)),
                getDocs(query(collection(db, 'journal_vouchers'), ...baseConstraints)),
                getDocs(query(collection(db, 'stock_journals'), ...baseConstraints))
            ]);

            const processDocs = (snap, docType) => {
                snap.forEach(doc => {
                    const d = doc.data();
                    if (activeFilter.type === 'user' && d.createdBy !== activeFilter.id) return;

                    let row = null;
                    const isForeign = d.currencyId && d.currencyId !== 'BASE';
                    const foreignVal = safeNum(d.foreignTotal || d.foreignAmount || 0);
                    const baseVal = safeNum(d.grandTotal || d.totalAmount || d.amount || 0);

                    if (docType === 'inv') {
                        // 🛑 Explicitly block Purchase Vouchers from showing in Expense Ledger
                        // because expenses are capitalized (added to item cost) and not debited to expense ledger.
                        if (activeFilter.type === 'expense' && d.type === 'purchase') return;

                        const amt = baseVal; const fAmt = foreignVal;
                        if (activeFilter.type === 'item') {
                            const matchedItems = d.items?.filter(i => i.productId === activeFilter.id) || [];
                            if (matchedItems.length === 0) return;

                            // Calculate Total Value for THIS item in this invoice (using RIE rate if purchase)
                            const itemVal = matchedItems.reduce((acc, i) => acc + ((safeNum(i.quantity) * safeNum(i.rate)) || 0), 0);
                            const isDr = d.type === 'purchase' || d.type === 'sales_return' || d.type === 'credit_note';

                            // ✅ FIX: Items: Purchase = Debit (In), Sales = Credit (Out)
                            row = buildRow(doc, d, {
                                amtIn: isDr ? itemVal : 0,
                                amtOut: !isDr ? itemVal : 0,
                                foreignIn: 0,
                                foreignOut: 0
                            });
                            // ✅ Return early after adding item row to prevent duplication
                            if (row) allTx.push(row);
                            return;
                        }
                        else if (['sales', 'purchase', 'receipt', 'payment', 'contra', 'party', 'daybook', 'user'].includes(activeFilter.type)) {
                            if (activeFilter.type === 'sales' && d.type !== 'sales') return;
                            if (activeFilter.type === 'purchase' && d.type !== 'purchase') return;
                            if (activeFilter.type === 'receipt' && d.type !== 'in') return;
                            if (activeFilter.type === 'payment' && d.type !== 'out') return;
                            if (activeFilter.type === 'contra' && d.type !== 'contra') return;

                            // 🛑 Check if this transaction matches the filtered entity
                            const isMainParty = activeFilter.type === 'party' && d.partyId === activeFilter.id;
                            const isExpCredit = d.addlExpCreditId === activeFilter.id;
                            const isDaybook = ['daybook', 'user'].includes(activeFilter.type);

                            if (!isMainParty && !isExpCredit && !isDaybook) return;

                            // ✅ FIX: Balanced calculation of additional expenses
                            const rate = safeNum(d.exchangeRate || 1);
                            const addlExpBase = safeNum(d.addlExpTotal) * rate;

                            // If we are looking at the Main Supplier, subtract the addl expense portion from the display base
                            // because the expense is credited to ANOTHER account/party.
                            const supplierBase = (d.type === 'purchase' && d.addlExpCreditId && d.addlExpCreditId !== d.partyId)
                                ? Math.max(0, baseVal - addlExpBase)
                                : baseVal;

                            if (isMainParty || isDaybook) {
                                const isDr = d.type === 'sales' || d.type === 'debit_note' || d.type === 'out' || d.type === 'purchase_return';
                                const isCr = d.type === 'purchase' || d.type === 'credit_note' || d.type === 'in' || d.type === 'sales_return';

                                row = buildRow(doc, d, {
                                    amtIn: isDr ? supplierBase : 0,
                                    amtOut: isCr ? supplierBase : 0,
                                    foreignIn: isForeign && isDr ? fAmt : 0,
                                    foreignOut: isForeign && isCr ? fAmt : 0
                                });
                            }

                            // ✅ Add a separate row if the party is the one who paid the expenses for a purchase
                            if (isExpCredit && d.type === 'purchase' && d.addlExpCreditId !== d.partyId) {
                                const expRow = buildRow(doc, d, {
                                    amtIn: 0,
                                    amtOut: addlExpBase,
                                    foreignIn: 0,
                                    foreignOut: 0
                                });
                                expRow.drName = "Purchase Expenses (Paid By)";
                                // If daybook, we have both rows. If single party ledger, we only have this one.
                                if (isDaybook) allTx.push(expRow);
                                else row = expRow;
                            }
                        }
                        else if (activeFilter.type === 'expense') {
                            // 🛑 Expenses in Purchase Vouchers do NOT show in Expense Ledger (Capitalized).
                            if (d.expenses && d.type !== 'purchase') {
                                d.expenses.forEach(exp => {
                                    if (exp.expenseId === activeFilter.id) {
                                        const expForeign = safeNum(exp.amount);
                                        const expBase = expForeign * safeNum(d.exchangeRate || 1);
                                        allTx.push(buildRow(doc, d, {
                                            amtIn: expBase, amtOut: 0,
                                            foreignIn: isForeign ? expForeign : 0, foreignOut: 0
                                        }));
                                    }
                                });
                            }
                        }

                        // ✅ CHECK FOR "PAID BY" CREDIT (If viewing that account)
                        // If I am viewing 'Cash' or 'Customer' and this purchase voucher has expenses paid by THIS account.
                        if (d.type === 'purchase' && d.addlExpCreditId === activeFilter.id) {
                            const pExp = (safeNum(d.addlExpTotal) || (d.addlExpenses || []).reduce((s, e) => s + safeNum(e.amount), 0));
                            if (pExp > 0 && ['account', 'party'].includes(activeFilter.type)) {
                                // Credit the "Paid By" account (Amount Out)
                                // We push a separate row for this payment aspect of the invoice.
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const pExpBase = pExp * exRate;
                                allTx.push(buildRow(doc, d, {
                                    amtIn: 0, amtOut: pExpBase,
                                    foreignIn: 0, foreignOut: (isForeign ? pExp : 0),
                                    narration: `Exp Pymt: ${d.refNo} (${d.partyName})` // Optional: Make clear this is for expense
                                }));
                            }
                        }
                    }
                    else if (docType === 'pay') {
                        if (['sales', 'purchase', 'item', 'tax'].includes(activeFilter.type)) return;
                        const amt = baseVal; const fAmt = foreignVal;
                        if (activeFilter.type === 'account') {
                            const isSource = d.accountId === activeFilter.id;
                            const isDest = d.type === 'contra' && d.toAccountId === activeFilter.id;
                            const isAccountTransfer = d.type !== 'contra' && !!d.toAccountId && d.transactionCategory !== 'contra';
                            const isTargetAccount = isAccountTransfer && d.toAccountId === activeFilter.id;

                            // ✅ Handle Multi-Split Payments for Accounts
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'account' && s.targetId === activeFilter.id);

                            if (isSource) {
                                const isDr = d.type === 'in';
                                row = buildRow(doc, d, {
                                    amtIn: isDr ? amt : 0,
                                    amtOut: !isDr ? amt : 0,
                                    foreignIn: isDr ? fAmt : 0,
                                    foreignOut: !isDr ? fAmt : 0
                                });
                            }
                            else if (isDest || isTargetAccount) {
                                // For Contra or Account Transfer targets
                                // If voucher is "In" (Receipt), target is the giver (Credit).
                                // If voucher is "Out" or "Contra", target is the receiver (Debit).
                                const isDr = (d.type === 'out' || d.type === 'contra');
                                row = buildRow(doc, d, {
                                    amtIn: isDr ? amt : 0,
                                    amtOut: !isDr ? amt : 0,
                                    foreignIn: isDr ? fAmt : 0,
                                    foreignOut: !isDr ? fAmt : 0
                                });
                            }
                            else if (inSplit) {
                                // Account is in splits
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                // Receipt (in): splits are GIVERS (credit/out), Payment (out): splits are RECEIVERS (debit/in)
                                if (d.type === 'in') {
                                    row = buildRow(doc, d, { amtIn: 0, amtOut: splitBase, foreignIn: 0, foreignOut: isForeign ? splitAmt : 0 });
                                } else {
                                    row = buildRow(doc, d, { amtIn: splitBase, amtOut: 0, foreignIn: isForeign ? splitAmt : 0, foreignOut: 0 });
                                }
                            }
                        }
                        else if (activeFilter.type === 'party') {
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'party' && s.targetId === activeFilter.id);
                            if (!d.isMulti && d.partyId === activeFilter.id) {
                                row = buildRow(doc, d, { amtIn: d.type === 'out' ? amt : 0, amtOut: d.type === 'in' ? amt : 0, foreignIn: d.type === 'out' ? fAmt : 0, foreignOut: d.type === 'in' ? fAmt : 0 });
                            } else if (inSplit) {
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                // Payment (out): party receives (debit), Receipt (in): party gives (credit)
                                if (d.type === 'out') {
                                    row = buildRow(doc, d, { amtIn: splitBase, amtOut: 0, foreignIn: isForeign ? splitAmt : 0, foreignOut: 0 });
                                } else {
                                    row = buildRow(doc, d, { amtIn: 0, amtOut: splitBase, foreignIn: 0, foreignOut: isForeign ? splitAmt : 0 });
                                }
                            }
                        }
                        else if (activeFilter.type === 'expense') {
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'expense' && s.targetId === activeFilter.id);
                            if (!d.isMulti && d.transactionCategory === 'expense' && d.expenseId === activeFilter.id) {
                                const isPaymentOut = d.type === 'out';
                                row = buildRow(doc, d, { amtIn: !isPaymentOut ? amt : 0, amtOut: isPaymentOut ? amt : 0, foreignIn: isForeign && !isPaymentOut ? fAmt : 0, foreignOut: isForeign && isPaymentOut ? fAmt : 0 });
                            } else if (inSplit) {
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                const isPaymentOut = d.type === 'out';
                                row = buildRow(doc, d, { amtIn: !isPaymentOut ? splitBase : 0, amtOut: isPaymentOut ? splitBase : 0, foreignIn: isForeign && !isPaymentOut ? splitAmt : 0, foreignOut: isForeign && isPaymentOut ? splitAmt : 0 });
                            }
                        }
                        else if (activeFilter.type === 'income') {
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'income' && s.targetId === activeFilter.id);
                            if (!d.isMulti && d.transactionCategory === 'income' && d.incomeId === activeFilter.id) {
                                const isCredit = d.type === 'in';
                                row = buildRow(doc, d, { amtIn: !isCredit ? amt : 0, amtOut: isCredit ? amt : 0, foreignIn: isForeign && !isCredit ? fAmt : 0, foreignOut: isForeign && isCredit ? fAmt : 0 });
                            } else if (inSplit) {
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                const isCredit = d.type === 'in';
                                row = buildRow(doc, d, { amtIn: !isCredit ? splitBase : 0, amtOut: isCredit ? splitBase : 0, foreignIn: isForeign && !isCredit ? splitAmt : 0, foreignOut: isForeign && isCredit ? splitAmt : 0 });
                            }
                        }
                        else if (activeFilter.type === 'capital') {
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'capital' && s.targetId === activeFilter.id);
                            if (!d.isMulti && d.transactionCategory === 'capital' && d.capitalId === activeFilter.id) {
                                const isCredit = d.type === 'in';
                                row = buildRow(doc, d, { amtIn: !isCredit ? amt : 0, amtOut: isCredit ? amt : 0, foreignIn: isForeign && !isCredit ? fAmt : 0, foreignOut: isForeign && isCredit ? fAmt : 0 });
                            } else if (inSplit) {
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                const isCredit = d.type === 'in';
                                row = buildRow(doc, d, { amtIn: !isCredit ? splitBase : 0, amtOut: isCredit ? splitBase : 0, foreignIn: isForeign && !isCredit ? splitAmt : 0, foreignOut: isForeign && isCredit ? splitAmt : 0 });
                            }
                        }
                        else if (activeFilter.type === 'asset') {
                            const inSplit = d.isMulti && d.splits && d.splits.find(s => s.category === 'asset' && s.targetId === activeFilter.id);
                            if (!d.isMulti && d.transactionCategory === 'asset' && d.assetId === activeFilter.id) {
                                const isDebit = d.type === 'out';
                                row = buildRow(doc, d, { amtIn: isDebit ? amt : 0, amtOut: !isDebit ? amt : 0, foreignIn: isForeign && isDebit ? fAmt : 0, foreignOut: isForeign && !isDebit ? fAmt : 0 });
                            } else if (inSplit) {
                                const splitAmt = safeNum(inSplit.amount);
                                const exRate = safeNum(d.exchangeRate) || 1;
                                const splitBase = splitAmt * exRate;
                                const isDebit = d.type === 'out';
                                row = buildRow(doc, d, { amtIn: isDebit ? splitBase : 0, amtOut: !isDebit ? splitBase : 0, foreignIn: isForeign && isDebit ? splitAmt : 0, foreignOut: isForeign && !isDebit ? splitAmt : 0 });
                            }
                        }
                        else if (['daybook', 'user', 'receipt', 'payment', 'contra'].includes(activeFilter.type)) {
                            if (activeFilter.type === 'receipt' && d.type !== 'in') return;
                            if (activeFilter.type === 'payment' && d.type !== 'out') return;
                            if (activeFilter.type === 'contra' && d.type !== 'contra') return;
                            row = buildRow(doc, d, { amtIn: d.type === 'in' ? amt : 0, amtOut: d.type !== 'in' ? amt : 0, foreignIn: d.type === 'in' ? fAmt : 0, foreignOut: d.type !== 'in' ? fAmt : 0 });
                        }
                    }
                    else if (docType === 'jv') {
                        // ⚡ Item Balance should NOT be affected by accounting JVs in this system
                        if (activeFilter.type === 'item') return;
                        const amt = baseVal;
                        if (d.isMulti && d.rows) {
                            // ✅ Multi-Line JV Logic
                            if (['daybook', 'user'].includes(activeFilter.type)) {
                                row = buildRow(doc, d, { amtIn: amt, amtOut: amt, foreignIn: 0, foreignOut: 0 });
                            } else {
                                let myDrQty = 0; let myCrQty = 0;
                                let myDrVal = 0; let myCrVal = 0;
                                d.rows.forEach(r => {
                                    if (r.category === activeFilter.type && r.id === activeFilter.id) {
                                        const qty = safeNum(r.amount);
                                        const rate = safeNum(r.rate);
                                        const val = activeFilter.type === 'item' ? (qty * rate) : qty;

                                        if (r.type === 'dr') {
                                            myDrQty += (activeFilter.type === 'item' ? qty : 0);
                                            myDrVal += val;
                                        } else {
                                            myCrQty += (activeFilter.type === 'item' ? qty : 0);
                                            myCrVal += val;
                                        }
                                    }
                                });
                                if (myDrVal > 0 || myCrVal > 0 || myDrQty > 0 || myCrQty > 0) {
                                    row = buildRow(doc, d, {
                                        amtIn: myDrVal, amtOut: myCrVal,
                                        qtyIn: myDrQty, qtyOut: myCrQty,
                                        rateIn: myDrQty > 0 ? myDrVal / myDrQty : 0,
                                        rateOut: myCrQty > 0 ? myCrVal / myCrQty : 0,
                                        foreignIn: 0, foreignOut: 0
                                    });
                                }
                            }
                        } else {
                            // Standard Single JV Logic
                            if (['daybook', 'user', 'journal'].includes(activeFilter.type)) {
                                if (activeFilter.type === 'journal' && d.type !== 'journal') return;
                                row = buildRow(doc, d, { amtIn: amt, amtOut: amt, foreignIn: 0, foreignOut: 0 });
                            }
                            else {
                                let isDr = (d.drType === activeFilter.type && d.drId === activeFilter.id);
                                let isCr = (d.crType === activeFilter.type && d.crId === activeFilter.id);
                                if (isDr || isCr) row = buildRow(doc, d, { amtIn: isDr ? amt : 0, amtOut: isCr ? amt : 0, foreignIn: 0, foreignOut: 0 });
                            }
                        }
                    }
                    else if (docType === 'mfg') {
                        if (['daybook', 'user', 'manufacturing'].includes(activeFilter.type)) {
                            row = buildRow(doc, d, { amtIn: safeNum(d.totalProducedValue), amtOut: safeNum(d.totalProducedValue), foreignIn: 0, foreignOut: 0 });
                        }
                        // ✅ ADD: Item Ledger Support for MFG (Production/Consumption)
                        else if (activeFilter.type === 'item') {
                            const produced = (d.produced || []).filter(i => i.productId === activeFilter.id);
                            const consumed = (d.consumed || []).filter(i => i.productId === activeFilter.id);
                            if (produced.length === 0 && consumed.length === 0) return;

                            const pVal = produced.reduce((s, i) => s + (safeNum(i.quantity) * safeNum(i.rate)), 0);
                            const cVal = consumed.reduce((s, i) => s + (safeNum(i.quantity) * safeNum(i.rate)), 0);

                            const pQty = produced.reduce((s, i) => s + safeNum(i.quantity), 0);
                            const cQty = consumed.reduce((s, i) => s + safeNum(i.quantity), 0);
                            const pRate = pQty > 0 ? pVal / pQty : 0;
                            const cRate = cQty > 0 ? cVal / cQty : 0;

                            row = buildRow(doc, d, {
                                amtIn: pVal,
                                amtOut: cVal,
                                qtyIn: pQty,
                                qtyOut: cQty,
                                rateIn: pRate,
                                rateOut: cRate,
                                foreignIn: 0,
                                foreignOut: 0
                            });
                        }
                    }

                    if (row) allTx.push(row);
                });
            };

            processDocs(invSnap, 'inv');
            processDocs(paySnap, 'pay');
            processDocs(jvSnap, 'jv');
            processDocs(mfgSnap, 'mfg');

            setTransactions(allTx);
        } catch (error) { console.error(error); }
        finally { setLoading(false); }
    };

    const getFilterOptions = () => {
        switch (filter.type) {
            case 'party': return parties;
            case 'account': return accounts;
            case 'expense': return expenses;
            case 'income': return incomeAccounts || [];
            case 'capital': return capitalAccounts;
            case 'asset': return assetAccounts;
            case 'item': return products;
            case 'tax': return taxRates;
            case 'user':
                const allUsers = [
                    { id: user.uid, name: `${user.displayName || 'Myself'} (Current)` },
                    ...(subUsers || []).map(u => ({ id: u.id, name: u.name }))
                ];
                if (dataOwnerId && dataOwnerId !== user.uid && !allUsers.find(u => u.id === dataOwnerId)) {
                    allUsers.push({ id: dataOwnerId, name: 'Admin / Owner' });
                }
                return allUsers;
            default: return [];
        }
    };

    // Data Processing & Display Logic
    const { processedData, totalPages, summary, fullList, displayCurrency } = useMemo(() => {
        let filtered = transactions.filter(t => {
            const matchesSearch = !searchTerm || t.searchStr.includes(searchTerm.toLowerCase());
            let matchesView = true;
            if (viewFilter === 'dr') matchesView = (t.amountIn > 0);
            if (viewFilter === 'cr') matchesView = (t.amountOut > 0);
            let matchesCurrency = true;
            if (viewCurrency !== 'ALL') matchesCurrency = (t.currencyId === viewCurrency);

            // ✅ NEW: Filter Hidden
            const isHidden = hiddenSet.has(t.id);

            return matchesSearch && matchesView && matchesCurrency && !isHidden;
        });

        // ✅ FIX: Handling Opening Balance (Single Ledger)
        let openingBal = 0;
        let showOpening = false;
        let finalDetailedList = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));

        let detailedList = [];

        if (filter.id && ['party', 'account', 'expense', 'income', 'capital', 'asset', 'item'].includes(filter.type)) {
            const ops = getFilterOptions();
            const found = ops.find(o => o.id === filter.id);
            const masterOpeningVal = safeNum(found?.openingBalance || 0);
            const masterOpeningQty = filter.type === 'item' ? safeNum(found?.openingStock || 0) : 0;

            // 1. Initial Opening from Master
            openingBal = masterOpeningVal;
            let openingQty = masterOpeningQty;

            // 2. Adjust for Date Filter (Bring Forward History)
            let currTx = finalDetailedList;

            if (filter.startDate) {
                const start = new Date(filter.startDate).setHours(0, 0, 0, 0);
                const end = filter.endDate ? new Date(filter.endDate).setHours(23, 59, 59, 999) : null;

                const prevTx = [];
                currTx = [];

                finalDetailedList.forEach(t => {
                    const d = new Date(t.date).getTime();
                    if (d < start) prevTx.push(t);
                    else if (!end || d <= end) currTx.push(t);
                });

                // Carry-forward opening from all transactions before start date.
                const prevValMovement = prevTx.reduce((acc, t) => acc + (t.amountIn - t.amountOut), 0);
                openingBal += prevValMovement;

                if (filter.type === 'item') {
                    const prevQtyMovement = prevTx.reduce((acc, t) => {
                        if (t.qtyIn !== undefined || t.qtyOut !== undefined) {
                            return acc + (safeNum(t.qtyIn) - safeNum(t.qtyOut));
                        }

                        let q = 0;
                        if (t.subItems) {
                            const matched = t.subItems.filter(i => i.productId === filter.id);
                            q = matched.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                        }
                        return acc + (t.amountIn > 0 ? q : -q);
                    }, 0);
                    openingQty += prevQtyMovement;
                }
            } else if (filter.endDate) {
                // No start date = All history from beginning.
                // Just filter end date.
                const end = new Date(filter.endDate).setHours(23, 59, 59, 999);
                currTx = finalDetailedList.filter(t => new Date(t.date).getTime() <= end);
            }

            // Item Ledger can hide opening row via Configuration.
            // Other single-ledger statements keep opening row visible.
            showOpening = (filter.type === 'item') ? showOpeningBalance : true;

            const opRate = openingQty !== 0 ? Math.abs(openingBal / openingQty) : 0;

            // 3. Create Opening Row Explicitly
            const opRow = {
                id: 'OP_BAL',
                date: filter.startDate || (currTx.length > 0 ? currTx[0].date : new Date().toISOString().split('T')[0]),
                vchType: 'OPENING',
                ref: '',
                drName: 'Opening Balance',
                crName: 'Brought Forward',
                amountIn: openingBal > 0 ? openingBal : 0,
                amountOut: openingBal < 0 ? Math.abs(openingBal) : 0,
                qtyIn: openingQty > 0 ? openingQty : 0,
                qtyOut: openingQty < 0 ? Math.abs(openingQty) : 0,
                searchStr: 'opening balance brought forward',
                // Pre-calculate display values
                displayIn: openingBal > 0 ? openingBal : 0,
                displayOut: openingBal < 0 ? Math.abs(openingBal) : 0,
                displayBalance: openingBal,
                displayQty: Math.abs(openingQty),
                displayBalanceQty: openingQty,
                displayRate: opRate > 0 ? opRate.toFixed(3) : '-',
                isOpening: true
            };

            // 4. Construct Final List
            detailedList = showOpening ? [opRow, ...currTx] : currTx;

        } else {
            // Multi-Ledger / Daybook: No opening row, just filtered list
            detailedList = finalDetailedList;
        }

        let runningTotal = 0; // Initialize 0, Opening Row adds to it
        let runningQty = 0;

        // ✅ Accumulators for Qty/Rate
        let qtyTotal = 0;
        let valTotal = 0; // For Weighted Avg Rate

        detailedList = detailedList.map(t => {
            let dr = 0, cr = 0;
            if (t.isOpening) {
                dr = t.amountIn;
                cr = t.amountOut;
                runningTotal = t.displayBalance;
                runningQty = t.displayBalanceQty;
                if (filter.type === 'item') {
                    inQtySum += safeNum(t.qtyIn);
                    outQtySum += safeNum(t.qtyOut);
                    if (safeNum(t.qtyIn) > 0) inValSum += t.amountIn;
                }
                return t;
            } else {
                if (viewCurrency !== 'ALL') { dr = t.foreignIn || 0; cr = t.foreignOut || 0; }
                else { dr = t.amountIn || 0; cr = t.amountOut || 0; }
            }

            // ✅ NEW: Calculate Qty & Rate
            let dQty = 0;
            let dRate = '-';

            if (filter.type === 'item') {
                // For Item Ledger, sum ALL occurrences of this item in the invoice
                // (User might have entered the same item multiple times)
                if (t.isOpening) {
                    dQty = t.displayQty; // Set fromOpeningRow calculation
                } else if (t.vchType === 'MFG JOURNAL' || t.vchType === 'JOURNAL') {
                    // For MFG and JVs, we have explicit Qty In/Out
                    dQty = safeNum(t.qtyIn) - safeNum(t.qtyOut);

                    // Show rate if it's a single-sided movement
                    if (safeNum(t.qtyIn) > 0 && safeNum(t.qtyOut) === 0) dRate = safeNum(t.rateIn || (t.amountIn / t.qtyIn)).toFixed(3);
                    else if (safeNum(t.qtyOut) > 0 && safeNum(t.qtyIn) === 0) dRate = safeNum(t.rateOut || (t.amountOut / t.qtyOut)).toFixed(3);
                } else if (t.subItems) {
                    const matchedItems = t.subItems.filter(i => i.productId === filter.id);
                    if (matchedItems.length > 0) {
                        const q = matchedItems.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
                        // Inwards (+), Outwards (-)
                        dQty = (t.amountIn > 0) ? q : -q;

                        // Calculate Effective Rate (RIE)
                        const totalItemVal = matchedItems.reduce((acc, i) => acc + ((Number(i.quantity) || 0) * (Number(i.rate) || 0)), 0);
                        if (q > 0) dRate = (totalItemVal / q).toFixed(3);

                        qtyTotal += q;
                        valTotal += totalItemVal;
                    }
                }
                // Update running quantity
                runningQty += dQty;
            } else if (['purchase', 'sales', 'party', 'account', 'daybook'].includes(filter.type)) {
                // Generic Item Summation for other ledgers
                if (t.subItems && t.subItems.length > 0) {
                    dQty = t.subItems.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
                    qtyTotal += dQty;
                    // If single item, show rate, otherwise ambiguous
                    if (t.subItems.length === 1) dRate = Number(t.subItems[0].rate) || 0;
                }
            }

            runningTotal = runningTotal + (dr - cr);
            return { ...t, displayIn: dr, displayOut: cr, displayBalance: runningTotal, displayQty: dQty, displayBalanceQty: runningQty, displayRate: dRate };
        });

        const sum = { debit: 0, credit: 0, balance: 0, count: detailedList.length, totalQty: qtyTotal, avgRate: 0, balanceQty: runningQty };

        // Calculate Avg Rate (Only for Item Ledger)
        if (filter.type === 'item' && qtyTotal > 0) {
            sum.avgRate = valTotal / qtyTotal;
        }

        // Calculate Sums
        detailedList.forEach(t => {
            if (!t.isOpening) {
                sum.debit += t.displayIn;
                sum.credit += t.displayOut;
            }
        });
        sum.balance = runningTotal; // Closing Balance
        sum.balanceQty = runningQty; // Closing Qty Balance

        // Closing stock value by valuation method (Item Ledger only).
        if (filter.type === 'item') {
            const getItemClosingValue = (rows, method) => {
                let qtyOnHand = 0;
                let wacValue = 0;
                let lastPurchaseRate = 0;
                let lastSoldRate = 0;
                const fifoLayers = [];

                rows.forEach(r => {
                    let qIn = safeNum(r.qtyIn);
                    let qOut = safeNum(r.qtyOut);

                    if (qIn === 0 && qOut === 0) {
                        const movement = safeNum(r.displayQty);
                        if (movement > 0) qIn = movement;
                        else if (movement < 0) qOut = Math.abs(movement);
                    }

                    const inAmt = safeNum(r.amountIn ?? r.displayIn);
                    const outAmt = safeNum(r.amountOut ?? r.displayOut);

                    if (qIn > 0) {
                        const inRate = safeNum(r.rateIn || (qIn !== 0 ? (inAmt / qIn) : 0));
                        lastPurchaseRate = inRate || lastPurchaseRate;

                        qtyOnHand += qIn;
                        wacValue += inAmt;
                        fifoLayers.push({ qty: qIn, rate: inRate });
                    }

                    if (qOut > 0) {
                        const outRate = safeNum(r.rateOut || (qOut !== 0 ? (outAmt / qOut) : 0));
                        lastSoldRate = outRate || lastSoldRate;

                        const avgRate = qtyOnHand !== 0 ? (wacValue / qtyOnHand) : (lastPurchaseRate || 0);
                        qtyOnHand -= qOut;
                        wacValue -= (qOut * avgRate);

                        let remaining = qOut;
                        while (remaining > 0 && fifoLayers.length > 0) {
                            const head = fifoLayers[0];
                            if (head.qty <= remaining) {
                                remaining -= head.qty;
                                fifoLayers.shift();
                            } else {
                                head.qty -= remaining;
                                remaining = 0;
                            }
                        }

                        if (remaining > 0) {
                            const fallbackRate = lastPurchaseRate || avgRate || 0;
                            fifoLayers.unshift({ qty: -remaining, rate: fallbackRate });
                        }
                    }
                });

                if (method === 'fifo') {
                    return fifoLayers.reduce((s, l) => s + (safeNum(l.qty) * safeNum(l.rate)), 0);
                }
                if (method === 'last_purchase') {
                    return safeNum(runningQty) * (lastPurchaseRate || 0);
                }
                if (method === 'last_sold') {
                    return safeNum(runningQty) * (lastSoldRate || lastPurchaseRate || 0);
                }
                return wacValue;
            };

            sum.balance = getItemClosingValue(detailedList, itemValuationMethod);
        }

        if (sortOrder === 'date_desc') detailedList.reverse();

        // ✅ NEW: Sort by Ref logic
        if (sortOrder === 'ref_asc') {
            detailedList.sort((a, b) => {
                const numA = parseFloat(a.ref) || 0;
                const numB = parseFloat(b.ref) || 0;
                if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
                return (a.ref || "").localeCompare(b.ref || "", undefined, { numeric: true, sensitivity: 'base' });
            });
        }
        if (sortOrder === 'ref_desc') {
            detailedList.sort((a, b) => {
                const numA = parseFloat(a.ref) || 0;
                const numB = parseFloat(b.ref) || 0;
                if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numB - numA;
                return (b.ref || "").localeCompare(a.ref || "", undefined, { numeric: true, sensitivity: 'base' });
            });
        }

        const itemsPerPage = ITEMS_PER_PAGE_DETAILED;
        const total = Math.ceil(detailedList.length / itemsPerPage);
        const start = (currentPage - 1) * itemsPerPage;

        let sym = currencySymbol;
        if (viewCurrency !== 'ALL') {
            const c = currencies.find(x => x.id === viewCurrency);
            if (c) sym = c.symbol;
        }

        return {
            processedData: detailedList.slice(start, start + itemsPerPage),
            totalPages: total,
            summary: sum,
            fullList: detailedList,
            displayCurrency: sym
        };
    }, [transactions, searchTerm, sortOrder, currentPage, viewFilter, viewCurrency, itemValuationMethod, showOpeningBalance, hiddenSet, filter.id, filter.type, filter.startDate, filter.endDate, parties, accounts, expenses, incomeAccounts, capitalAccounts, assetAccounts, products, taxRates, subUsers]);

    const downloadPDF = () => { if (fullList.length === 0) return alert("No data"); const doc = new jsPDF('l', 'mm', 'a4'); doc.setFontSize(10); doc.text(`Ledger: ${filter.type.toUpperCase()} (${displayCurrency})`, 14, 15); autoTable(doc, { head: [["Date", "Ref", "Type", "Particulars", "Debit", "Credit", "Balance"]], body: fullList.map(r => [formatDate(r.date), r.ref, r.vchType, `${r.drName}/${r.crName}`, formatCurrency(r.displayIn), formatCurrency(r.displayOut), formatCurrency(r.displayBalance)]), startY: 25, styles: { fontSize: 8 } }); doc.save(`Ledger_${filter.type}.pdf`); };
    const downloadExcel = () => { if (fullList.length === 0) return alert("No data"); const data = fullList.map(r => ({ Date: formatDate(r.date), Ref: r.ref, Type: r.vchType, DebitAccount: r.drName, CreditAccount: r.crName, Debit: r.displayIn, Credit: r.displayOut, Balance: r.displayBalance, Narration: r.narration })); const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ledger"); XLSX.writeFile(wb, `Ledger_${filter.type}.xlsx`); };
    const itemClosingAvgRate = (filter.type === 'item' && Math.abs(safeNum(summary.balanceQty)) > 0)
        ? Math.abs(safeNum(summary.balance) / safeNum(summary.balanceQty))
        : 0;

    // --- REPORT HEADER HELPERS ---
    const getReportTitle = () => {
        const typeMap = {
            item: "Item Ledger",
            user: "User / Staff Report",
            receipt: "Receipt Register",
            payment: "Payment Register",
            contra: "Contra Register",
            journal: "Journal Register",
            manufacturing: "Manufacturing Register"
        };
        let title = typeMap[filter.type] || filter.type.toUpperCase();

        if (filter.id && ['party', 'account', 'expense', 'income', 'capital', 'asset', 'item', 'user'].includes(filter.type)) {
            const options = getFilterOptions();
            const found = options.find(o => o.id === filter.id);
            if (found) title += ` : ${found.name}`;
            else {
                const fallback = filter.type === 'item' ? getProductName(filter.id) : findName(filter.id);
                if (fallback && fallback !== 'Unknown') title += ` : ${fallback}`;
            }
        }
        return title;
    };

    const getReportDuration = () => {
        const start = filter.startDate ? formatDate(filter.startDate) : null;
        const end = filter.endDate ? formatDate(filter.endDate) : null;

        if (start && end) return `${start} ➔ ${end}`;
        if (start) return `From ${start}`;
        if (end) return `Until ${end}`;
        return "All Time";
    };

    if (!isOpen) return null;

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            onBack={onBack} 
            zIndex={zIndex} 
            maxWidth="max-w-[98vw]" 
            defaultMaximized={true} 
            removePadding={true} 
            noContentScroll={true}
            title={(
                <div className="flex items-center justify-between w-full pr-8">
                    <div className="flex items-center gap-4">
                        {/* 1. Report Identity */}
                        <div className="flex flex-col shrink-0 min-w-[160px]">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">System Report</span>
                            <div className="bg-slate-100 px-2 py-1 rounded border border-slate-200 w-fit">
                                <span className="text-slate-900 font-extrabold text-sm uppercase leading-none">{getReportTitle()}</span>
                            </div>
                        </div>

                        {/* 2. Unified Tool groups */}
                        <div className="flex items-center gap-2 bg-white p-1 px-2 rounded border border-slate-200 shadow-sm overflow-hidden">
                            {/* Period Group */}
                            <div className="flex flex-col border-r border-slate-200 pr-2">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">Report Period</span>
                                <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap leading-none py-0.5">{getReportDuration()}</span>
                            </div>

                            {/* Currency group */}
                            <div className="flex flex-col border-r border-slate-200 pr-2 pl-1">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">Currency</span>
                                <select className="text-[10px] font-bold text-purple-700 bg-transparent border-none focus:ring-0 p-0 cursor-pointer" value={viewCurrency} onChange={(e) => setViewCurrency(e.target.value)}>
                                    <option value="ALL">All ({currencySymbol})</option>
                                    {currencies.filter(c => !c.isBase).map(c => (<option key={c.id} value={c.id}>{c.symbol}</option>))}
                                </select>
                            </div>

                            {/* Search Group */}
                            <div className="flex items-center gap-1.5 px-1">
                                <Search size={12} className="text-slate-400" />
                                <input 
                                    type="text" 
                                    placeholder="LOOKUP..." 
                                    className="w-20 text-[10px] font-black border-none bg-transparent focus:ring-0 p-0 uppercase placeholder:text-slate-300" 
                                    value={searchTerm} 
                                    onChange={(e) => setSearchTerm(e.target.value)} 
                                />
                            </div>

                            {filter.type === 'item' && (
                                <>
                                    <div className="flex flex-col border-l border-slate-200 pl-2">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">Valuation</span>
                                        <select
                                            className="text-[10px] font-bold text-amber-700 bg-transparent border-none focus:ring-0 p-0 cursor-pointer"
                                            value={itemValuationMethod}
                                            onChange={(e) => setItemValuationMethod(e.target.value)}
                                        >
                                            <option value="wac">WAC</option>
                                            <option value="fifo">FIFO</option>
                                            <option value="last_purchase">LAST PURCHASE</option>
                                            <option value="last_sold">LAST SOLD</option>
                                        </select>
                                    </div>

                                    <div className="pl-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowItemConfig(v => !v)}
                                            className={`px-2 py-1 rounded text-[10px] font-black border transition-colors ${showItemConfig ? 'bg-slate-200 border-slate-400 text-slate-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                                            title="Item Ledger Configuration"
                                        >
                                            CONFIGURATION
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        <button onClick={generateReport} className="ml-2 p-1.5 px-4 bg-blue-600 text-white rounded text-[10px] font-black hover:bg-blue-700 transition-all flex items-center gap-1 shadow-md active:scale-95 uppercase tracking-tighter">
                            {loading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div> : "Reload"}
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="bg-blue-900/5 px-3 py-1 rounded border border-blue-100 hidden md:flex flex-col items-center">
                            <span className="text-[10px] font-bold text-blue-900">{companyProfile?.companyName || 'Main Company'}</span>
                            <span className="text-[8px] text-blue-400 uppercase font-black tracking-widest leading-none mt-0.5">Active Entity</span>
                        </div>

                        <div className="w-px h-8 bg-slate-200 mx-1"></div>

                        <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-500 hover:text-white text-red-500 border border-red-100 rounded font-black text-xs transition-all active:scale-90 shadow-sm">
                            <span className="text-[9px] uppercase tracking-widest leading-none">Quit</span>
                            <X size={14} strokeWidth={3} />
                        </button>
                    </div>
                </div>
            )}
        >
            <div className="flex flex-col h-full bg-white">
                {/* --- COMPACT TOP-BAR (STILL NEEDED FOR OTHER ACTIONS IF ANY) --- */}
                <div className="flex justify-between items-center gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50/30">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Register Tools:</span>
                        {/* F1 Details Toggle */}
                        {transactions.length > 0 && (
                            <button onClick={() => setExpandDetails(!expandDetails)} className={`flex items-center gap-2 px-3 py-1 rounded text-[10px] font-black transition-all border ${expandDetails ? 'bg-purple-600 text-white border-purple-700 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>
                                <LayoutGrid size={12} /> {expandDetails ? 'CONDENSED VIEW' : 'EXPANDED (F1)'}
                            </button>
                        )}
                    </div>

                    {/* 2. PERSISTENT ACTION BUTTONS (Always Visible) */}
                    <div className="flex items-center gap-2">
                        {/* F1 Details Toggle */}
                        {transactions.length > 0 && (
                            <button onClick={() => setExpandDetails(!expandDetails)} className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all border ${expandDetails ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-white text-slate-500 border-slate-200'}`}>
                                <LayoutGrid size={14} /> {expandDetails ? 'Condensed' : 'F1 Detail'}
                            </button>
                        )}

                        {/* Downloads */}
                        {transactions.length > 0 && (
                            <div className="flex bg-white rounded-full border border-gray-200 shadow-sm p-0.5">
                                <button onClick={downloadPDF} className="p-2 rounded-full text-red-600 hover:bg-red-50 transition-all hover:scale-105" title="Download PDF"><FileText size={18} strokeWidth={2} /></button>
                                <div className="w-px bg-gray-200 my-1"></div>
                                <button onClick={downloadExcel} className="p-2 rounded-full text-green-600 hover:bg-green-50 transition-all hover:scale-105" title="Download Excel"><FileSpreadsheet size={18} strokeWidth={2} /></button>
                            </div>
                        )}

                        {/* 3. SHOW / HIDE CONTROLS (Floating Prominent Buttons) */}
                        {(hiddenStack.length > 0 || selectedIds.size > 0) && (
                            <div className="flex items-center gap-2 ml-auto lg:ml-4 border-l pl-4 border-gray-200">
                                {hiddenStack.length > 0 && (
                                    <button onClick={handleRestoreLast} className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-800 border border-orange-300 rounded shadow-sm text-xs md:text-sm font-bold hover:bg-orange-200 transition-all active:scale-95" title="Restore Last Hidden (Alt+U)">
                                        <span className="text-lg">↩</span> Restore ({hiddenStack.length})
                                    </button>
                                )}
                                {selectedIds.size > 0 && (
                                    <div className="flex items-center gap-1">
                                        <button onClick={handleHideSelected} className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-800 border border-blue-200 rounded shadow-sm text-xs md:text-sm font-bold hover:bg-blue-100 transition-all active:scale-95" title="Hide Selected (Alt+R)">
                                            <span>👁️</span> Hide ({selectedIds.size})
                                        </button>
                                        <button onClick={handleBulkRemove} className="flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-800 border border-red-300 rounded shadow-sm text-xs md:text-sm font-bold hover:bg-red-200 transition-all active:scale-95 animate-pulse" title="Delete Selected Permanently">
                                            <Trash2 size={16} /> Remove ({selectedIds.size})
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>


                {/* --- REPORT HEADER (Title & Duration) --- */}
                {
                    !showTools && (
                        <div className="mb-4 text-center border-b border-gray-100 pb-2">
                            <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">{getReportTitle()}</h2>
                            <p className="text-xs md:text-sm font-bold text-slate-500 uppercase tracking-wide mt-1 flex items-center justify-center gap-2">
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600">Period:</span>
                                {getReportDuration()}
                            </p>
                        </div>
                    )
                }

                {/* --- SUMMARY STRIP --- */}
                {
                    fullList.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 mb-3 bg-white border rounded-lg shadow-sm select-none">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2"><span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Records</span><span className="text-[10px] font-black text-slate-700">{summary.count}</span></div>
                            <div className="hidden sm:block h-4 w-px bg-gray-200"></div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2"><span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Debit</span><span className="text-[10px] font-black text-green-600">{displayCurrency} {formatCurrency(summary.debit)}</span></div>
                            <div className="hidden sm:block h-4 w-px bg-gray-200"></div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2"><span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Credit</span><span className="text-[10px] font-black text-red-600">{displayCurrency} {formatCurrency(summary.credit)}</span></div>
                            <div className="hidden sm:block h-4 w-px bg-gray-200"></div>
                            <div className="flex flex-col gap-0.5">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Balance</span>
                                    <span className={`text-[10px] font-black ${summary.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{displayCurrency} {formatCurrency(Math.abs(summary.balance))} {summary.balance < 0 ? 'Cr' : 'Dr'}</span>
                                </div>
                                {filter.type === 'item' && (
                                    <div className="text-[9px] font-bold text-slate-500 leading-tight">
                                        Avg Rate: {displayCurrency} {formatCurrency(itemClosingAvgRate)}
                                    </div>
                                )}
                            </div>

                            {/* ✅ NEW: Quantity & Rate Summaries */}
                            {['purchase', 'sales', 'party', 'account', 'item', 'daybook'].includes(filter.type) && (
                                <>
                                    <div className="hidden sm:block h-4 w-px bg-gray-200"></div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total {baseUnitSymbol}</span>
                                        <span className="text-[10px] font-black text-purple-600">{summary.totalQty?.toLocaleString() || 0}</span>
                                    </div>
                                </>
                            )}
                            {filter.type === 'item' && (
                                <>
                                    <div className="hidden sm:block h-4 w-px bg-gray-200"></div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Avg Rate</span>
                                        <span className="text-[10px] font-black text-orange-600">{displayCurrency} {formatCurrency(summary.avgRate)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    )
                }

                {/* --- DATA TABLE --- */}
                <div className="flex-1 min-h-0 border-t border-b md:border rounded-lg overflow-x-auto overflow-y-auto -mx-4 md:mx-0">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-800 text-white sticky top-0 z-10">
                            <tr className="text-[10px] md:text-xs uppercase whitespace-nowrap">
                                <th className="p-2 md:p-3 w-8 text-center bg-slate-900"><input type="checkbox" onChange={() => toggleSelectAll(fullList)} /></th>
                                <th className="p-2 md:p-3">Date</th>
                                <th className="p-2 md:p-3">Particulars</th>
                                <th className="p-2 md:p-3">Ref No.</th>

                                {/* ✅ NEW: Qty / Rate Columns */}
                                {['purchase', 'sales', 'party', 'account', 'item', 'daybook'].includes(filter.type) && (
                                    <>
                                        <th className="p-2 md:p-3 text-center bg-slate-700">{baseUnitSymbol}</th>
                                        <th className="p-2 md:p-3 text-center bg-slate-700">Rate</th>
                                    </>
                                )}

                                <th className="p-2 md:p-3 text-right bg-green-900/30">Debit ({displayCurrency})</th>
                                <th className="p-2 md:p-3 text-right bg-red-900/30">Credit ({displayCurrency})</th>
                                {filter.type === 'item' && <th className="p-2 md:p-3 text-right bg-indigo-900/40">Qty In/Out</th>}
                                <th className="p-2 md:p-3 text-right bg-slate-900">Balance</th>
                                {filter.type === 'item' && <th className="p-2 md:p-3 text-right bg-blue-900/50">Bal Qty</th>}
                                <th className="p-2 md:p-3 text-center">Act</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? <tr><td colSpan="10" className="p-8 text-center"><LoadingSpinner /></td></tr> :
                                processedData.map((row, i) => (
                                    <React.Fragment key={i}>
                                        <tr onClick={() => onViewTransaction(row.id, row.type)} className={`hover:bg-blue-50 cursor-pointer transition-colors border-b text-[10px] md:text-sm whitespace-nowrap ${selectedIds.has(row.id) ? 'bg-blue-50' : ''}`}>
                                            <td className="p-2 md:p-3 text-center" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelectRow(row.id)} /></td>
                                            <td className="p-2 md:p-3 text-slate-600 align-top">{formatDate(row.date)}</td>
                                            <td className="p-2 md:p-3 align-top">
                                                <div className="font-bold text-slate-700 truncate max-w-[150px]">{row.drName}</div>
                                                <div className="text-[10px] text-slate-500 truncate max-w-[150px]">{row.crName}</div>
                                            </td>
                                            <td className="p-2 md:p-3 text-blue-600 font-mono align-top">{row.ref}</td>

                                            {/* ✅ NEW: Qty / Rate Cells */}
                                            {['purchase', 'sales', 'party', 'account', 'item', 'daybook'].includes(filter.type) && (
                                                <>
                                                    <td className="p-2 md:p-3 text-center font-mono align-top">{row.displayQty > 0 ? row.displayQty : '-'}</td>
                                                    <td className="p-2 md:p-3 text-center font-mono align-top">{row.displayRate && row.displayRate !== '-' ? formatCurrency(row.displayRate) : '-'}</td>
                                                </>
                                            )}

                                            <td className="p-2 md:p-3 text-right font-mono font-bold text-green-700 bg-green-50/30 align-top">{row.displayIn > 0 ? formatCurrency(row.displayIn) : '-'}</td>
                                            <td className="p-2 md:p-3 text-right font-mono font-bold text-red-700 bg-red-50/30 align-top">{row.displayOut > 0 ? formatCurrency(row.displayOut) : '-'}</td>
                                            {filter.type === 'item' && (
                                                <td className={`p-2 md:p-3 text-right font-mono font-bold align-top ${getQtyMovement(row, i, processedData) < 0 ? 'text-red-700' : (getQtyMovement(row, i, processedData) > 0 ? 'text-green-700' : 'text-slate-300')}`}>
                                                    {formatQtyInOut(row.qtyIn, row.qtyOut, getQtyMovement(row, i, processedData))}
                                                </td>
                                            )}
                                            <td className={`p-2 md:p-3 text-right font-mono font-bold border-l-2 align-top ${row.displayBalance < 0 ? 'text-red-600' : 'text-blue-600'}`}>{formatCurrency(Math.abs(row.displayBalance))}{row.displayBalance < 0 ? ' Cr' : ' Dr'}</td>
                                            {filter.type === 'item' && <td className="p-2 md:p-3 text-right font-mono font-bold bg-blue-50/30 align-top text-blue-900">{row.displayBalanceQty.toLocaleString()}</td>}

                                            <td className="p-2 md:p-3 text-center align-top flex justify-center gap-1">
                                                <button onClick={(e) => { e.stopPropagation(); onViewTransaction(row.id, row.type); }} className="p-1 bg-blue-100 text-blue-600 rounded" title="Edit"><Edit size={12} /></button>
                                                {(!['data_entry_1', 'data_entry_2', 'data_entry_3'].includes(userRole) || row.createdBy === user.uid) && (
                                                    <button onClick={async (e) => { e.stopPropagation(); const ok = await onDeleteTransaction(row.id, row.type); if (ok) setTransactions(prev => prev.filter(t => t.id !== row.id)); }} className="p-1 bg-red-100 text-red-600 rounded" title="Delete">
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {expandDetails && (
                                            <tr className="bg-slate-50/10 border-b border-slate-100 animate-in slide-in-from-top-1 duration-200">
                                                <td colSpan="2"></td>
                                                <td colSpan="8" className="py-2 pr-10 pl-4">
                                                    <div className="flex flex-col gap-2">
                                                        {/* --- 1. PRODUCT / ITEM BREAKUP (FOR INVOICES) --- */}
                                                        {row.subItems && row.subItems.length > 0 && (
                                                            <div className="space-y-0.5">
                                                                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-0.5 mb-1">Item Breakdown</div>
                                                                {row.subItems.map((item, idx) => (
                                                                    <div key={`item-${idx}`} className="flex justify-between text-[11px] text-slate-500 italic">
                                                                        <span>{getProductName(item.productId)} ({item.quantity} x {item.rate})</span>
                                                                        <span className="font-mono text-slate-700">{formatCurrency(item.quantity * item.rate)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* --- 2. TRANSACTION / SPLIT BREAKUP (WITH PAYMENT AGAINST) --- */}
                                                        {row.subSplits && row.subSplits.length > 0 && (
                                                            <div className="space-y-1.5">
                                                                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-0.5 mb-1">Account Breakup & References</div>
                                                                {row.subSplits.map((split, sidx) => (
                                                                    <div key={sidx} className="flex flex-col pl-3 border-l-2 border-slate-200 pb-1">
                                                                        <div className="flex justify-between items-center">
                                                                            <span className="text-[11px] font-bold text-slate-700">{findName(split.targetId)}</span>
                                                                            <span className="text-[11px] font-mono text-slate-800">{formatCurrency(split.amount)}</span>
                                                                        </div>
                                                                        {split.paymentAgainst && (
                                                                            <div className="flex items-center gap-2 text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded w-fit mt-1 uppercase tracking-tighter shadow-sm border border-blue-100 transition-all hover:bg-blue-100">
                                                                                <span className="opacity-50 italic">Against:</span>
                                                                                <span className="tracking-wide">{split.paymentAgainst}</span>
                                                                                {split.paymentAgainst === 'bill' && <span className="text-blue-900/60 font-mono ml-1 border-l pl-2 border-blue-200">Ref: {split.billRefNo || '---'}</span>}
                                                                                {split.paymentAgainst === 'loan' && split.loanReturnDate && <span className="text-blue-900/60 font-mono ml-1 border-l pl-2 border-blue-200">Due: {formatDate(split.loanReturnDate)}</span>}
                                                                                {split.paymentAgainst === 'advance' && split.poNumber && <span className="text-blue-900/60 font-mono ml-1 border-l pl-2 border-blue-200">PO#: {split.poNumber}</span>}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* --- 3. NARRATION --- */}
                                                        {row.narration && (
                                                            <div className="mt-1 p-2 bg-slate-50 border border-slate-100 rounded-md text-[11px] text-slate-600 flex gap-2">
                                                                <span className="font-bold text-slate-400 uppercase text-[9px] tracking-widest leading-none mt-1">Narration:</span>
                                                                <span className="leading-relaxed">{row.narration}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            }
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {
                    totalPages > 1 && (
                        <div className="flex justify-between items-center mt-4 bg-slate-50 p-2 rounded-lg border border-slate-200">
                            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="px-3 py-1 bg-white border rounded hover:bg-slate-100 text-xs font-bold">Previous</button>
                            <span className="text-xs text-slate-500">Page {currentPage} of {totalPages}</span>
                            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className="px-3 py-1 bg-white border rounded hover:bg-slate-100 text-xs font-bold">Next</button>
                        </div>
                    )
                }
            </div>

            {showItemConfig && (
                <div
                    className="fixed inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm"
                    style={{ zIndex: (zIndex || 200) + 20 }}
                    onClick={() => setShowItemConfig(false)}
                >
                    <div
                        className="bg-white border border-slate-300 rounded-xl shadow-2xl w-[420px] max-w-[94vw] p-3"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
                            <div className="text-[11px] font-black text-slate-700 uppercase">Item Ledger Configuration</div>
                            <button
                                type="button"
                                onClick={() => setShowItemConfig(false)}
                                className="text-slate-400 hover:text-slate-700"
                                title="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                            <span className="text-slate-700">1. Show Opening Balance</span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setShowOpeningBalance(true)}
                                    className={`px-2 py-0.5 rounded border text-[11px] font-bold ${showOpeningBalance ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}`}
                                >
                                    YES
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowOpeningBalance(false)}
                                    className={`px-2 py-0.5 rounded border text-[11px] font-bold ${!showOpeningBalance ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}`}
                                >
                                    NO
                                </button>
                            </div>
                        </div>

                        <div className="py-1.5 text-[11px] text-slate-400 border-t border-slate-100 mt-1">
                            2. Additional setting slot (reserved)
                        </div>
                    </div>
                </div>
            )}
        </Modal >
    );
};