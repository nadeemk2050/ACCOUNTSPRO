import React, { useState, useEffect, useMemo } from 'react';
import {
    X, ArrowLeft, UploadCloud, FileText, RefreshCw, CheckCircle2, AlertCircle,
    Layers, Clock, ShieldCheck, Sparkles, AlertTriangle, Plus, Check, RotateCcw,
    History, HelpCircle, Filter, Search, Trash2
} from 'lucide-react';
import {
    parseDayBookRows,
    executeDayBookRows,
    createMissingMaster,
    rollbackBatchImport,
    getBatchHistory,
    readXmlFileText
} from './utils/excelImportEngine';

const MODULE_STYLE = {
    payment: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    receipt: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    journal: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    purchase: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    sales: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    stock_journal: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const masterLabel = (type) => (
    type === 'product' ? 'Create New Item'
        : type === 'tax' ? 'Create New Tax'
            : type === 'party' ? 'Create New Party'
                : type === 'account' ? 'Create New Ledger'
                    : type === 'expense' ? 'Create New Expense'
                        : 'Create New Master'
);

/** When Tally only says "entity missing", infer the most likely master type from the ledger name. */
const guessMasterType = (name, fallback) => {
    const n = String(name || '').toLowerCase();
    if (/\b(gst|vat|tax|duty|cess)\b/.test(n)) return 'tax';
    if (/\b(bank|cash)\b/.test(n)) return 'account';
    if (/(expense|exp\b|exp\d|charges|charge|fees|fee|salary|wages|rent|freight|labou?r|cartage|bill\b|repair|maintenance|commission)/.test(n)) return 'expense';
    return fallback || 'party';
};

/** Applies a master (created or linked) to every reference of `originalName` inside a row. */
function applyMasterToRow(row, { originalName, master, category }) {
    const key = norm(originalName);
    const hits = (v) => norm(v) === key;

    const resolvedItems = (row.resolvedItems || row.items || []).map(it =>
        hits(it.itemName || it.name)
            ? { ...it, matchedMaster: master, productId: master.id }
            : it
    );
    const resolvedTax = (row.resolvedTax || []).map(t =>
        hits(t.name)
            ? { ...t, taxId: master.id, taxName: master.name, percent: Number(master.percentage) || t.percent }
            : t
    );
    const resolvedSplits = (row.resolvedSplits || []).map(s =>
        hits(s.targetName)
            ? { ...s, matchedMaster: master, category: category || s.category, targetId: master.id, targetName: master.name }
            : s
    );
    const resolvedDrRows = (row.resolvedDrRows || []).map(r =>
        hits(r.targetName)
            ? { ...r, matchedMaster: master, category: category || r.category, targetId: master.id, targetName: master.name }
            : r
    );
    const resolvedCrRows = (row.resolvedCrRows || []).map(r =>
        hits(r.targetName)
            ? { ...r, matchedMaster: master, category: category || r.category, targetId: master.id, targetName: master.name }
            : r
    );

    let matchedPaidFrom = row.matchedPaidFrom;
    if (row.paidFrom && hits(row.paidFrom)) {
        matchedPaidFrom = { match: master, type: 'account', score: 1, isExact: true };
    }
    const matchedParty = row.partyName && hits(row.partyName) ? master : row.matchedParty;

    const issues = row.issues.filter(i => {
        if (i.rule === 'RULE_2_MISSING_MASTER') return norm(i.missingName) !== key;
        if (i.rule === 'RULE_5_FUZZY_MATCH') {
            const src = i.originalName || i.missingName || (i.suggestion && (i.suggestion.match || i.suggestion).name);
            return norm(src) !== key;
        }
        return true;
    });

    const stillCritical = issues.some(i => i.type === 'CRITICAL');
    return {
        ...row,
        resolvedItems,
        resolvedTax,
        resolvedSplits,
        resolvedDrRows,
        resolvedCrRows,
        matchedPaidFrom,
        matchedParty,
        issues,
        status: stillCritical ? 'WARNING' : 'RESOLVED',
        isResolved: !stillCritical
    };
}

/**
 * Day Book importer — one Tally export containing every voucher type.
 * Full pipeline: Upload & Parse → Solution Centre → Ready to Import → History & Rollback.
 */
export default function ImportDayBookXmlModal({
    isOpen,
    onClose,
    onBack,
    user,
    dataOwnerId,
    companyProfile,
    accounts = [],
    parties = [],
    expenses = [],
    directExpenseAccounts = [],
    incomeAccounts = [],
    capitalAccounts = [],
    assetAccounts = [],
    products = [],
    taxRates = [],
    locations = [],
    invoices = [],
    payments = [],
    journalVouchers = [],
    stockJournals = [],
    effectiveName = 'Admin',
    currencySymbol = 'AED',
    showToast
}) {
    const [activeTab, setActiveTab] = useState('upload');
    const [fileName, setFileName] = useState('');
    const [rawXml, setRawXml] = useState('');
    const [isParsing, setIsParsing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [summary, setSummary] = useState(null);
    const [cleanRows, setCleanRows] = useState([]);
    const [quarantinedRows, setQuarantinedRows] = useState([]);
    const [rowStatus, setRowStatus] = useState({});
    const [historyList, setHistoryList] = useState([]);
    const [importResult, setImportResult] = useState(null);

    // Large files: progress is coalesced (~5 updates/sec) instead of re-rendering per voucher.
    const rowStatusRef = React.useRef({});
    const rowStatusTimer = React.useRef(null);
    const queueRowStatus = (id, status) => {
        rowStatusRef.current[id] = status;
        if (rowStatusTimer.current) return;
        rowStatusTimer.current = setTimeout(() => {
            rowStatusTimer.current = null;
            const patch = rowStatusRef.current;
            rowStatusRef.current = {};
            setRowStatus(prev => ({ ...prev, ...patch }));
        }, 200);
    };
    useEffect(() => () => { if (rowStatusTimer.current) clearTimeout(rowStatusTimer.current); }, []);

    // Guardrail for very large Day Books + light row virtualization for the long lists.
    const BIG_FILE_LIMIT = 1500;
    const INITIAL_VISIBLE_ROWS = 250;
    const [bigFileAck, setBigFileAck] = useState(false);
    const [showAllSolution, setShowAllSolution] = useState(false);
    const [showAllReady, setShowAllReady] = useState(false);

    // Solution Centre filters
    const [moduleFilter, setModuleFilter] = useState('ALL');
    const [severityFilter, setSeverityFilter] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Create-master dialog
    const [createMasterModal, setCreateMasterModal] = useState({
        isOpen: false, rowId: null, name: '', type: 'party', percent: 0, rowKind: 'purchase', isSubmitting: false
    });

    const masters = useMemo(() => ({
        accounts, parties, expenses, directExpenseAccounts, incomeAccounts, capitalAccounts, assetAccounts, products, taxRates,
        defaultLocationId: locations[0]?.id || ''
    }), [accounts, parties, expenses, directExpenseAccounts, incomeAccounts, capitalAccounts, assetAccounts, products, taxRates, locations]);

    useEffect(() => {
        if (isOpen) setHistoryList(getBatchHistory());
    }, [isOpen]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && !createMasterModal.isOpen) onClose?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, createMasterModal.isOpen]);

    /* ---------------- UPLOAD & PARSE ---------------- */
    const handleFile = async (file) => {
        if (!file) return;
        if (!(file.name || '').toLowerCase().endsWith('.xml')) {
            alert('This section imports Tally XML only. Export the Day Book from Tally as XML.');
            return;
        }
        setFileName(file.name);
        setIsParsing(true);
        setImportResult(null);
        setRowStatus({});
        setBigFileAck(false);
        setShowAllSolution(false);
        setShowAllReady(false);
        try {
            const text = await readXmlFileText(file);
            setRawXml(text);
            const res = parseDayBookRows(text, {
                masters,
                companyProfile,
                invoices,
                payments,
                journalVouchers,
                stockJournals
            });
            setSummary(res);
            setCleanRows(res.cleanRows);
            setQuarantinedRows(res.quarantinedRows);
            if (res.quarantinedRows.length > 0) {
                setActiveTab('solution');
                if (showToast) {
                    showToast({
                        type: 'warning',
                        title: 'Validation Issues Detected',
                        message: `${res.quarantinedRows.length} voucher(s) routed to the Solution Centre.`
                    });
                }
            } else {
                setActiveTab('ready');
                if (showToast) {
                    showToast({ type: 'success', title: 'Day Book Validated', message: `${res.cleanRows.length} vouchers ready to import.` });
                }
            }
        } catch (err) {
            console.error('[DayBook] Parse error:', err);
            alert(`Failed to read the Day Book XML: ${err.message}`);
        } finally {
            setIsParsing(false);
        }
    };

    /* ---------------- SOLUTION CENTRE ---------------- */
    const patchRows = (rowId, mapper) => {
        setQuarantinedRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const updated = mapper(r);
            if (updated.isResolved) {
                setCleanRows(list => [...list, { ...updated, status: 'VALID' }]);
                return null;
            }
            return updated;
        }).filter(Boolean));
    };

    const handleAutoRenumber = (rowId) => {
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const issues = row.issues.filter(i => i.rule !== 'RULE_1_DUPLICATE_REF');
            const stillCritical = issues.some(i => i.type === 'CRITICAL');
            return {
                ...row,
                vchNo: `${row.vchNo}-IMP`,
                issues,
                status: stillCritical ? 'WARNING' : 'VALID',
                isResolved: !stillCritical
            };
        }));
    };

    const handleUpdateFxRate = (rowId, value) => {
        const rate = parseFloat(value) || 1;
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const issues = row.issues.filter(i => i.rule !== 'RULE_3_MISSING_FX');
            const stillCritical = issues.some(i => i.type === 'CRITICAL');
            return { ...row, exchangeRate: rate, issues, status: stillCritical ? 'WARNING' : 'VALID', isResolved: !stillCritical };
        }));
    };

    const handleAcceptFuzzy = (row, issue) => {
        const suggestion = issue.suggestion || {};
        const master = suggestion.match || suggestion;
        const originalName = issue.originalName || issue.missingName || (row[issue.field] ?? '');
        setQuarantinedRows(prev => prev.map(r => {
            if (r.id !== row.id) return r;
            const updated = applyMasterToRow(r, { originalName, master, category: suggestion.type });
            if (updated.isResolved) {
                setCleanRows(list => [...list, { ...updated, status: 'VALID' }]);
                return null;
            }
            return updated;
        }).filter(Boolean));
    };

    const openCreateMaster = (row, issue) => {
        const name = issue.missingName || issue.originalName || '';
        const base = issue.missingType || 'party';
        setCreateMasterModal({
            isOpen: true,
            rowId: row.id,
            name,
            type: base === 'party' ? guessMasterType(name, 'party') : base,
            percent: issue.missingPercent || 0,
            rowKind: row.__kind,
            isSubmitting: false
        });
    };

    const confirmCreateMaster = async () => {
        const { rowId, name, type, percent, rowKind } = createMasterModal;
        if (!name.trim()) return alert('Name cannot be empty');
        setCreateMasterModal(prev => ({ ...prev, isSubmitting: true }));
        try {
            const created = await createMissingMaster({
                name,
                type,
                percentage: percent,
                partyRole: rowKind === 'sales' ? 'customer' : 'supplier',
                dataOwnerId,
                user,
                effectiveName
            });
            if (type === 'party') parties.push(created);
            else if (type === 'product') products.push(created);
            else if (type === 'tax') taxRates.push(created);
            else if (type === 'account') accounts.push(created);
            else if (type === 'expense') expenses.push(created);

            setQuarantinedRows(prev => prev.map(r => {
                if (r.id !== rowId) return r;
                const updated = applyMasterToRow(r, { originalName: name, master: created, category: type });
                if (updated.isResolved) {
                    setCleanRows(list => [...list, { ...updated, status: 'VALID' }]);
                    return null;
                }
                return updated;
            }).filter(Boolean));

            if (showToast) {
                showToast({ type: 'success', title: 'Master Created', message: `"${created.name}" created and linked.` });
            }
            setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', percent: 0, isSubmitting: false });
        } catch (err) {
            console.error('[DayBook] Create master error:', err);
            alert(`Failed to create master: ${err.message}`);
            setCreateMasterModal(prev => ({ ...prev, isSubmitting: false }));
        }
    };

    const handleAbortRow = (rowId) => {
        setQuarantinedRows(prev => prev.filter(r => r.id !== rowId));
    };

    const handleSendToReady = (row) => {
        setQuarantinedRows(prev => prev.filter(r => r.id !== row.id));
        setCleanRows(prev => [...prev, { ...row, status: 'VALID', isResolved: true }]);
    };

    /* ---------------- IMPORT ---------------- */
    const handleExecuteImport = async () => {
        if (cleanRows.length === 0) return alert('Nothing in the Ready to Import queue.');
        setIsImporting(true);
        setRowStatus({});
        try {
            const results = await executeDayBookRows(cleanRows, {
                user,
                dataOwnerId,
                effectiveName,
                companyProfile,
                currencySymbol,
                lookups: { parties, products, taxRates, accounts, expenses, directExpenseAccounts, incomeAccounts, capitalAccounts, assetAccounts },
                chunkSize: 200,
                onRowStatus: queueRowStatus
            });
            setImportResult(results);
            setHistoryList(getBatchHistory());
            setRowStatus(prev => {
                const next = { ...prev };
                cleanRows.forEach(r => { if (!next[r.id] || next[r.id] === 'processing') next[r.id] = 'imported'; });
                return next;
            });            const imported = results.reduce((s, r) => s + r.imported, 0);
            if (showToast) {
                showToast({
                    type: imported > 0 ? 'success' : 'warning',
                    title: 'Day Book Import Finished',
                    message: `${imported} voucher(s) posted across ${results.filter(r => r.imported > 0).length} module(s).`
                });
            }
        } catch (err) {
            console.error('[DayBook] Import error:', err);
            alert(`Day Book import failed: ${err.message}`);
        } finally {
            setIsImporting(false);
        }
    };

    const handleRollback = async (batchId) => {
        if (!confirm(`Rollback batch ${batchId}? All vouchers imported in that batch will be deleted.`)) return;
        try {
            const res = await rollbackBatchImport(batchId, { user, dataOwnerId, effectiveName });
            setHistoryList(getBatchHistory());
            if (showToast) showToast({ type: 'success', title: 'Batch Reversed', message: `${res.deletedCount} voucher(s) deleted.` });
        } catch (err) {
            alert(`Rollback failed: ${err.message}`);
        }
    };

    /* ---------------- DERIVED ---------------- */
    const filteredRows = quarantinedRows.filter(row => {
        if (moduleFilter !== 'ALL' && row.__kind !== moduleFilter) return false;
        if (severityFilter === 'CRITICAL' && !row.issues.some(i => i.type === 'CRITICAL')) return false;
        if (severityFilter === 'WARNING' && !row.issues.some(i => i.type === 'WARNING')) return false;
        if (severityFilter === 'FUZZY' && !row.issues.some(i => i.rule === 'RULE_5_FUZZY_MATCH')) return false;
        if (searchQuery) {
            const hay = `${row.vchNo} ${row.partyName || ''} ${row.paidFrom || ''} ${row.paidTo || ''} ${row.__label}`.toLowerCase();
            if (!hay.includes(searchQuery.toLowerCase())) return false;
        }
        return true;
    });

    const totalIssues = quarantinedRows.reduce((s, r) => s + r.issues.filter(i => i.type === 'CRITICAL').length, 0);
    const readyTotal = cleanRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const rowSubtitle = (row) => {
        if (row.__kind === 'stock_journal') {
            return `Consumed ${row.consumed?.length || 0} → Produced ${row.produced?.length || 0}`;
        }
        if (row.__kind === 'payment' || row.__kind === 'receipt') {
            return `${row.paidFrom || '—'} → ${row.paidTo || '—'}`;
        }
        if (row.__kind === 'journal') {
            return `${row.paidTo || '—'} / ${row.paidFrom || '—'}`;
        }
        return row.partyName || '—';
    };

    // Large-file guardrail + rendered-window limits (keeps thousands of rows responsive).
    const totalParsed = summary?.total || 0;
    const isBigFile = totalParsed > BIG_FILE_LIMIT;
    const visibleReadyRows = showAllReady ? cleanRows : cleanRows.slice(0, INITIAL_VISIBLE_ROWS);
    const visibleSolutionRows = showAllSolution ? filteredRows : filteredRows.slice(0, INITIAL_VISIBLE_ROWS);
    const importBlocked = isImporting || cleanRows.length === 0 || (isBigFile && !bigFileAck);

    if (!isOpen) return null;

    const tabs = [
        { id: 'upload', label: '1. Upload & Parse', icon: UploadCloud },
        { id: 'solution', label: '2. Solution Centre', icon: AlertTriangle, badge: totalIssues },
        { id: 'ready', label: '3. Ready to Import', icon: CheckCircle2, badge: cleanRows.length },
        { id: 'history', label: 'Import History & Rollback', icon: History },
        { id: 'help', label: 'Instructions', icon: HelpCircle }
    ];

    return (
        <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#090d16] via-[#0f172a] to-[#090d16] text-white font-sans flex flex-col">
            {/* HEADER */}
            <div className="h-16 bg-black/40 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack || onClose}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-semibold"
                    >
                        <ArrowLeft size={16} className="text-emerald-400" />
                        <span>Back</span>
                    </button>
                    <div className="h-6 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-300">
                            <Layers size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-bold tracking-tight">IMPORT DAY BOOK FROM XML</h1>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    All Voucher Types
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                Automated Validation · Master Resolution · Routed to each module
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {fileName && (
                        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-cyan-300">
                            <FileText size={14} /> {fileName}
                        </div>
                    )}
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
                </div>
            </div>

            {/* TABS */}
            <div className="px-6 pt-3 pb-0 bg-black/20 border-b border-white/5 flex items-center gap-2 overflow-x-auto shrink-0">
                {tabs.map(t => {
                    const Icon = t.icon;
                    const active = activeTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`px-4 py-2.5 rounded-t-xl text-[11px] font-black uppercase tracking-wide flex items-center gap-2 whitespace-nowrap transition-all ${active ? 'bg-white/10 text-white border-x border-t border-white/20' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <Icon size={13} />
                            {t.label}
                            {!!t.badge && (
                                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[9px] font-black">{t.badge}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                {/* ---------------- TAB 1 ---------------- */}
                {activeTab === 'upload' && (
                    <>
                        <div className="rounded-2xl bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-cyan-950/30 border border-cyan-500/20 p-6">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] font-black uppercase tracking-wider mb-2">
                                <Sparkles size={12} /> Smart Voucher Router
                            </div>
                            <h2 className="text-xl font-bold tracking-tight">Import the whole Day Book in one pass</h2>
                            <p className="text-xs text-slate-400 max-w-2xl mt-1">
                                Payments → Payment vouchers · Receipts → Receipt vouchers · Journals → Journal vouchers ·
                                Purchases → Purchase invoices · Sales → Sales invoices · Stock Journals → Manufacturing entries.
                                Missing masters are resolved right here in the Solution Centre.
                            </p>
                        </div>

                        <div
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }}
                            className="border-2 border-dashed border-white/10 hover:border-cyan-500/50 rounded-3xl p-10 bg-white/[0.02] flex flex-col items-center text-center transition-all cursor-pointer"
                            onClick={() => document.getElementById('daybook-file-input')?.click()}
                        >
                            <input
                                id="daybook-file-input"
                                type="file"
                                accept=".xml"
                                className="hidden"
                                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                            />
                            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-300 mb-4">
                                {isParsing ? <RefreshCw className="animate-spin" size={28} /> : <UploadCloud size={32} />}
                            </div>
                            <h3 className="text-base font-bold mb-1">
                                {isParsing ? 'Reading Day Book…' : 'Click to browse or drop the Day Book XML'}
                            </h3>
                            <p className="text-xs text-slate-400">UTF-16 / UTF-8 Tally XML · .xml only</p>
                        </div>

                        {summary && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
                                <div className="flex items-center gap-2 text-sm font-bold">
                                    <CheckCircle2 size={16} className="text-emerald-400" />
                                    {summary.total} vouchers detected
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {Object.entries(summary.groups).map(([kind, g]) => (
                                        <div key={kind} className={`rounded-xl border p-3 ${MODULE_STYLE[kind] || 'bg-slate-500/10 text-slate-300 border-slate-500/30'}`}>
                                            <div className="text-[10px] uppercase font-black tracking-wider opacity-80">{kind.replace('_', ' ')}</div>
                                            <div className="text-2xl font-black">{g.count}</div>
                                            <div className="text-[10px] opacity-70">clean {g.clean} · issues {g.quarantined}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => setActiveTab('solution')} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">
                                        Open Solution Centre ({quarantinedRows.length})
                                    </button>
                                    <button onClick={() => setActiveTab('ready')} className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs">
                                        Ready to Import ({cleanRows.length})
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ---------------- TAB 2: SOLUTION CENTRE ---------------- */}
                {activeTab === 'solution' && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                                <Filter size={12} className="text-slate-400" />
                                <select
                                    value={moduleFilter}
                                    onChange={(e) => setModuleFilter(e.target.value)}
                                    className="bg-transparent text-xs text-white focus:outline-none"
                                >
                                    <option value="ALL">All modules</option>
                                    <option value="payment">Payment</option>
                                    <option value="receipt">Receipt</option>
                                    <option value="journal">Journal</option>
                                    <option value="purchase">Purchase</option>
                                    <option value="sales">Sales</option>
                                    <option value="stock_journal">Stock Journal</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                                <select
                                    value={severityFilter}
                                    onChange={(e) => setSeverityFilter(e.target.value)}
                                    className="bg-transparent text-xs text-white focus:outline-none"
                                >
                                    <option value="ALL">All issues</option>
                                    <option value="CRITICAL">Critical only</option>
                                    <option value="WARNING">Warnings</option>
                                    <option value="FUZZY">Fuzzy matches</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                                <Search size={12} className="text-slate-400" />
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Voucher / party…"
                                    className="bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none w-40"
                                />
                            </div>
                            <span className="text-[11px] text-slate-400 ml-auto">
                                {filteredRows.length} of {quarantinedRows.length} quarantined
                            </span>
                        </div>

                        {filteredRows.length === 0 ? (
                            <div className="p-10 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 text-center text-emerald-300 text-sm font-bold">
                                Nothing left to resolve — open Ready to Import.
                            </div>
                        ) : visibleSolutionRows.map(row => {
                            const critical = row.issues.some(i => i.type === 'CRITICAL');
                            return (
                                <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center font-bold ${critical ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>
                                                {critical ? '!' : <Check size={16} />}
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wider ${MODULE_STYLE[row.__kind] || ''}`}>
                                                        {row.__label}
                                                    </span>
                                                    <span className="font-mono text-xs font-black text-white">{row.vchNo}</span>
                                                    <span className="text-[11px] text-slate-400">· {row.date || 'Invalid'}</span>
                                                </div>
                                                <div className="text-sm font-bold text-white mt-0.5 truncate max-w-xl">
                                                    <span className="text-slate-300">{rowSubtitle(row)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <div className="text-base font-black text-white">
                                                    {currencySymbol} {(Number(row.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </div>
                                                <div className="text-[10px] text-slate-500 font-mono">{row.__kind}</div>
                                            </div>
                                            <button
                                                onClick={() => row.isResolved ? handleSendToReady(row) : handleAbortRow(row.id)}
                                                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 text-xs font-semibold border border-white/10"
                                            >
                                                {row.isResolved ? 'Send to Ready' : <Trash2 size={13} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        {row.issues.map((issue, idx) => (
                                            <div
                                                key={idx}
                                                className={`p-2.5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs ${issue.type === 'CRITICAL' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                                                    : issue.type === 'WARNING' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                                                        : 'bg-blue-500/10 border border-blue-500/20 text-blue-300'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <AlertCircle size={14} className="shrink-0" />
                                                    <span>{issue.message}</span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {issue.rule === 'RULE_2_MISSING_MASTER' && (
                                                        <button
                                                            onClick={() => openCreateMaster(row, issue)}
                                                            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                                                        >
                                                            <Plus size={13} />
                                                            {masterLabel(issue.missingType === 'party' ? guessMasterType(issue.missingName, 'party') : issue.missingType)}?
                                                        </button>
                                                    )}
                                                    {issue.rule === 'RULE_5_FUZZY_MATCH' && issue.suggestion && (
                                                        <>
                                                            <button
                                                                onClick={() => handleAcceptFuzzy(row, issue)}
                                                                className="px-3 py-1 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                                                            >
                                                                <Check size={13} />
                                                                Link to "{(issue.suggestion.match || issue.suggestion).name}"
                                                            </button>
                                                            <button
                                                                onClick={() => openCreateMaster(row, issue)}
                                                                className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                                                            >
                                                                <Plus size={13} />
                                                                {masterLabel(issue.missingType === 'party' ? guessMasterType(issue.missingName || issue.originalName, 'party') : (issue.missingType || 'party'))}
                                                            </button>
                                                        </>
                                                    )}
                                                    {issue.rule === 'RULE_1_DUPLICATE_REF' && (
                                                        <button
                                                            onClick={() => handleAutoRenumber(row.id)}
                                                            className="px-3 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs flex items-center gap-1.5"
                                                        >
                                                            <RotateCcw size={13} />
                                                            Auto-Renumber (-IMP)
                                                        </button>
                                                    )}
                                                    {issue.rule === 'RULE_3_MISSING_FX' && (
                                                        <input
                                                            type="number"
                                                            step="0.001"
                                                            placeholder="FX rate"
                                                            className="w-24 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs font-mono"
                                                            onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateFxRate(row.id, e.target.value); }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        {filteredRows.length > visibleSolutionRows.length && (
                            <button
                                onClick={() => setShowAllSolution(true)}
                                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300"
                            >
                                Show {filteredRows.length - visibleSolutionRows.length} more of {filteredRows.length}…
                            </button>
                        )}
                    </div>
                )}

                {/* ---------------- TAB 3: READY ---------------- */}
                {activeTab === 'ready' && (
                    <div className="space-y-4">
                        {isBigFile && (
                            <div className={`rounded-2xl border p-4 ${bigFileAck ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-amber-500/40 bg-amber-500/5'}`}>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle size={18} className={bigFileAck ? 'text-emerald-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
                                        <div>
                                            <div className={`text-sm font-bold ${bigFileAck ? 'text-emerald-300' : 'text-amber-300'}`}>
                                                Large file: {totalParsed.toLocaleString()} vouchers
                                            </div>
                                            <div className="text-[11px] text-slate-400 mt-1 max-w-2xl">
                                                This import runs in batches and may take a few minutes. For the fastest, safest result split the
                                                Day Book by month in Tally (F2 → one month) and import one file per month.
                                                {isBigFile && !bigFileAck ? ' Import stays locked until you acknowledge this.' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    {!bigFileAck && (
                                        <button
                                            onClick={() => setBigFileAck(true)}
                                            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider"
                                        >
                                            I understand — continue
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-emerald-950/30 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-bold">Ready to Ingest: {cleanRows.length} vouchers</h2>
                                <p className="text-xs text-slate-400 mt-1">
                                    Total {currencySymbol} {readyTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} · each voucher posts to its own module.
                                </p>
                            </div>
                            <button
                                onClick={handleExecuteImport}
                                disabled={importBlocked}
                                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-2"
                            >
                                {isImporting ? <RefreshCw className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                                {isImporting ? 'Importing…' : `Import ${cleanRows.length} Voucher(s)`}
                            </button>
                        </div>

                        <div className="rounded-2xl border border-white/10 overflow-hidden">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900 text-slate-400 uppercase text-[10px]">
                                    <tr>
                                        <th className="py-2.5 px-3">Module</th>
                                        <th className="py-2.5 px-3">Voucher</th>
                                        <th className="py-2.5 px-3">Date</th>
                                        <th className="py-2.5 px-3">Details</th>
                                        <th className="py-2.5 px-3 text-right">Amount</th>
                                        <th className="py-2.5 px-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {visibleReadyRows.map(row => (
                                        <tr key={row.id} className="hover:bg-white/[0.02]">
                                            <td className="py-2 px-3">
                                                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase ${MODULE_STYLE[row.__kind] || ''}`}>
                                                    {row.__label}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 font-mono font-bold text-white">{row.vchNo}</td>
                                            <td className="py-2 px-3 text-slate-300">{row.date}</td>
                                            <td className="py-2 px-3 text-slate-400 max-w-xs truncate">{rowSubtitle(row)}</td>
                                            <td className="py-2 px-3 text-right font-mono text-emerald-300">
                                                {(Number(row.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="py-2 px-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${rowStatus[row.id] === 'imported' ? 'bg-emerald-500/15 text-emerald-300'
                                                    : rowStatus[row.id] === 'error' ? 'bg-rose-500/15 text-rose-300'
                                                        : rowStatus[row.id] === 'processing' ? 'bg-amber-500/15 text-amber-300'
                                                            : 'bg-white/5 text-slate-400'}`}>
                                                    {rowStatus[row.id] || 'pending'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {cleanRows.length === 0 && (
                                        <tr><td colSpan={6} className="py-8 text-center text-slate-500">No vouchers in the ready queue.</td></tr>
                                    )}
                                </tbody>
                            </table>
                            {cleanRows.length > visibleReadyRows.length && (
                                <div className="p-3 border-t border-white/10 text-center">
                                    <button
                                        onClick={() => setShowAllReady(true)}
                                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-300"
                                    >
                                        Show {cleanRows.length - visibleReadyRows.length} more of {cleanRows.length}…
                                    </button>
                                </div>
                            )}
                        </div>

                        {importResult && (
                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-2">
                                <div className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                                    <CheckCircle2 size={15} /> Import complete
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {importResult.map(r => (
                                        <span key={r.kind} className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10 text-[11px] text-slate-300">
                                            {r.label}: <b className="text-emerald-300">{r.imported}</b>
                                            {r.verified !== null && r.verified !== undefined && (
                                                <span className={r.verified >= r.imported ? 'text-emerald-400' : 'text-rose-400'}>
                                                    {' '}· in DB {r.verified}
                                                </span>
                                            )}
                                            <span className="text-slate-500"> ({r.collectionName})</span>
                                        </span>
                                    ))}
                                </div>
                                {importResult.some(r => (r.verified || 0) === 0) && (
                                    <div className="text-[11px] text-rose-300 flex items-start gap-2 pt-1">
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                        A module reported 0 documents after writing — the voucher was not stored. Please report this batch ID.
                                    </div>
                                )}
                                <div className="text-[11px] text-slate-400 pt-1">
                                    Vouchers carry their original Tally dates. If a ledger looks empty, set the ledger period to include those dates
                                    (the Day Book tab still lists every imported voucher).
                                </div>
                                {quarantinedRows.length > 0 && (
                                    <div className="text-[11px] text-amber-300 flex items-center gap-2 pt-1">
                                        <AlertTriangle size={13} className="shrink-0" />
                                        {quarantinedRows.length} voucher(s) were NOT imported — they still have open issues.
                                        <button onClick={() => setActiveTab('solution')} className="underline font-bold">Open Solution Centre</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ---------------- TAB 4: HISTORY ---------------- */}
                {activeTab === 'history' && (
                    <div className="space-y-3">
                        {historyList.length === 0 ? (
                            <div className="p-10 rounded-2xl border border-white/10 text-center text-slate-500 text-sm">No import batches yet.</div>
                        ) : historyList.map(h => (
                            <div key={h.id || h.batchImportId} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="font-mono text-xs text-white">{h.batchImportId}</div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                        {h.docLabel || h.voucherType} · {h.count} voucher(s) · {h.user} · {new Date(h.timestamp).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-mono text-emerald-300">{currencySymbol} {(h.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    <button
                                        onClick={() => handleRollback(h.batchImportId)}
                                        className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold"
                                    >
                                        Rollback
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ---------------- TAB 5: INSTRUCTIONS ---------------- */}
                {activeTab === 'help' && (
                    <div className="space-y-5 text-sm text-slate-300 leading-relaxed">

                        {/* INTRO */}
                        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5">
                            <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                                <FileText size={16} /> Export the Day Book from Tally — 6 steps
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                Tally remembers these settings once you set them, so every later export is one keypress.
                                Use this single file to import Payment, Receipt, Journal, Purchase, Sales and Stock Journal vouchers in one pass.
                            </p>
                        </div>

                        {/* STEPS */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                            <h3 className="font-bold text-white">Step by step</h3>
                            <ol className="space-y-2 text-xs text-slate-300 list-none">
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">1</span>
                                    <span>Gateway of Tally → <b className="text-white">Display More Reports</b> → <b className="text-white">Day Book</b>.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">2</span>
                                    <span>Press <b className="text-white">F2: Period</b> and set the <b className="text-white">date range</b> you want to import (e.g. 01-Apr-2022 to 31-Mar-2023). Use one range per export — one month, one quarter, or the whole year.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">3</span>
                                    <span>Press <b className="text-white">E: Export</b> (or <b className="text-white">Ctrl + E</b>).</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">4</span>
                                    <span>On the export screen set: <b>Language</b> → Default (All Languages) · <b>Format</b> → <b className="text-amber-300">XML (Data Interchange)</b> · <b>Export Location</b> → Desktop / Documents (avoid Program Files) · <b>Output File Name</b> → e.g. <span className="font-mono text-cyan-300">daybook_sep2022.xml</span>.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">5</span>
                                    <span>Press <b className="text-white">F12: Configure</b> and apply the settings in the table below — especially <b className="text-emerald-300">Select vouchers to show → All Vouchers</b>.</span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-black flex items-center justify-center">6</span>
                                    <span>Press <b className="text-white">Enter</b> on “Open Exported Folder: Yes”, then upload that <span className="font-mono">.xml</span> file in <b>1. Upload &amp; Parse</b>.</span>
                                </li>
                            </ol>
                        </div>

                        {/* CONFIG TABLE */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <h3 className="font-bold text-white">F12: Configure — exact settings</h3>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                    Match this screen
                                </span>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-white/10">
                                <table className="w-full text-left text-[11px]">
                                    <thead className="bg-white/5 text-slate-400 uppercase text-[10px]">
                                        <tr>
                                            <th className="py-2 px-3">Setting</th>
                                            <th className="py-2 px-3">Value</th>
                                            <th className="py-2 px-3">Why it matters</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        <tr><td className="py-1.5 px-3">Format</td><td className="py-1.5 px-3 text-white font-bold">Detailed</td><td className="py-1.5 px-3 text-slate-400">Writes every ledger leg and item line.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show Voucher Numbers also</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Imported as the voucher reference — also enables duplicate detection.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show narrations</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Narration is stored on the voucher.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show bill wise details</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Keeps bill/reference information available.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show Cost Centre Details also</td><td className="py-1.5 px-3 text-slate-200 font-bold">No</td><td className="py-1.5 px-3 text-slate-400">Not used by AccPro — keeps the file smaller.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show inventory details</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400"><b>Required</b> for Purchase / Sales / Stock Journal item lines.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show additional description of Stock Item</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Needed for batch / godown information on items.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show Bank Details also</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Bank/allocation details on Payment &amp; Receipt vouchers.</td></tr>
                                        <tr><td className="py-1.5 px-3 pl-7 italic">Show Additional Details</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Sub-option of Bank Details — keep it on.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show dependant Masters also</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Carries the ledgers/items used by the vouchers.</td></tr>
                                        <tr className="bg-emerald-500/5"><td className="py-2 px-3 font-bold text-white">Select vouchers to show</td><td className="py-2 px-3 text-emerald-300 font-black">All Vouchers</td><td className="py-2 px-3 text-slate-300">Never leave it on “Accounting Entries Only” — that drops item lines.</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ROUTING */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
                            <h3 className="font-bold text-white">Where each voucher is posted</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                {[
                                    ['Payment', 'Payment vouchers (payments)'],
                                    ['Receipt', 'Receipt vouchers (payments)'],
                                    ['Journal', 'Journal vouchers (journal_vouchers)'],
                                    ['Purchase', 'Purchase invoices (invoices)'],
                                    ['Sales', 'Sales invoices (invoices)'],
                                    ['Stock Journal', 'Manufacturing / stock journals (stock_journals)']
                                ].map(([from, to]) => (
                                    <div key={from} className="flex items-center gap-2 rounded-lg bg-black/30 border border-white/5 px-3 py-2">
                                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">{from}</span>
                                        <span className="text-slate-400">→ {to}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* MISTAKES */}
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 space-y-3">
                            <h3 className="font-bold text-rose-300 flex items-center gap-2"><AlertTriangle size={15} /> Avoid these mistakes</h3>
                            <div className="overflow-x-auto rounded-xl border border-white/10">
                                <table className="w-full text-left text-[11px]">
                                    <thead className="bg-white/5 text-slate-400 uppercase text-[10px]">
                                        <tr><th className="py-2 px-3">Wrong choice</th><th className="py-2 px-3">What happens</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-slate-300">
                                        <tr><td className="py-1.5 px-3">Select vouchers = Accounting Entries Only</td><td className="py-1.5 px-3 text-slate-400">Purchase / Sales / Stock Journal arrive with <b>no item lines</b>.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show inventory details = No</td><td className="py-1.5 px-3 text-slate-400">Same problem — items missing from item vouchers.</td></tr>
                                        <tr><td className="py-1.5 px-3">Format = Excel / ASCII</td><td className="py-1.5 px-3 text-slate-400">Not XML — this importer cannot read it.</td></tr>
                                        <tr><td className="py-1.5 px-3">Show Voucher Numbers = No</td><td className="py-1.5 px-3 text-slate-400">Generated numbers → duplicate check cannot match existing vouchers.</td></tr>
                                        <tr><td className="py-1.5 px-3">Export Location = Program Files</td><td className="py-1.5 px-3 text-slate-400">Windows may block the write or hide the file — use Desktop / Documents.</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ORDER + RULES */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
                                <h3 className="font-bold text-white">Recommended order</h3>
                                <ol className="list-decimal ml-5 space-y-1 text-xs text-slate-400">
                                    <li><b className="text-slate-200">Import Masters of Accounts from XML</b></li>
                                    <li><b className="text-slate-200">Import Masters of Stock from XML</b></li>
                                    <li>Then this Day Book import — far fewer Solution Centre issues.</li>
                                </ol>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
                                <h3 className="font-bold text-white">Rules applied on import</h3>
                                <ul className="list-disc ml-5 space-y-1 text-xs text-slate-400">
                                    <li>Rule 1 — duplicate voucher numbers (auto-renumber with <span className="font-mono">-IMP</span>)</li>
                                    <li>Rule 2 — missing masters (create party / ledger / item / tax inline)</li>
                                    <li>Rule 3 — foreign currency without an FX rate</li>
                                    <li>Rule 4 — mandatory fields, zero amounts, unbalanced journals</li>
                                    <li>Rule 5 — fuzzy name matches (link or create new)</li>
                                    <li>Rule 6 — period lock dates</li>
                                </ul>
                            </div>
                        </div>

                        {/* TIP */}
                        <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-[11px] text-slate-400 flex items-start gap-2">
                            <Clock size={13} className="mt-0.5 text-cyan-300 shrink-0" />
                            <span>
                                <b className="text-slate-200">Tip:</b> export one clear file name per period (e.g. <span className="font-mono">daybook_apr2022_mar2023.xml</span>).
                                If a voucher is rejected, it stays in the Solution Centre with its exact reason — import the missing masters first, then run the same file again.
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* CREATE MASTER DIALOG */}
            {createMasterModal.isOpen && (
                <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-white/20 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
                        <div className="flex items-center justify-between pb-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                                    <Plus size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white">Create Master Record</h3>
                                    <p className="text-[10px] text-slate-400">Rule 2 · Day Book Solution Centre</p>
                                </div>
                            </div>
                            <button onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', percent: 0, isSubmitting: false })} className="text-slate-400 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-300 block mb-1">Master Name</label>
                                <input
                                    type="text"
                                    value={createMasterModal.name}
                                    onChange={(e) => setCreateMasterModal(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-bold focus:outline-none focus:border-amber-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-300 block mb-1">Classification</label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {[
                                        { id: 'party', label: 'Party / Ledger' },
                                        { id: 'product', label: 'Stock Item' },
                                        { id: 'account', label: 'Cash / Bank' },
                                        { id: 'expense', label: 'Expense Head' },
                                        { id: 'tax', label: 'Tax / VAT' }
                                    ].map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setCreateMasterModal(prev => ({ ...prev, type: t.id }))}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold border text-center ${createMasterModal.type === t.id ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-white/5 text-slate-300 border-white/10'}`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {createMasterModal.type === 'tax' && (
                                <div>
                                    <label className="text-xs font-bold text-slate-300 block mb-1">Tax Percentage (%)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={createMasterModal.percent ?? 0}
                                        onChange={(e) => setCreateMasterModal(prev => ({ ...prev, percent: e.target.value === '' ? '' : Number(e.target.value) }))}
                                        className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-bold"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                            <button
                                onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', percent: 0, isSubmitting: false })}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmCreateMaster}
                                disabled={createMasterModal.isSubmitting}
                                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5"
                            >
                                {createMasterModal.isSubmitting ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                                Create & Resolve
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="h-10 bg-black/40 border-t border-white/5 px-6 flex items-center justify-between text-[10px] text-slate-500">
                <div className="flex items-center gap-2">
                    <Clock size={11} />
                    <span>Day Book Router · Solution Centre active</span>
                </div>
                <div>Batch Engine v2.7.1</div>
            </div>
        </div>
    );
}
