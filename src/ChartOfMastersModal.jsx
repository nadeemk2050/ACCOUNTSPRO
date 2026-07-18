import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, FileText, User, RefreshCw, Plus, ArrowLeft } from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

const ChartOfMastersModal = ({
    isOpen,
    onClose,
    products = [],
    lots = [],
    parties = [],
    expenses = [],
    directExpenses = [],
    incomeAccounts = [],
    capitalAccounts = [],
    accounts = [],
    assetAccounts = [],
    invoices = [],
    payments = [],
    journalVouchers = [],
    stockJournals = [],
    dataOwnerId,
    user
}) => {
    const [activeTab, setActiveTab] = useState('ITEMS');
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [auditLogs, setAuditLogs] = useState({});
    const [loadingLogs, setLoadingLogs] = useState(false);

    // Quick Add Modal States
    const [quickAddType, setQuickAddType] = useState(null); // 'group' | 'ledger'
    const [quickAddTargetGroup, setQuickAddTargetGroup] = useState('');
    const [quickAddName, setQuickAddName] = useState('');
    const [savingQuickAdd, setSavingQuickAdd] = useState(false);

    // Fetch Audit Logs to resolve Creator & Last Modified User info
    const fetchLogs = async () => {
        if (!isOpen || !dataOwnerId) return;
        setLoadingLogs(true);
        try {
            const q = query(
                collection(db, 'audit_logs'),
                where('ownerId', '==', dataOwnerId)
            );
            const snap = await getDocs(q);
            const mapping = {};
            snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.docId) {
                    if (!mapping[data.docId]) mapping[data.docId] = [];
                    mapping[data.docId].push({
                        id: doc.id,
                        userName: data.userName || 'System',
                        date: data.date?.toDate ? data.date.toDate() : new Date(data.date),
                        action: data.action
                    });
                }
            });
            Object.keys(mapping).forEach(docId => {
                mapping[docId].sort((a, b) => a.date - b.date);
            });
            setAuditLogs(mapping);
        } catch (err) {
            console.error("Error fetching audit logs for Chart of Masters:", err);
        } finally {
            setLoadingLogs(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [isOpen, dataOwnerId]);

    // Thin Tab definitions
    const tabs = [
        { id: 'ITEMS', label: 'Items (Products)', data: products, collectionName: 'products', hasGroups: true, groupCollection: 'stock_groups' },
        { id: 'LOTNUMBERS', label: 'Lot Numbers', data: lots, collectionName: 'lots', hasGroups: false },
        { id: 'CUSTOMERS', label: 'Customers', data: parties, collectionName: 'parties', hasGroups: true, groupCollection: 'party_groups' },
        { id: 'INDIRECT_EXPENSES', label: 'Indirect Expenses', data: expenses, collectionName: 'expenses', hasGroups: true, groupCollection: 'expense_groups' },
        { id: 'DIRECT_EXPENSES', label: 'Direct Expenses', data: directExpenses, collectionName: 'direct_expenses', hasGroups: true, groupCollection: 'expense_groups' },
        { id: 'INCOME_ACCOUNTS', label: 'Income Accounts', data: incomeAccounts, collectionName: 'income_accounts', hasGroups: false },
        { id: 'CAPITAL_ACCOUNTS', label: 'Capital Accounts', data: capitalAccounts, collectionName: 'capital_accounts', hasGroups: false },
        { id: 'CASH_BANK', label: 'Cash / Bank', data: accounts, collectionName: 'accounts', hasGroups: true }, // Grouped by 'type'
        { id: 'FIXED_ASSETS', label: 'Fixed Assets', data: assetAccounts, collectionName: 'asset_accounts', hasGroups: false }
    ];

    const currentTab = useMemo(() => tabs.find(t => t.id === activeTab), [activeTab]);

    // Voucher Count Aggregator
    const getVoucherCount = (tabId, itemId) => {
        let count = 0;
        const idLower = String(itemId).toLowerCase();

        switch (tabId) {
            case 'ITEMS':
                invoices.forEach(inv => {
                    if (inv.items?.some(i => String(i.productId).toLowerCase() === idLower)) count++;
                });
                stockJournals.forEach(sj => {
                    if (String(sj.productId).toLowerCase() === idLower) count++;
                    if (sj.items?.some(i => String(i.productId).toLowerCase() === idLower)) count++;
                    if (sj.components?.some(c => String(c.productId).toLowerCase() === idLower)) count++;
                });
                break;

            case 'LOTNUMBERS':
                invoices.forEach(inv => {
                    if (String(inv.lotId).toLowerCase() === idLower) count++;
                    if (inv.items?.some(i => String(i.lotId).toLowerCase() === idLower)) count++;
                });
                stockJournals.forEach(sj => {
                    if (String(sj.lotId).toLowerCase() === idLower) count++;
                    if (sj.items?.some(i => String(i.lotId).toLowerCase() === idLower)) count++;
                    if (sj.components?.some(c => String(c.lotId).toLowerCase() === idLower)) count++;
                });
                break;

            case 'CUSTOMERS':
                invoices.forEach(inv => {
                    if (String(inv.partyId).toLowerCase() === idLower || String(inv.addlExpCreditId).toLowerCase() === idLower) count++;
                });
                payments.forEach(pay => {
                    if (String(pay.partyId).toLowerCase() === idLower || pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'INDIRECT_EXPENSES':
                invoices.forEach(inv => {
                    if (String(inv.expenseId).toLowerCase() === idLower || String(inv.addlExpCreditId).toLowerCase() === idLower) count++;
                });
                payments.forEach(pay => {
                    if (String(pay.expenseId).toLowerCase() === idLower || pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'DIRECT_EXPENSES':
                invoices.forEach(inv => {
                    if (String(inv.directExpenseId).toLowerCase() === idLower || inv.items?.some(i => String(i.directExpenseId).toLowerCase() === idLower)) count++;
                });
                payments.forEach(pay => {
                    if (pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'INCOME_ACCOUNTS':
                invoices.forEach(inv => {
                    if (String(inv.incomeId).toLowerCase() === idLower || String(inv.addlExpCreditId).toLowerCase() === idLower) count++;
                });
                payments.forEach(pay => {
                    if (pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'CAPITAL_ACCOUNTS':
                payments.forEach(pay => {
                    if (pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'CASH_BANK':
                invoices.forEach(inv => {
                    if (String(inv.addlExpCreditId).toLowerCase() === idLower) count++;
                });
                payments.forEach(pay => {
                    if (String(pay.accountId).toLowerCase() === idLower || String(pay.toAccountId).toLowerCase() === idLower || pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;

            case 'FIXED_ASSETS':
                payments.forEach(pay => {
                    if (pay.splits?.some(s => String(s.targetId).toLowerCase() === idLower)) count++;
                });
                journalVouchers.forEach(jv => {
                    if (String(jv.drId).toLowerCase() === idLower || String(jv.crId).toLowerCase() === idLower || jv.rows?.some(r => String(r.id).toLowerCase() === idLower)) count++;
                });
                break;
        }

        return count;
    };

    // Helper to resolve User and Date Metadata
    const getUserMetadata = (itemId) => {
        const logs = auditLogs[itemId] || [];
        if (logs.length === 0) return { creator: 'Admin', modifier: 'Admin', date: 'N/A', lastModified: 'Admin' };

        const creatorLog = logs.find(l => l.action === 'CREATED') || logs[0];
        const modifierLog = logs[logs.length - 1];

        return {
            creator: creatorLog.userName,
            creatorDate: creatorLog.date.toLocaleDateString(),
            modifier: modifierLog.userName,
            modifierDate: modifierLog.date.toLocaleDateString(),
            lastModified: `${modifierLog.userName} on ${modifierLog.date.toLocaleDateString()}`
        };
    };

    // Grouping & Sorting logic
    const groupedMap = useMemo(() => {
        if (!currentTab) return {};

        const filtered = currentTab.data.filter(item => {
            const name = (item.name || '').toLowerCase();
            const group = (item.group || item.type || '').toLowerCase();
            return name.includes(searchTerm.toLowerCase()) || group.includes(searchTerm.toLowerCase());
        });

        const mapped = filtered.map(item => {
            let groupName = 'Primary';
            if (activeTab === 'CASH_BANK') {
                groupName = item.type === 'bank' ? 'Cash/Bank' : item.type ? String(item.type).toUpperCase() : 'Primary';
            } else if (item.group) {
                groupName = item.group;
            }

            const meta = getUserMetadata(item.id);
            return {
                ...item,
                groupName,
                voucherCount: getVoucherCount(activeTab, item.id),
                createdBy: meta.lastModified
            };
        });

        const groups = {};
        mapped.forEach(item => {
            if (!groups[item.groupName]) groups[item.groupName] = [];
            groups[item.groupName].push(item);
        });

        // Sort items inside each group
        Object.keys(groups).forEach(gName => {
            groups[gName].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });

        return groups;
    }, [currentTab, searchTerm, activeTab, auditLogs, invoices, payments, journalVouchers, stockJournals]);

    // Handle Quick Adding to Firestore Database
    const handleQuickAddSubmit = async (e) => {
        e.preventDefault();
        if (!quickAddName.trim()) return;

        setSavingQuickAdd(true);
        try {
            const currentUserId = user?.uid || 'GUEST_UID';
            const effectiveName = user?.displayName || user?.email || 'System';

            if (quickAddType === 'group') {
                // ADDING A GROUP
                const coll = currentTab.groupCollection;
                if (!coll) return;

                const payload = {
                    name: quickAddName.trim(),
                    name_lowercase: quickAddName.trim().toLowerCase(),
                    userId: dataOwnerId,
                    ...(coll === 'stock_groups' ? { parent: 'Primary', shouldQuantities: 'Yes' } : { addValues: 'No' })
                };

                const docRef = await addDoc(collection(db, coll), payload);
                
                // Write Audit Log
                await addDoc(collection(db, 'audit_logs'), {
                    date: serverTimestamp(),
                    ownerId: dataOwnerId,
                    userId: currentUserId,
                    userName: effectiveName,
                    action: 'CREATED',
                    docType: coll === 'stock_groups' ? 'Stock Group' : 'Group',
                    refNo: payload.name,
                    amount: 0,
                    docId: docRef.id,
                    description: `Created new group: ${payload.name}`,
                    snapshotData: JSON.stringify(payload)
                });

            } else if (quickAddType === 'ledger') {
                // ADDING A LEDGER / ITEM
                const coll = currentTab.collectionName;
                const payload = {
                    name: quickAddName.trim(),
                    name_lowercase: quickAddName.trim().toLowerCase(),
                    userId: dataOwnerId,
                    ...(currentTab.hasGroups ? { group: quickAddTargetGroup } : {})
                };

                // Add default properties depending on Master Type
                if (coll === 'products') {
                    payload.currentStock = 0;
                    payload.openingStock = 0;
                    payload.openingRate = 0;
                    payload.openingBalance = 0;
                } else if (coll === 'parties' || coll === 'accounts') {
                    payload.openingBalance = 0;
                    payload.balance = 0;
                    if (coll === 'accounts') {
                        // Cash/bank mapping
                        payload.type = quickAddTargetGroup === 'Cash/Bank' ? 'bank' : quickAddTargetGroup.toLowerCase() || 'bank';
                    }
                } else if (coll === 'capital_accounts' || coll === 'asset_accounts') {
                    payload.openingBalance = 0;
                } else if (coll === 'lots') {
                    payload.status = 'Open';
                    payload.description = '';
                }

                const docRef = await addDoc(collection(db, coll), payload);

                // Write Audit Log
                await addDoc(collection(db, 'audit_logs'), {
                    date: serverTimestamp(),
                    ownerId: dataOwnerId,
                    userId: currentUserId,
                    userName: effectiveName,
                    action: 'CREATED',
                    docType: currentTab.label,
                    refNo: payload.name,
                    amount: 0,
                    docId: docRef.id,
                    description: `Created new master: ${payload.name}`,
                    snapshotData: JSON.stringify(payload)
                });
            }

            setQuickAddName('');
            setQuickAddType(null);
            // Refresh logs to fetch creation metadata immediately
            fetchLogs();
        } catch (err) {
            alert("Error saving master: " + err.message);
        } finally {
            setSavingQuickAdd(false);
        }
    };

    if (!isOpen) return null;

    const groupNamesList = Object.keys(groupedMap).sort();

    return (
        <div className="fixed inset-0 bg-white z-[1000] flex flex-col animate-in fade-in duration-200">
            <div className="w-full h-full flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="px-6 py-4 bg-[#005994] text-white flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold tracking-wide">Chart of Masters</h2>
                        <p className="text-xs text-white/70 mt-0.5">Explore ledgers, voucher counts, groups, and modification logs</p>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Interactive Search toggle */}
                        <div className="flex items-center">
                            {showSearch ? (
                                <div className="flex items-center bg-white/10 rounded-xl overflow-hidden px-3 py-1 animate-in slide-in-from-right duration-200">
                                    <Search size={14} className="text-white/60 mr-2" />
                                    <input
                                        type="text"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="bg-transparent border-none text-white text-xs focus:outline-none placeholder-white/40 w-40"
                                        autoFocus
                                    />
                                    <button onClick={() => { setShowSearch(false); setSearchTerm(''); }} className="ml-2 hover:bg-white/10 p-0.5 rounded text-white/80">
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    onClick={() => setShowSearch(true)} 
                                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                    title="Open Search"
                                >
                                    <Search size={18} />
                                </button>
                            )}
                        </div>

                        {loadingLogs && (
                            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1 rounded-full text-xs animate-pulse">
                                <RefreshCw size={12} className="animate-spin" />
                                <span>Loading metadata...</span>
                            </div>
                        )}
                        <button 
                            onClick={onClose} 
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Tabs Selector Bar */}
                <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border-b border-slate-100 items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setSearchTerm(''); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wider uppercase transition-all duration-150 ${
                                    activeTab === tab.id
                                        ? 'bg-[#005994] text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                }`}
                            >
                                {tab.label}
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                                    activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                                }`}>
                                    {tab.data?.length || 0}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Quick Add Group button at top bar if tab supports groups */}
                    {currentTab?.groupCollection && (
                        <button
                            onClick={() => {
                                setQuickAddType('group');
                                setQuickAddTargetGroup('');
                                setQuickAddName('');
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#005994]/10 hover:bg-[#005994]/20 text-[#005994] text-xs font-bold rounded-lg transition-colors ml-auto"
                        >
                            <Plus size={14} />
                            <span>Add Group</span>
                        </button>
                    )}
                </div>

                {/* Details Table Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {groupNamesList.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <FileText size={48} className="stroke-[1.5] mb-2" />
                            <p className="text-sm font-medium">No master records found matching the criteria.</p>
                            {/* Allow Quick add ledger to empty list */}
                            <button
                                onClick={() => {
                                    setQuickAddType('ledger');
                                    setQuickAddTargetGroup('Primary');
                                    setQuickAddName('');
                                }}
                                className="mt-4 flex items-center gap-1 bg-[#005994] text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-[#004878]"
                            >
                                <Plus size={14} />
                                <span>Create First Ledger</span>
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-100 rounded-xl">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="py-3 px-4 font-semibold text-slate-700 w-16">S.No.</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">Group Name</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">Ledger Name</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700 text-center w-40">Vouchers Count</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">Last Modified By & Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        let globalIndex = 0;
                                        return groupNamesList.map(gName => {
                                            const items = groupedMap[gName] || [];
                                            return (
                                                <React.Fragment key={gName}>
                                                    {/* Section Group Header Row */}
                                                    <tr className="bg-[#005994]/5 border-y border-slate-100 font-bold text-slate-700">
                                                        <td colSpan={5} className="py-2.5 px-4">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs uppercase tracking-wider text-slate-400">Group:</span>
                                                                    <span className="text-[#005994]">{gName}</span>
                                                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium ml-2">
                                                                        {items.length} {items.length === 1 ? 'record' : 'records'}
                                                                    </span>
                                                                </div>
                                                                {/* Quick add LEDGER under this group */}
                                                                <button
                                                                    onClick={() => {
                                                                        setQuickAddType('ledger');
                                                                        setQuickAddTargetGroup(gName);
                                                                        setQuickAddName('');
                                                                    }}
                                                                    className="flex items-center gap-1 text-[11px] font-bold text-[#005994] hover:text-[#004878] bg-white border border-[#005994]/20 px-2 py-0.5 rounded-md shadow-sm transition-all"
                                                                    title={`Add ledger under ${gName}`}
                                                                >
                                                                    <Plus size={12} />
                                                                    <span>Add Ledger</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>

                                                    {/* Group items list */}
                                                    {items.map((item) => {
                                                        globalIndex++;
                                                        return (
                                                            <tr 
                                                                key={item.id} 
                                                                className="hover:bg-slate-50/50 transition-colors"
                                                            >
                                                                <td className="py-3 px-4 text-slate-400 font-medium">{globalIndex}</td>
                                                                <td className="py-3 px-6 text-slate-400 text-xs font-semibold uppercase">{gName}</td>
                                                                <td className="py-3 px-6 font-semibold text-slate-900">{item.name}</td>
                                                                <td className="py-3 px-6 text-center">
                                                                    {item.voucherCount > 0 ? (
                                                                        <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-100">
                                                                            {item.voucherCount} {item.voucherCount === 1 ? 'voucher' : 'vouchers'}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-300 text-xs">No vouchers</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-3 px-6 text-slate-600 text-xs font-medium">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <User size={13} className="text-slate-400" />
                                                                        <span>{item.createdBy}</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div>
                        Click "+ Add Group" or "+ Add Ledger" next to a group heading to instantly expand your Chart of Masters.
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-xl transition-colors"
                    >
                        Close Gateway
                    </button>
                </div>

            </div>

            {/* Quick Add Overlay Dialog */}
            {quickAddType && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[2000] flex items-center justify-center p-4">
                    <form 
                        onSubmit={handleQuickAddSubmit}
                        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150"
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                            <h3 className="font-bold text-[#005994] flex items-center gap-2">
                                <Plus size={18} />
                                <span>{quickAddType === 'group' ? 'Create New Group' : `Add Ledger under [${quickAddTargetGroup}]`}</span>
                            </h3>
                            <button 
                                type="button" 
                                onClick={() => setQuickAddType(null)} 
                                className="p-1 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
                                    {quickAddType === 'group' ? 'Group Name' : 'Ledger Name'}
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder={quickAddType === 'group' ? 'Enter group name...' : 'Enter ledger name...'}
                                    value={quickAddName}
                                    onChange={(e) => setQuickAddName(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#005994]/20 focus:border-[#005994] transition-all"
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 mt-6 border-t border-slate-100 pt-4">
                            <button
                                type="button"
                                onClick={() => setQuickAddType(null)}
                                className="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={savingQuickAdd}
                                className="px-4 py-2 bg-[#005994] hover:bg-[#004878] text-white rounded-xl text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
                            >
                                {savingQuickAdd ? (
                                    <>
                                        <RefreshCw size={12} className="animate-spin" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <span>Save Record</span>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default ChartOfMastersModal;
