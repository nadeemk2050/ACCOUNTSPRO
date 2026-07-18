import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, FileText, User, RefreshCw } from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

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
    dataOwnerId
}) => {
    const [activeTab, setActiveTab] = useState('ITEMS');
    const [searchTerm, setSearchTerm] = useState('');
    const [auditLogs, setAuditLogs] = useState({});
    const [loadingLogs, setLoadingLogs] = useState(false);

    // Fetch Audit Logs to resolve Creator & Last Modified User info
    useEffect(() => {
        if (!isOpen || !dataOwnerId) return;

        const fetchLogs = async () => {
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
                // Sort each array by date ascending
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

        fetchLogs();
    }, [isOpen, dataOwnerId]);

    // Thin Tab definitions
    const tabs = [
        { id: 'ITEMS', label: 'Items (Products)', data: products, collectionName: 'products' },
        { id: 'LOTNUMBERS', label: 'Lot Numbers', data: lots, collectionName: 'lots' },
        { id: 'CUSTOMERS', label: 'Customers', data: parties, collectionName: 'parties' },
        { id: 'INDIRECT_EXPENSES', label: 'Indirect Expenses', data: expenses, collectionName: 'expenses' },
        { id: 'DIRECT_EXPENSES', label: 'Direct Expenses', data: directExpenses, collectionName: 'direct_expenses' },
        { id: 'INCOME_ACCOUNTS', label: 'Income Accounts', data: incomeAccounts, collectionName: 'income_accounts' },
        { id: 'CAPITAL_ACCOUNTS', label: 'Capital Accounts', data: capitalAccounts, collectionName: 'capital_accounts' },
        { id: 'CASH_BANK', label: 'Cash / Bank', data: accounts, collectionName: 'accounts' },
        { id: 'FIXED_ASSETS', label: 'Fixed Assets', data: assetAccounts, collectionName: 'asset_accounts' }
    ];

    const currentTab = useMemo(() => tabs.find(t => t.id === activeTab), [activeTab]);

    // Voucher Count Aggregator (in-memory scanning of local snapshots)
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
        if (logs.length === 0) return { creator: 'Admin', modifier: 'Admin', date: 'N/A', lastModified: 'Admin on N/A' };

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
    const groupedItems = useMemo(() => {
        if (!currentTab) return [];

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

        Object.keys(groups).forEach(gName => {
            groups[gName].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });

        const sortedGroups = Object.keys(groups).sort();
        const resultList = [];
        sortedGroups.forEach(gName => {
            groups[gName].forEach(item => {
                resultList.push(item);
            });
        });

        return resultList;
    }, [currentTab, searchTerm, activeTab, auditLogs, invoices, payments, journalVouchers, stockJournals]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-white z-[1000] flex flex-col animate-in fade-in duration-200">
            <div className="w-full h-full flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="px-6 py-4 bg-[#005994] text-white flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold tracking-wide">Chart of Masters</h2>
                        <p className="text-xs text-white/70 mt-0.5">Explore ledgers, voucher counts, groups, and modification logs</p>
                    </div>
                    <div className="flex items-center gap-3">
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
                <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border-b border-slate-100">
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

                {/* Filter and Search Bar */}
                <div className="px-6 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder={`Search inside ${currentTab?.label}...`}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#005994]/25 focus:border-[#005994] transition-all"
                        />
                    </div>
                    <div className="text-xs text-slate-400 font-medium">
                        Showing {groupedItems.length} of {currentTab?.data?.length || 0} records
                    </div>
                </div>

                {/* Details Table Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {groupedItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <FileText size={48} className="stroke-[1.5] mb-2" />
                            <p className="text-sm font-medium">No master records found matching the criteria.</p>
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
                                <tbody className="divide-y divide-slate-100">
                                    {groupedItems.map((item, index) => (
                                        <tr 
                                            key={item.id} 
                                            className="hover:bg-slate-50/50 transition-colors"
                                        >
                                            <td className="py-3.5 px-4 text-slate-400 font-medium">{index + 1}</td>
                                            <td className="py-3.5 px-6">
                                                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-medium">
                                                    {item.groupName}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-6 font-semibold text-slate-900">{item.name}</td>
                                            <td className="py-3.5 px-6 text-center">
                                                {item.voucherCount > 0 ? (
                                                    <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-100">
                                                        {item.voucherCount} {item.voucherCount === 1 ? 'voucher' : 'vouchers'}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 text-xs">No vouchers</span>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-6 text-slate-600 text-xs font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <User size={13} className="text-slate-400" />
                                                    <span>{item.createdBy}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div>
                        Use the search bar to locate specific ledgers instantly.
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-xl transition-colors"
                    >
                        Close Gateway
                    </button>
                </div>

            </div>
        </div>
    );
};

export default ChartOfMastersModal;
