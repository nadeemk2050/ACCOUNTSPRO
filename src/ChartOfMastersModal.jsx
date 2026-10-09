import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, FileText, User, RefreshCw, Plus, ArrowLeft, ChevronDown, ChevronRight, Pencil, Trash2, Check, ArrowRightLeft, Loader2 } from 'lucide-react';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

// 'Primary' is prepended to every group option list, but a group may itself be
// named "Primary" - de-duplicate case-insensitively so React keys stay unique.
const withPrimary = (groups) => {
    const seen = new Set();
    const out = [];
    ['Primary', ...(groups || [])].forEach(v => {
        const k = String(v ?? '').trim().toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push(v);
    });
    return out;
};

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
    stockGroups = [],
    partyGroups = [],
    expenseGroups = [],
    dataOwnerId,
    user,
    onChartCreate,
    onChartGroupCreate,
    onChartUpdate,
    onChartDelete,
    onChartMove
}) => {
    const [activeTab, setActiveTab] = useState('ITEMS');
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [auditLogs, setAuditLogs] = useState({});
    const [isDetailedView, setIsDetailedView] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [loadingLogs, setLoadingLogs] = useState(false);

    useEffect(() => {
        setExpandedGroups(new Set());
    }, [activeTab]);

    // ─── INLINE MASTER EDITOR ────────────────────────────────────────────────
    // Fast in-table editing. Every write is delegated to App-level handlers so
    // the logic stays identical to Manage Masters (duplicate guard, stock/balance
    // delta, group-rename cascade, referential-integrity checks, audit logs).
    // Each of those handlers asks for the admin password before writing.
    const [editingRowId, setEditingRowId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [moveType, setMoveType] = useState('');
    const [savingRow, setSavingRow] = useState(false);
    const [rowMsg, setRowMsg] = useState(null);

    // Group row editing (stock / party / expense groups)
    const [editingGroupName, setEditingGroupName] = useState(null);
    const [groupEditForm, setGroupEditForm] = useState({});

    // "Add full details" expansion inside the create dialog
    const [quickAddShowAll, setQuickAddShowAll] = useState(false);
    const [quickAddForm, setQuickAddForm] = useState({});

    // Field definitions mirror the Manage Masters forms exactly.
    const editFields = useMemo(() => ({
        ITEMS: [
            { key: 'name', label: 'Item Name', type: 'text', required: true },
            { key: 'hscode', label: 'HS Code', type: 'text' },
            { key: 'group', label: 'Under Group', type: 'select', options: withPrimary((stockGroups || []).map(g => g.name)) },
            { key: 'openingStock', label: 'Opening Qty', type: 'number' },
            { key: 'openingRate', label: 'Opening Rate', type: 'number' },
            { key: 'openingBalance', label: 'Opening Value', type: 'number' }
        ],
        LOTNUMBERS: [
            { key: 'name', label: 'Lot No / Batch No', type: 'text', required: true },
            { key: 'description', label: 'Description / Remarks', type: 'text' },
            { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Closed'] }
        ],
        CUSTOMERS: [
            { key: 'name', label: 'Party Name', type: 'text', required: true },
            { key: 'group', label: 'Under Group', type: 'select', options: withPrimary((partyGroups || []).map(g => g.name)) },
            { key: 'openingBalance', label: 'Opening Balance', type: 'number' },
            { key: 'trn', label: 'TRN Number', type: 'text' },
            { key: 'email', label: 'Email Address', type: 'email' },
            { key: 'address', label: 'Company Address', type: 'text' },
            { key: 'mobile', label: 'Mobile', type: 'tel' }
        ],
        INDIRECT_EXPENSES: [
            { key: 'name', label: 'Indirect Expense Name', type: 'text', required: true },
            { key: 'group', label: 'Under Group', type: 'select', options: withPrimary((expenseGroups || []).map(g => g.name)) }
        ],
        DIRECT_EXPENSES: [
            { key: 'name', label: 'Direct Expense Name', type: 'text', required: true },
            { key: 'group', label: 'Under Group', type: 'select', options: withPrimary((expenseGroups || []).map(g => g.name)) }
        ],
        INCOME_ACCOUNTS: [
            { key: 'name', label: 'Income Account Name', type: 'text', required: true }
        ],
        CAPITAL_ACCOUNTS: [
            { key: 'name', label: 'Owner Name', type: 'text', required: true },
            { key: 'openingBalance', label: 'Opening Balance (Invested)', type: 'number' }
        ],
        CASH_BANK: [
            { key: 'name', label: 'Account Name', type: 'text', required: true },
            { key: 'openingBalance', label: 'Opening Balance', type: 'number' },
            { key: 'type', label: 'Account Type', type: 'select', options: ['bank', 'current_asset', 'fixed_asset', 'expense', 'other'] }
        ],
        FIXED_ASSETS: [
            { key: 'name', label: 'Asset Name', type: 'text', required: true },
            { key: 'openingBalance', label: 'Opening Balance', type: 'number' }
        ]
    }), [stockGroups, partyGroups, expenseGroups]);

    // Group record fields - mirrors the old Create / Alter Masters group form,
    // including every quantity/value accumulation flag.
    const groupEditFields = useMemo(() => ({
        stock_groups: [
            { key: 'name', label: 'Group Name', type: 'text', required: true },
            { key: 'parent', label: 'Parent Group', type: 'select', options: withPrimary((stockGroups || []).map(g => g.name)) },
            { key: 'shouldQuantities', label: 'Add Quantities?', type: 'select', options: ['Yes', 'No'] },
            { key: 'shouldValues', label: 'Add Values?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addInwardQty', label: 'Add Inward Qty to Totals?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addInwardValue', label: 'Add Inward Value to Totals?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addOutwardQty', label: 'Add Outward Qty to Totals?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addOutwardValue', label: 'Add Outward Value to Totals?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addClosingQty', label: 'Add Closing Qty to Totals?', type: 'select', options: ['Yes', 'No'] },
            { key: 'addClosingValue', label: 'Add Closing Value to Totals?', type: 'select', options: ['Yes', 'No'] }
        ],
        party_groups: [
            { key: 'name', label: 'Group Name', type: 'text', required: true },
            { key: 'addValues', label: 'Add Values?', type: 'select', options: ['Yes', 'No'] }
        ],
        expense_groups: [
            { key: 'name', label: 'Group Name', type: 'text', required: true },
            { key: 'addValues', label: 'Add Values?', type: 'select', options: ['Yes', 'No'] }
        ]
    }), [stockGroups]);

    // Ledger-type move: same five source types as Manage Masters.
    const MOVE_SOURCE_TYPE = {
        CUSTOMERS: 'party',
        INDIRECT_EXPENSES: 'expense',
        CASH_BANK: 'account',
        CAPITAL_ACCOUNTS: 'capital',
        FIXED_ASSETS: 'asset'
    };
    const MOVE_TARGETS = [
        { value: 'party', label: 'Party' },
        { value: 'expense', label: 'Expense' },
        { value: 'account', label: 'Bank / Cash' },
        { value: 'capital', label: 'Capital Account' },
        { value: 'asset', label: 'Asset' }
    ];

    const startRowEdit = (item) => {
        const next = {};
        (editFields[activeTab] || []).forEach(field => {
            const v = item[field.key];
            next[field.key] = (v === undefined || v === null) ? '' : v;
        });
        setEditForm(next);
        setMoveType('');
        setRowMsg(null);
        setEditingRowId(item.id);
    };

    const cancelRowEdit = () => {
        setEditingRowId(null);
        setEditForm({});
        setMoveType('');
    };

    // ─── GROUP ROW EDITING ──────────────────────────────────────────────────
    const groupArrayFor = (collection) => (
        collection === 'stock_groups' ? (stockGroups || [])
            : collection === 'party_groups' ? (partyGroups || [])
                : collection === 'expense_groups' ? (expenseGroups || [])
                    : []
    );

    const groupFieldsFor = (collection) => groupEditFields[collection] || [];

    const groupRecordFor = (gName) => {
        const coll = currentTab?.groupCollection;
        if (!coll) return null;
        return groupArrayFor(coll).find(g => (g.name || '') === gName) || null;
    };

    const startGroupEdit = (gName) => {
        const rec = groupRecordFor(gName);
        if (!rec) {
            setRowMsg({ type: 'error', text: `Group "${gName}" is a built-in bucket and has no record to edit.` });
            return;
        }
        const fields = groupFieldsFor(currentTab.groupCollection);
        const next = {};
        fields.forEach(f => { const v = rec[f.key]; next[f.key] = (v === undefined || v === null) ? '' : v; });
        setGroupEditForm(next);
        setRowMsg(null);
        setEditingGroupName(gName);
        setEditingRowId(null);
    };

    const cancelGroupEdit = () => {
        setEditingGroupName(null);
        setGroupEditForm({});
    };

    const saveGroup = async (gName) => {
        const rec = groupRecordFor(gName);
        const coll = currentTab?.groupCollection;
        if (!rec || !coll) return;
        const fields = groupFieldsFor(coll);
        const missing = fields.find(f => f.required && !String(groupEditForm[f.key] ?? '').trim());
        if (missing) { setRowMsg({ type: 'error', text: `${missing.label} is required.` }); return; }

        setSavingRow(true);
        setRowMsg(null);
        try {
            const res = await onChartUpdate?.(coll, rec.id, groupEditForm);
            if (res?.ok) {
                touchRowMeta(rec.id, 'UPDATED');
                cancelGroupEdit();
                setRowMsg({ type: 'success', text: `Group saved: "${groupEditForm.name}". Member records were re-grouped automatically.` });
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Group update failed.' });
            }
        } finally {
            setSavingRow(false);
        }
    };

    const removeGroup = async (gName) => {
        const rec = groupRecordFor(gName);
        const coll = currentTab?.groupCollection;
        if (!rec || !coll) return;
        setSavingRow(true);
        setRowMsg(null);
        try {
            const res = await onChartDelete?.(coll, rec.id, `Group ${rec.name}`);
            if (res?.ok) {
                if (editingGroupName === gName) cancelGroupEdit();
                setRowMsg({ type: 'success', text: `Group deleted: "${rec.name}"` });
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Group delete was blocked.' });
            }
        } finally {
            setSavingRow(false);
        }
    };

    // Opening Qty * Rate = Value (same auto-calc as Manage Items)
    const setEditFieldSmart = (key, value) => {
        setEditForm(prev => {
            const next = { ...prev, [key]: value };
            if (activeTab === 'ITEMS') {
                const qty = Number(key === 'openingStock' ? value : prev.openingStock) || 0;
                const rate = Number(key === 'openingRate' ? value : prev.openingRate) || 0;
                if (key === 'openingStock' || key === 'openingRate') {
                    if (qty && rate) next.openingBalance = String(Number((qty * rate).toFixed(2)));
                } else if (key === 'openingBalance') {
                    const val = Number(value) || 0;
                    if (qty) next.openingRate = String(Number((val / qty).toFixed(4)));
                }
            }
            return next;
        });
    };

    const handleEditorKey = (e, item) => {
        if (e.key === 'Enter') { e.preventDefault(); saveRow(item); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelRowEdit(); }
    };

    // Instant metadata refresh for just the touched row - no extra cloud reads.
    const touchRowMeta = (docId, action, name) => {
        if (!docId) return;
        const who = user?.displayName || user?.email || 'Admin';
        setAuditLogs(prev => {
            const next = { ...prev };
            next[docId] = [...(next[docId] || []), { id: `local-${Date.now()}`, userName: who, date: new Date(), action }];
            return next;
        });
        if (name) setRowMsg({ type: 'success', text: `${action} saved: "${name}"` });
    };

    const saveRow = async (item) => {
        const fields = editFields[activeTab] || [];
        const missing = fields.find(f => f.required && !String(editForm[f.key] ?? '').trim());
        if (missing) { setRowMsg({ type: 'error', text: `${missing.label} is required.` }); return; }

        setSavingRow(true);
        setRowMsg(null);
        try {
            const res = await onChartUpdate?.(currentTab.collectionName, item.id, editForm);
            if (res?.ok) {
                touchRowMeta(item.id, 'UPDATED', editForm.name);
                cancelRowEdit();
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Update failed.' });
            }
        } catch (e) {
            setRowMsg({ type: 'error', text: e.message });
        } finally {
            setSavingRow(false);
        }
    };

    const removeRow = async (item) => {
        setSavingRow(true);
        setRowMsg(null);
        try {
            const res = await onChartDelete?.(currentTab.collectionName, item.id, item.name || currentTab.label);
            if (res?.ok) {
                if (editingRowId === item.id) cancelRowEdit();
                setRowMsg({ type: 'success', text: `Deleted: "${item.name}"` });
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Delete was blocked.' });
            }
        } finally {
            setSavingRow(false);
        }
    };

    const moveRow = async (item) => {
        if (!moveType) { setRowMsg({ type: 'error', text: 'Choose a new ledger type first.' }); return; }
        setSavingRow(true);
        setRowMsg(null);
        try {
            const res = await onChartMove?.(currentTab.collectionName, item.id, editForm, moveType);
            if (res?.ok) {
                const label = MOVE_TARGETS.find(t => t.value === res.targetType)?.label || res.targetType;
                cancelRowEdit();
                setRowMsg({ type: 'success', text: `Moved "${item.name}" to ${label}. Its transactions were updated.` });
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Move failed.' });
            }
        } finally {
            setSavingRow(false);
        }
    };

    // Quick Add Modal States
    const [quickAddType, setQuickAddType] = useState(null); // 'group' | 'ledger'
    const [quickAddTargetGroup, setQuickAddTargetGroup] = useState('');
    const [quickAddName, setQuickAddName] = useState('');
    const [savingQuickAdd, setSavingQuickAdd] = useState(false);

    // Clear the create dialog's extra fields whenever it closes
    // (must sit AFTER the quickAdd state declarations above).
    useEffect(() => {
        if (!quickAddType) {
            setQuickAddShowAll(false);
            setQuickAddForm({});
        }
    }, [quickAddType]);

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

        // Resolve and pre-populate all base groups to show empty ones
        let baseGroups = [];
        if (activeTab === 'ITEMS') {
            baseGroups = withPrimary(stockGroups.map(g => g.name));
        } else if (activeTab === 'CUSTOMERS') {
            baseGroups = withPrimary(partyGroups.map(g => g.name));
        } else if (activeTab === 'INDIRECT_EXPENSES' || activeTab === 'DIRECT_EXPENSES') {
            baseGroups = withPrimary(expenseGroups.map(g => g.name));
        } else if (activeTab === 'CASH_BANK') {
            baseGroups = ['Cash/Bank', 'CURRENT_ASSET', 'FIXED_ASSET', 'EXPENSE', 'OTHER'];
        }

        const uniqueBaseGroups = Array.from(new Set(baseGroups.filter(Boolean)));
        uniqueBaseGroups.forEach(gName => {
            if (!searchTerm || gName.toLowerCase().includes(searchTerm.toLowerCase())) {
                groups[gName] = [];
            }
        });

        mapped.forEach(item => {
            if (!groups[item.groupName]) groups[item.groupName] = [];
            groups[item.groupName].push(item);
        });

        // Sort items inside each group
        Object.keys(groups).forEach(gName => {
            groups[gName].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });

        return groups;
    }, [currentTab, searchTerm, activeTab, auditLogs, invoices, payments, journalVouchers, stockJournals, stockGroups, partyGroups, expenseGroups]);

    // Small reusable field grid shared by the create dialog and the row editors.
    const renderFieldGrid = (fields, values, onChange, cols = 'grid-cols-1 sm:grid-cols-2') => (
        <div className={`grid ${cols} gap-2`}>
            {fields.map(field => (
                <label key={field.key} className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {field.label}{field.required ? ' *' : ''}
                    </span>
                    {field.type === 'select' ? (
                        <select
                            value={values[field.key] ?? ''}
                            onChange={(e) => onChange(field.key, e.target.value)}
                            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium focus:border-[#005994] outline-none bg-white"
                        >
                            <option value="">Select...</option>
                            {(field.options || []).map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            type={field.type}
                            value={values[field.key] ?? ''}
                            onChange={(e) => onChange(field.key, e.target.value)}
                            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:border-[#005994] outline-none"
                        />
                    )}
                </label>
            ))}
        </div>
    );

    // The single "type" control shown in the minimal create dialog:
    //  • ledger  -> Under Group (or Account Type for cash/bank)
    //  • group   -> Parent Group (stock groups only)
    const createTypeField = useMemo(() => {
        if (quickAddType === 'group') {
            if (currentTab?.groupCollection === 'stock_groups') {
                return { key: 'parent', label: 'Parent Group', options: withPrimary((stockGroups || []).map(g => g.name)) };
            }
            return null;
        }
        if (quickAddType === 'ledger') {
            if (activeTab === 'CASH_BANK') {
                return { key: 'type', label: 'Account Type', options: ['bank', 'current_asset', 'fixed_asset', 'expense', 'other'] };
            }
            if (currentTab?.groupCollection) {
                return { key: 'group', label: 'Under Group', options: withPrimary(groupArrayFor(currentTab.groupCollection).map(g => g.name)) };
            }
        }
        return null;
    }, [quickAddType, activeTab, currentTab, stockGroups]);

    const createDetailFields = useMemo(() => {
        const base = quickAddType === 'group'
            ? groupFieldsFor(currentTab?.groupCollection)
            : (editFields[activeTab] || []);
        const skip = ['name', createTypeField?.key].filter(Boolean);
        return base.filter(f => !skip.includes(f.key));
    }, [quickAddType, activeTab, currentTab, editFields, groupEditFields, createTypeField]);

    const toggleFullDetails = () => {
        const next = !quickAddShowAll;
        if (next) {
            setQuickAddForm(prev => ({
                ...prev,
                name: quickAddName,
                ...(createTypeField ? { [createTypeField.key]: prev[createTypeField.key] ?? quickAddTargetGroup ?? '' } : {})
            }));
        }
        setQuickAddShowAll(next);
    };

    // Create dialog submit:
    //  • minimal mode -> the original one-field quick-add path (unchanged behaviour)
    //  • full details -> App handlers, so the complete Create / Alter Masters rules
    //    (duplicate guard, payload build, audit log) are applied.
    const handleCreateSubmit = async (e) => {
        e.preventDefault();
        if (!quickAddShowAll) return handleQuickAddSubmit(e);

        const isGroup = quickAddType === 'group';
        const coll = isGroup ? currentTab?.groupCollection : currentTab?.collectionName;
        const name = String(quickAddForm.name ?? '').trim();
        if (!name) { setRowMsg({ type: 'error', text: 'Name is required.' }); return; }
        if (!coll) { setRowMsg({ type: 'error', text: 'This list cannot take new records.' }); return; }

        const payload = { ...quickAddForm, name };
        if (isGroup && coll === 'stock_groups' && !payload.shouldQuantities) payload.shouldQuantities = 'Yes';
        if (isGroup && coll !== 'stock_groups' && !payload.addValues) payload.addValues = 'No';
        if (!isGroup && currentTab?.groupCollection && !payload.group) payload.group = quickAddTargetGroup || 'Primary';

        setSavingQuickAdd(true);
        setRowMsg(null);
        try {
            const res = isGroup
                ? await onChartGroupCreate?.(coll, payload)
                : await onChartCreate?.(coll, payload);
            if (res?.ok) {
                setQuickAddType(null);
                setQuickAddShowAll(false);
                setQuickAddForm({});
                setQuickAddName('');
                fetchLogs();
                setRowMsg({ type: 'success', text: `Created: "${name}"` });
            } else if (!res?.cancelled) {
                setRowMsg({ type: 'error', text: res?.error || 'Create failed.' });
            }
        } finally {
            setSavingQuickAdd(false);
        }
    };

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

                        <button
                            onClick={() => {
                                setIsDetailedView(prev => !prev);
                                setExpandedGroups(new Set());
                            }}
                            className="bg-white/15 hover:bg-white/20 text-white text-xs font-black px-3 py-1.5 rounded-xl border border-white/10 transition-colors uppercase tracking-wider"
                            title="Toggle Detailed or Condensed View"
                        >
                            {isDetailedView ? 'Cond View' : 'Dtl View'}
                        </button>

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
                </div>

                {/* Details Table Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {rowMsg && (
                        <div className={`mb-3 px-4 py-2 rounded-xl text-xs font-bold border ${rowMsg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                            {rowMsg.text}
                        </div>
                    )}
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
                                <span>Add new ledger</span>
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-100 rounded-xl">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="py-3 px-4 font-semibold text-slate-700 w-16">S.No.</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">
                                            <div className="flex items-center gap-1.5">
                                                <span>Group Name</span>
                                                {currentTab?.groupCollection && (
                                                    <button
                                                        onClick={() => {
                                                            setQuickAddType('group');
                                                            setQuickAddTargetGroup('');
                                                            setQuickAddName('');
                                                        }}
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#005994]/10 hover:bg-[#005994]/20 rounded-md text-[#005994] transition-colors"
                                                        title="Add new group"
                                                    >
                                                        <Plus size={13} className="stroke-[3]" />
                                                        <span className="text-[10px] font-black uppercase tracking-wide whitespace-nowrap">Add new group</span>
                                                    </button>
                                                )}
                                            </div>
                                        </th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">
                                            <div className="flex items-center gap-1.5">
                                                <span>Ledger Name</span>
                                                <button
                                                    onClick={() => {
                                                        setQuickAddType('ledger');
                                                        setQuickAddTargetGroup(groupNamesList[0] || 'Primary');
                                                        setQuickAddName('');
                                                    }}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#005994]/10 hover:bg-[#005994]/20 rounded-md text-[#005994] transition-colors"
                                                    title="Add new ledger"
                                                >
                                                    <Plus size={13} className="stroke-[3]" />
                                                    <span className="text-[10px] font-black uppercase tracking-wide whitespace-nowrap">Add new ledger</span>
                                                </button>
                                            </div>
                                        </th>
                                        <th className="py-3 px-6 font-semibold text-slate-700 text-center w-40">Vouchers Count</th>
                                        <th className="py-3 px-6 font-semibold text-slate-700">Last Modified By & Date</th>
                                        <th className="py-3 px-4 font-semibold text-slate-700 w-24 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        let globalIndex = 0;
                                        return groupNamesList.map(gName => {
                                            const items = groupedMap[gName] || [];
                                            const isExpanded = isDetailedView || expandedGroups.has(gName);
                                            return (
                                                <React.Fragment key={gName}>
                                                    {/* Section Group Header Row */}
                                                    <tr 
                                                        onClick={() => {
                                                            setExpandedGroups(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(gName)) {
                                                                    next.delete(gName);
                                                                } else {
                                                                    next.add(gName);
                                                                }
                                                                return next;
                                                            });
                                                        }}
                                                        className="bg-[#005994]/5 border-y border-slate-100 font-bold text-slate-700 cursor-pointer hover:bg-[#005994]/10 transition-colors select-none"
                                                    >
                                                        <td colSpan={6} className="py-2.5 px-4">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    {isExpanded ? (
                                                                        <ChevronDown size={16} className="text-[#005994]/60" />
                                                                    ) : (
                                                                        <ChevronRight size={16} className="text-[#005994]/60" />
                                                                    )}
                                                                    <span className="text-xs uppercase tracking-wider text-slate-400">Group:</span>
                                                                    <span className="text-[#005994]">{gName}</span>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setQuickAddType('ledger');
                                                                            setQuickAddTargetGroup(gName);
                                                                            setQuickAddName('');
                                                                        }}
                                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-md text-[#005994] transition-colors"
                                                                        title={`Add ledger under ${gName}`}
                                                                    >
                                                                        <Plus size={12} className="stroke-[3]" />
                                                                        <span className="text-[9px] font-black uppercase tracking-wide whitespace-nowrap">Add ledger</span>
                                                                    </button>
                                                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium ml-2">
                                                                        {items.length} {items.length === 1 ? 'record' : 'records'}
                                                                    </span>
                                                                    {currentTab?.groupCollection && groupRecordFor(gName) && (
                                                                        <span className="flex items-center gap-1 ml-2">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); (editingGroupName === gName ? cancelGroupEdit() : startGroupEdit(gName)); }}
                                                                                className={`p-1 rounded-md transition-colors ${editingGroupName === gName ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-[#005994] hover:bg-slate-300'}`}
                                                                                title={`Edit group "${gName}" (admin password required)`}
                                                                            >
                                                                                <Pencil size={12} />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); removeGroup(gName); }}
                                                                                disabled={savingRow}
                                                                                className="p-1 bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50 rounded-md transition-colors"
                                                                                title={`Delete group "${gName}" (admin password required)`}
                                                                            >
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {editingGroupName === gName && (
                                                        <tr className="bg-amber-50/60 border-b-2 border-amber-200">
                                                            <td colSpan={6} className="p-4">
                                                                <div className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                                                                    <div className="flex items-center justify-between mb-2 gap-2">
                                                                        <span className="text-[11px] font-black uppercase tracking-wider text-amber-700">
                                                                            Editing Group: {gName}
                                                                        </span>
                                                                        <span className="text-[10px] text-slate-400 font-semibold whitespace-nowrap">Renaming re-groups all member records - password required</span>
                                                                    </div>
                                                                    {renderFieldGrid(
                                                                        groupFieldsFor(currentTab?.groupCollection),
                                                                        groupEditForm,
                                                                        (k, v) => setGroupEditForm(prev => ({ ...prev, [k]: v })),
                                                                        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                                                                    )}
                                                                    <div className="flex flex-wrap items-center gap-2 mt-3">
                                                                        <button
                                                                            onClick={() => saveGroup(gName)}
                                                                            disabled={savingRow}
                                                                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                        >
                                                                            {savingRow ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                                            Save Group
                                                                        </button>
                                                                        <button
                                                                            onClick={cancelGroupEdit}
                                                                            className="flex items-center gap-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                        >
                                                                            <X size={13} />
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            onClick={() => removeGroup(gName)}
                                                                            disabled={savingRow}
                                                                            className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                        >
                                                                            <Trash2 size={13} />
                                                                            Delete Group
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}

                                                    {/* Group items list */}
                                                    {isExpanded && (
                                                        items.length === 0 ? (
                                                            <tr className="hover:bg-slate-50/50 transition-colors">
                                                                <td className="py-3 px-4 text-slate-300 font-medium">-</td>
                                                                <td className="py-3 px-6 text-slate-400 text-xs font-semibold uppercase">{gName}</td>
                                                                <td className="py-3 px-6 text-slate-400 italic font-medium">Zero Ledgers</td>
                                                                <td className="py-3 px-6 text-center text-slate-300">-</td>
                                                                <td className="py-3 px-6 text-slate-300 text-xs">-</td>
                                                                <td className="py-3 px-4 text-right">
                                                                    <button
                                                                        onClick={() => {
                                                                            setQuickAddType('ledger');
                                                                            setQuickAddTargetGroup(gName);
                                                                            setQuickAddName('');
                                                                        }}
                                                                        className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[#005994]"
                                                                        title={`Add ledger under ${gName}`}
                                                                    >
                                                                        <Plus size={14} className="stroke-[3]" />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            items.map((item) => {
                                                                globalIndex++;
                                                                return [
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
                                                                        <td className="py-3 px-4 text-right whitespace-nowrap">
                                                                            <button
                                                                                onClick={() => (editingRowId === item.id ? cancelRowEdit() : startRowEdit(item))}
                                                                                className={`p-1.5 rounded-lg transition-colors ${editingRowId === item.id ? 'bg-amber-200 text-amber-800' : 'bg-slate-100 hover:bg-[#005994]/10 text-[#005994]'}`}
                                                                                title="Edit this record inline"
                                                                            >
                                                                                <Pencil size={14} />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => removeRow(item)}
                                                                                disabled={savingRow}
                                                                                className="ml-1 p-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-500 rounded-lg transition-colors"
                                                                                title="Delete (admin password required)"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </td>
                                                                    </tr>,
                                                                    editingRowId === item.id && (
                                                                        <tr key={`${item.id}-editor`} className="bg-amber-50/60 border-b-2 border-amber-200">
                                                                            <td colSpan={6} className="p-4">
                                                                                <div className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                                                                                    <div className="flex items-center justify-between mb-2 gap-2">
                                                                                        <span className="text-[11px] font-black uppercase tracking-wider text-amber-700">
                                                                                            Editing {currentTab?.label}
                                                                                        </span>
                                                                                        <span className="text-[10px] text-slate-400 font-semibold whitespace-nowrap">Enter = save &middot; Esc = cancel &middot; password required</span>
                                                                                    </div>

                                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                                                                        {(editFields[activeTab] || []).map(field => (
                                                                                            <label key={field.key} className="block">
                                                                                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                                                                    {field.label}{field.required ? ' *' : ''}
                                                                                                </span>
                                                                                                {field.type === 'select' ? (
                                                                                                    <select
                                                                                                        value={editForm[field.key] ?? ''}
                                                                                                        onChange={(e) => setEditFieldSmart(field.key, e.target.value)}
                                                                                                        onKeyDown={(e) => handleEditorKey(e, item)}
                                                                                                        className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium focus:border-[#005994] outline-none bg-white"
                                                                                                    >
                                                                                                        <option value="">Select...</option>
                                                                                                        {(field.options || []).map(opt => (
                                                                                                            <option key={opt} value={opt}>{opt}</option>
                                                                                                        ))}
                                                                                                    </select>
                                                                                                ) : (
                                                                                                    <input
                                                                                                        type={field.type}
                                                                                                        value={editForm[field.key] ?? ''}
                                                                                                        onChange={(e) => setEditFieldSmart(field.key, e.target.value)}
                                                                                                        onKeyDown={(e) => handleEditorKey(e, item)}
                                                                                                        className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:border-[#005994] outline-none"
                                                                                                    />
                                                                                                )}
                                                                                            </label>
                                                                                        ))}
                                                                                    </div>

                                                                                    <div className="flex flex-wrap items-center gap-2 mt-3">
                                                                                        <button
                                                                                            onClick={() => saveRow(item)}
                                                                                            disabled={savingRow}
                                                                                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                                        >
                                                                                            {savingRow ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                                                            Save
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={cancelRowEdit}
                                                                                            className="flex items-center gap-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                                        >
                                                                                            <X size={13} />
                                                                                            Cancel
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => removeRow(item)}
                                                                                            disabled={savingRow}
                                                                                            className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold"
                                                                                        >
                                                                                            <Trash2 size={13} />
                                                                                            Delete
                                                                                        </button>

                                                                                        {MOVE_SOURCE_TYPE[activeTab] && (
                                                                                            <div className="flex items-center gap-1.5 ml-auto bg-orange-50 border border-orange-200 rounded-lg px-2 py-1">
                                                                                                <ArrowRightLeft size={13} className="text-orange-600" />
                                                                                                <span className="text-[10px] font-black uppercase text-orange-700">Move to</span>
                                                                                                <select
                                                                                                    value={moveType}
                                                                                                    onChange={(e) => setMoveType(e.target.value)}
                                                                                                    className="text-xs border border-orange-300 rounded px-1.5 py-1 font-bold text-orange-900 bg-white"
                                                                                                >
                                                                                                    <option value="">Select New Type...</option>
                                                                                                    {MOVE_TARGETS.filter(t => t.value !== MOVE_SOURCE_TYPE[activeTab]).map(t => (
                                                                                                        <option key={t.value} value={t.value}>{t.label}</option>
                                                                                                    ))}
                                                                                                </select>
                                                                                                <button
                                                                                                    onClick={() => moveRow(item)}
                                                                                                    disabled={savingRow}
                                                                                                    className="bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white px-2.5 py-1 rounded text-xs font-bold"
                                                                                                >
                                                                                                    Move
                                                                                                </button>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )
                                                                ];
                                                            })
                                                        )
                                                    )}
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span><b className="text-[#005994]">Pencil</b> = edit inline (item, group, opening balance, HS code, TRN, email, address, mobile, lot status...)</span>
                        <span><b className="text-[#005994]">Trash</b> = delete</span>
                        <span><b className="text-orange-600">Move</b> = change ledger type</span>
                        <span className="text-amber-700 font-bold">Admin password required for every save</span>
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
                        onSubmit={handleCreateSubmit}
                        className={`bg-white rounded-2xl w-full ${quickAddShowAll ? 'max-w-2xl' : 'max-w-md'} p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto`}
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
                            {/* MINIMAL: name only */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
                                    {quickAddType === 'group' ? 'Group Name' : 'Name'}
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder={quickAddType === 'group' ? 'Enter group name...' : 'Enter name...'}
                                    value={quickAddShowAll ? (quickAddForm.name ?? '') : quickAddName}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setQuickAddName(v);
                                        setQuickAddForm(prev => ({ ...prev, name: v }));
                                    }}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#005994]/20 focus:border-[#005994] transition-all"
                                    autoFocus
                                />
                            </div>

                            {/* MINIMAL: type only (under group / parent group / account type) */}
                            {createTypeField && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
                                        {createTypeField.label}
                                    </label>
                                    <select
                                        value={quickAddForm[createTypeField.key] ?? quickAddTargetGroup ?? ''}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setQuickAddTargetGroup(v);
                                            setQuickAddForm(prev => ({ ...prev, [createTypeField.key]: v }));
                                        }}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#005994]/20 focus:border-[#005994] transition-all bg-white"
                                    >
                                        <option value="">Select...</option>
                                        {(createTypeField.options || []).map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Expand to the complete Create / Alter Masters field set */}
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={toggleFullDetails}
                                    className="text-[11px] font-black uppercase tracking-wide text-[#005994] underline decoration-dotted underline-offset-2 hover:text-[#004878]"
                                >
                                    {quickAddShowAll ? 'Hide full details' : '+ Add full details'}
                                </button>
                                <span className="text-[10px] text-slate-400 font-semibold">
                                    {quickAddShowAll ? '' : '(you can save with just the name)'}
                                </span>
                            </div>

                            {quickAddShowAll && (
                                <div className="border-t border-slate-100 pt-3 space-y-3">
                                    {createDetailFields.length > 0 ? renderFieldGrid(
                                        createDetailFields,
                                        quickAddForm,
                                        (k, v) => setQuickAddForm(prev => ({ ...prev, [k]: v }))
                                    ) : (
                                        <p className="text-xs text-slate-400 italic">No extra fields for this type.</p>
                                    )}
                                    {quickAddType === 'ledger' && (
                                        <p className="text-[10px] text-slate-400 font-semibold">
                                            Opening Qty, Rate and Value auto-calculate. "Change Ledger Type (Move)" is available from the row editor after saving.
                                        </p>
                                    )}
                                    {quickAddType === 'group' && currentTab?.groupCollection === 'stock_groups' && (
                                        <p className="text-[10px] text-slate-400 font-semibold">
                                            These flags decide which quantities and values are rolled up into this group's totals.
                                        </p>
                                    )}
                                </div>
                            )}
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
