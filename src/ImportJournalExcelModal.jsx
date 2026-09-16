import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X, ArrowLeft, FileSpreadsheet, UploadCloud, History,
    FileText, Sparkles, Download, Clock, CheckCircle2,
    AlertCircle, Layers, ArrowRight, ShieldCheck, AlertTriangle,
    RefreshCw, Filter, Search, Plus, ExternalLink, RotateCcw,
    Check, HelpCircle, ChevronRight, Lock, DollarSign, Database,
    BookOpen, Scale
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
    parseExcelFile,
    parseUniversalFile,
    validateImportBatch,
    createMissingMaster,
    executeBatchImport,
    rollbackBatchImport,
    getBatchHistory
} from './utils/excelImportEngine';

export default function ImportJournalExcelModal({
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
    journalVouchers = [],
    effectiveName = 'Admin',
    currencySymbol = 'AED',
    showToast
}) {
    const [activeTab, setActiveTab] = useState('upload');
    const [fileName, setFileName] = useState('');
    const [fileSize, setFileSize] = useState('');
    const [parsedData, setParsedData] = useState(null);
    const [cleanRows, setCleanRows] = useState([]);
    const [quarantinedRows, setQuarantinedRows] = useState([]);
    const [solutionFilter, setSolutionFilter] = useState('ALL');
    const [historyList, setHistoryList] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Operation states
    const [isParsing, setIsParsing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importResult, setImportResult] = useState(null);
    const [rollbackingId, setRollbackingId] = useState(null);

    // Missing Master Creator Modal State
    const [createMasterModal, setCreateMasterModal] = useState({
        isOpen: false,
        rowId: null,
        name: '',
        type: 'expense', // 'expense' | 'party' | 'account' | 'income' | 'capital' | 'asset'
        partyRole: 'supplier',
        isSubmitting: false
    });

    const fileInputRef = useRef(null);

    // Refresh history on open
    useEffect(() => {
        if (isOpen) {
            setHistoryList(getBatchHistory().filter(h => h.voucherType === 'journal' || h.docLabel === 'Journal' || !h.voucherType));
        }
    }, [isOpen]);

    // Handle Escape Key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && !createMasterModal.isOpen) {
                e.stopPropagation();
                if (onBack) onBack();
                else onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onBack, createMasterModal.isOpen]);

    // Filtered Quarantined Rows (Hook must run unconditionally before early return)
    const filteredQuarantined = useMemo(() => {
        if (!isOpen) return [];
        return quarantinedRows.filter(row => {
            if (solutionFilter === 'DUPLICATES') return row.issues.some(i => i.rule === 'RULE_1_DUPLICATE_REF');
            if (solutionFilter === 'MISSING_MASTERS') return row.issues.some(i => i.rule === 'RULE_2_MISSING_MASTER');
            if (solutionFilter === 'UNBALANCED') return row.issues.some(i => i.rule === 'RULE_4_UNBALANCED_JOURNAL');
            if (solutionFilter === 'FUZZY') return row.issues.some(i => i.rule === 'RULE_5_FUZZY_MATCH');
            if (solutionFilter === 'FX') return row.issues.some(i => i.rule === 'RULE_3_MISSING_FX');
            if (solutionFilter === 'PERIOD_LOCKED') return row.issues.some(i => i.rule === 'RULE_6_PERIOD_LOCK');
            return true;
        });
    }, [isOpen, quarantinedRows, solutionFilter]);

    if (!isOpen) return null;

    // --- FILE UPLOAD & PARSE HANDLER ---
    const handleFileUpload = async (file) => {
        if (!file) return;
        setFileName(file.name);
        setFileSize((file.size / 1024).toFixed(1) + ' KB');
        setIsParsing(true);
        setImportResult(null);

        try {
            const parsed = await parseUniversalFile(file, { voucherMode: 'journal' });
            setParsedData(parsed);

            // Run Validation Middleware (Rules 1-6)
            const validation = validateImportBatch(parsed.vouchers, {
                existingVouchers: journalVouchers,
                masters: {
                    accounts,
                    parties,
                    expenses,
                    directExpenseAccounts,
                    incomeAccounts,
                    capitalAccounts,
                    assetAccounts
                },
                companyProfile
            });

            setCleanRows(validation.cleanRows);
            setQuarantinedRows(validation.quarantinedRows);

            // Auto route: if quarantine has rows, suggest Solution Centre
            if (validation.quarantinedRows.length > 0) {
                setActiveTab('solution_centre');
                if (showToast) {
                    showToast({
                        type: 'warning',
                        title: 'Validation Issues Detected',
                        message: `${validation.quarantinedRows.length} journal transactions routed to Solution Centre.`
                    });
                }
            } else {
                setActiveTab('ready');
                if (showToast) {
                    showToast({
                        type: 'success',
                        title: 'File Validated Cleanly',
                        message: `All ${validation.cleanRows.length} journal vouchers are ready for batch ingestion.`
                    });
                }
            }
        } catch (err) {
            console.error('[ImportJournalExcel] Parse error:', err);
            alert(`Failed to parse file: ${err.message}`);
        } finally {
            setIsParsing(false);
        }
    };

    // --- SOLUTION CENTRE RESOLVERS ---

    // Rule 1: Auto-Renumber Duplicate Reference
    const handleAutoRenumber = (rowId) => {
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const newVchNo = `${row.vchNo}-JRNL-IMP`;
            const updatedIssues = row.issues.filter(i => i.rule !== 'RULE_1_DUPLICATE_REF');
            const stillHasIssues = updatedIssues.some(i => i.type === 'CRITICAL');
            return {
                ...row,
                vchNo: newVchNo,
                issues: updatedIssues,
                status: stillHasIssues ? 'WARNING' : 'VALID',
                isResolved: !stillHasIssues
            };
        }));
    };

    // Rule 5: Accept Fuzzy Match
    const handleAcceptFuzzy = (rowId, suggestion, targetField = 'all') => {
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const updatedDr = (row.resolvedDrRows || row.drRows || []).map(d => {
                if (d.targetName.trim().toLowerCase() === (suggestion.originalName || '').toLowerCase() || !d.targetId) {
                    return { ...d, targetId: suggestion.id, targetName: suggestion.name, matchedMaster: suggestion, category: suggestion.type || d.category };
                }
                return d;
            });
            const updatedCr = (row.resolvedCrRows || row.crRows || []).map(c => {
                if (c.targetName.trim().toLowerCase() === (suggestion.originalName || '').toLowerCase() || !c.targetId) {
                    return { ...c, targetId: suggestion.id, targetName: suggestion.name, matchedMaster: suggestion, category: suggestion.type || c.category };
                }
                return c;
            });

            const updatedIssues = row.issues.filter(i => !(i.rule === 'RULE_5_FUZZY_MATCH' && i.suggestion?.id === suggestion.id));
            const stillHasIssues = updatedIssues.some(i => i.type === 'CRITICAL');
            return {
                ...row,
                resolvedDrRows: updatedDr,
                resolvedCrRows: updatedCr,
                issues: updatedIssues,
                status: stillHasIssues ? 'WARNING' : 'VALID',
                isResolved: !stillHasIssues
            };
        }));
    };

    // Rule 2: Open Create Missing Master Modal
    const handleOpenCreateMaster = (row, missingName, missingType = 'expense') => {
        setCreateMasterModal({
            isOpen: true,
            rowId: row.id,
            name: missingName || '',
            type: missingType,
            partyRole: 'supplier',
            isSubmitting: false
        });
    };

    // Rule 2: Execute Missing Master Creation
    const handleConfirmCreateMaster = async () => {
        const { rowId, name, type, partyRole } = createMasterModal;
        if (!name.trim()) return alert('Name cannot be empty');

        setCreateMasterModal(prev => ({ ...prev, isSubmitting: true }));
        try {
            const created = await createMissingMaster({
                name,
                type,
                partyRole,
                dataOwnerId,
                user,
                effectiveName
            });

            // Update master lists locally so subsequent checks recognize it
            if (type === 'party') parties.push(created);
            else if (type === 'account') accounts.push(created);
            else if (type === 'expense') expenses.push(created);
            else if (type === 'direct_expense') directExpenseAccounts.push(created);
            else if (type === 'income') incomeAccounts.push(created);
            else if (type === 'capital') capitalAccounts.push(created);
            else if (type === 'asset') assetAccounts.push(created);

            // Update row in quarantined list
            setQuarantinedRows(prev => prev.map(row => {
                if (row.id !== rowId) return row;
                const updatedDr = (row.resolvedDrRows || row.drRows || []).map(d => {
                    if (d.targetName.trim().toLowerCase() === name.trim().toLowerCase() || !d.targetId) {
                        return { ...d, targetId: created.id, targetName: created.name, matchedMaster: created, category: type };
                    }
                    return d;
                });
                const updatedCr = (row.resolvedCrRows || row.crRows || []).map(c => {
                    if (c.targetName.trim().toLowerCase() === name.trim().toLowerCase() || !c.targetId) {
                        return { ...c, targetId: created.id, targetName: created.name, matchedMaster: created, category: type };
                    }
                    return c;
                });

                const updatedIssues = row.issues.filter(i => !(i.rule === 'RULE_2_MISSING_MASTER' && i.missingName?.trim().toLowerCase() === name.trim().toLowerCase()));
                const stillHasIssues = updatedIssues.some(i => i.type === 'CRITICAL');

                return {
                    ...row,
                    resolvedDrRows: updatedDr,
                    resolvedCrRows: updatedCr,
                    issues: updatedIssues,
                    status: stillHasIssues ? 'WARNING' : 'RESOLVED',
                    isResolved: !stillHasIssues
                };
            }));

            setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'expense', partyRole: 'supplier', isSubmitting: false });
            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Master Created',
                    message: `Ledger "${name}" created. Transaction status updated to RESOLVED.`
                });
            }
        } catch (err) {
            console.error('[CreateMaster] Error:', err);
            alert(`Failed to create master: ${err.message}`);
            setCreateMasterModal(prev => ({ ...prev, isSubmitting: false }));
        }
    };

    // Insert Resolved Transaction into Ready Queue
    const handleInsertResolvedTransaction = (rowId) => {
        const row = quarantinedRows.find(r => r.id === rowId);
        if (!row) return;

        setQuarantinedRows(prev => prev.filter(r => r.id !== rowId));
        setCleanRows(prev => [...prev, { ...row, status: 'VALID', issues: [] }]);

        if (showToast) {
            showToast({
                type: 'success',
                title: 'Transaction Enqueued',
                message: `Voucher ${row.vchNo} moved to Ready to Ingest queue.`
            });
        }
    };

    // Abort Transaction
    const handleAbortTransaction = (rowId) => {
        setQuarantinedRows(prev => prev.filter(r => r.id !== rowId));
        if (showToast) {
            showToast({
                type: 'info',
                title: 'Transaction Aborted',
                message: 'Row removed from import batch without affecting masters.'
            });
        }
    };

    // Rule 3: Update FX Rate
    const handleUpdateFxRate = (rowId, newRate) => {
        const rateNum = parseFloat(newRate) || 1.0;
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const updatedIssues = row.issues.filter(i => i.rule !== 'RULE_3_MISSING_FX');
            const stillHasIssues = updatedIssues.some(i => i.type === 'CRITICAL');
            return {
                ...row,
                exchangeRate: rateNum,
                issues: updatedIssues,
                status: stillHasIssues ? 'WARNING' : 'VALID',
                isResolved: !stillHasIssues
            };
        }));
    };

    // --- BATCH IMPORT EXECUTION (JOURNAL: voucherType: 'journal') ---
    const handleExecuteImport = async () => {
        if (cleanRows.length === 0) return alert('No valid transactions in the Ready to Import queue.');

        setIsImporting(true);
        setImportProgress(20);

        try {
            const result = await executeBatchImport(cleanRows, {
                user,
                dataOwnerId,
                effectiveName,
                companyProfile,
                currencySymbol,
                voucherType: 'journal',
                docLabel: 'Journal'
            });

            setImportProgress(100);
            setImportResult(result);
            setHistoryList(getBatchHistory());
            setCleanRows([]);

            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Batch Journal Import Completed',
                    message: `Successfully ingested ${result.totalImported} journal vouchers. Batch ID: ${result.batchImportId}`
                });
            }
        } catch (err) {
            console.error('[BatchImport] Error:', err);
            alert(`Batch import failed: ${err.message}`);
        } finally {
            setIsImporting(false);
        }
    };

    // --- BATCH ROLLBACK HANDLER ---
    const handleRollbackBatch = async (batchId) => {
        if (!confirm(`Are you sure you want to ROLLBACK Batch ${batchId}?\nThis will permanently delete all imported journal vouchers and revert ledger balance changes.`)) {
            return;
        }

        setRollbackingId(batchId);
        try {
            const res = await rollbackBatchImport(batchId, {
                user,
                dataOwnerId,
                effectiveName
            });
            setHistoryList(getBatchHistory());
            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Batch Rolled Back',
                    message: `Rollback complete: ${res.deletedCount} journal vouchers removed.`
                });
            }
        } catch (err) {
            console.error('[Rollback] Error:', err);
            alert(`Rollback failed: ${err.message}`);
        } finally {
            setRollbackingId(null);
        }
    };

    // --- TEMPLATE DOWNLOAD GENERATOR ---
    const handleDownloadTemplate = (type = 'standard') => {
        const wb = XLSX.utils.book_new();
        let ws;

        if (type === 'standard') {
            const sampleData = [
                ['Date', 'Voucher No', 'Dr Ledger (Debit)', 'Cr Ledger (Credit)', 'Amount', 'Currency', 'Exchange Rate', 'Narration'],
                ['2026-04-01', 'JV-3001', 'Depreciation Expense', 'Accumulated Depreciation', 4500, 'BASE', 1.0, 'Annual vehicle depreciation'],
                ['2026-04-02', 'JV-3002', 'Office Stationery Exp', 'Petty Cash Custodian', 750, 'BASE', 1.0, 'Month end stationery adjustment'],
                ['2026-04-03', 'JV-3003', 'Al Falah Trading LLC', 'Sunrise Trading FZE', 12000, 'BASE', 1.0, 'Inter-party balance settlement']
            ];
            ws = XLSX.utils.aoa_to_sheet(sampleData);
        } else {
            // Tally Columnar Journal format
            const sampleData = [
                ['AL SHAMS AL MUSHRIQAH METAL SCRAP TR'],
                ['SAJJA INDUSTRIAL AREA, SHARJAH'],
                ['Journal Register'],
                ['1-Feb-2026 to 28-Feb-2026'],
                ['Date', 'Particulars', 'Voucher Type', 'Voucher No.', 'Debit Amount', 'Credit Amount', 'Narration'],
                ['01-02-2026', 'Depreciation Expense', 'Journal', '3101', 4500, null, 'Plant & Machinery Depreciation'],
                ['01-02-2026', 'Accumulated Depreciation', 'Journal', '3101', null, 4500, 'Plant & Machinery Depreciation'],
                ['02-02-2026', 'Vehicle Repair Exp', 'Journal', '3102', 1200, null, 'Accrued maintenance provision'],
                ['02-02-2026', 'Accrued Expenses Payable', 'Journal', '3102', null, 1200, 'Accrued maintenance provision']
            ];
            ws = XLSX.utils.aoa_to_sheet(sampleData);
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Journal Template');
        XLSX.writeFile(wb, `AccPro_Journal_Template_${type}.xlsx`);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#0c0d24] via-[#12133a] to-[#0c0d24] text-white font-sans flex flex-col animate-in fade-in duration-300">
            {/* TOP HEADER */}
            <div className="h-16 bg-black/40 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-6 shrink-0 shadow-lg">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack || onClose}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-semibold group"
                        title="Back to Management Hub (Esc)"
                    >
                        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform text-indigo-400" />
                        <span>Back</span>
                    </button>

                    <div className="h-6 w-px bg-white/10" />

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                            <Scale size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-bold text-white tracking-tight leading-tight">
                                    IMP JRNL VCHR XLSX XML CSV
                                </h1>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    Double-Entry Engine
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium leading-none mt-1">
                                Automated Validation, Debit/Credit Balance Verification & Multi-Leg Batch Ingestion
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {fileName && (
                        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-indigo-400">
                            <FileSpreadsheet size={14} />
                            <span>{fileName}</span>
                            <span className="text-slate-500">({fileSize})</span>
                        </div>
                    )}
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 border border-white/10 text-slate-400 hover:border-rose-500/30 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* TAB NAVIGATION BAR */}
            <div className="bg-black/20 border-b border-white/5 px-6 py-2.5 shrink-0 backdrop-blur-sm">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    {/* Tab 1: Upload */}
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                            activeTab === 'upload'
                                ? 'bg-white/10 text-white border-indigo-500/50 shadow-md ring-1 ring-indigo-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <UploadCloud size={16} className={activeTab === 'upload' ? 'text-indigo-400' : 'text-slate-400'} />
                        <span>1. Upload Journals</span>
                    </button>

                    {/* Tab 2: Solution Centre */}
                    <button
                        onClick={() => setActiveTab('solution_centre')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 relative ${
                            activeTab === 'solution_centre'
                                ? 'bg-white/10 text-white border-amber-500/50 shadow-md ring-1 ring-amber-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <AlertTriangle size={16} className={activeTab === 'solution_centre' ? 'text-amber-400' : 'text-slate-400'} />
                        <span>2. Solution Centre</span>
                        {quarantinedRows.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-black">
                                {quarantinedRows.length} To Solve
                            </span>
                        )}
                    </button>

                    {/* Tab 3: Ready to Ingest */}
                    <button
                        onClick={() => setActiveTab('ready')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 relative ${
                            activeTab === 'ready'
                                ? 'bg-white/10 text-white border-indigo-500/50 shadow-md ring-1 ring-indigo-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <CheckCircle2 size={16} className={activeTab === 'ready' ? 'text-indigo-400' : 'text-slate-400'} />
                        <span>3. Ready to Ingest</span>
                        {cleanRows.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-[10px] font-black">
                                {cleanRows.length} Clean
                            </span>
                        )}
                    </button>

                    {/* Tab 4: History & Rollback */}
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                            activeTab === 'history'
                                ? 'bg-white/10 text-white border-blue-500/50 shadow-md ring-1 ring-blue-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <History size={16} className={activeTab === 'history' ? 'text-blue-400' : 'text-slate-400'} />
                        <span>Journal History & Rollback</span>
                        {historyList.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-mono">
                                {historyList.length}
                            </span>
                        )}
                    </button>

                    {/* Tab 5: Instructions */}
                    <button
                        onClick={() => setActiveTab('instructions')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                            activeTab === 'instructions'
                                ? 'bg-white/10 text-white border-purple-500/50 shadow-md ring-1 ring-purple-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <FileText size={16} className={activeTab === 'instructions' ? 'text-purple-400' : 'text-slate-400'} />
                        <span>Templates & Guide</span>
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col justify-start">
                {/* ========================================================
                    TAB 1: UPLOAD & PARSE
                   ======================================================== */}
                {activeTab === 'upload' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        {/* Hero Card */}
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-indigo-950/30 border border-indigo-500/20 p-6 shadow-xl">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <Sparkles size={12} /> Double-Entry Journal Ingestion Pipeline (XLSX / XML / CSV)
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Upload Journal Vouchers (Excel, XML, CSV)
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl">
                                    Drop your exported spreadsheet from Tally Prime (Journal Register), Tally XML Data Interchange, or custom CSV file. The engine validates double-entry balance (Total Dr == Total Cr), matches all ledger masters, and groups multi-leg entries automatically!
                                </p>
                            </div>
                        </div>

                        {/* Drag & Drop Upload Dropzone */}
                        <div
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-white/10 hover:border-indigo-500/50 rounded-3xl p-12 bg-white/[0.02] hover:bg-white/[0.04] flex flex-col items-center justify-center text-center transition-all cursor-pointer group shadow-inner"
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv,.xml"
                                className="hidden"
                                onChange={(e) => {
                                    if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                                }}
                            />

                            <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-5 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(99,102,241,0.15)]">
                                {isParsing ? <RefreshCw className="animate-spin" size={36} /> : <Scale size={40} />}
                            </div>

                            <h3 className="text-lg font-bold text-white tracking-tight mb-2">
                                {isParsing ? 'Parsing Journals & Verifying Balance...' : 'Click to Browse or Drag & Drop File'}
                            </h3>
                            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
                                Supports <span className="text-indigo-400 font-semibold">XLSX</span>, <span className="text-indigo-400 font-semibold">XML (Tally Interchange)</span>, and <span className="text-indigo-400 font-semibold">CSV</span> files. Verifies Dr/Cr balance and consolidates multi-leg journals!
                            </p>

                            <button
                                type="button"
                                className="px-6 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
                            >
                                <FileSpreadsheet size={16} />
                                <span>Select Journal File (XLSX, XML, CSV)</span>
                            </button>
                        </div>

                        {/* Quick Stats Grid If Loaded */}
                        {parsedData && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-300">
                                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-slate-400">Total Journals Parsed</div>
                                        <div className="text-2xl font-black text-white">{parsedData.vouchers.length}</div>
                                    </div>
                                    <Layers className="text-blue-400" size={28} />
                                </div>
                                <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-indigo-400">Ready for Ingestion</div>
                                        <div className="text-2xl font-black text-indigo-400">{cleanRows.length}</div>
                                    </div>
                                    <CheckCircle2 className="text-indigo-400" size={28} />
                                </div>
                                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-amber-400">Requires Solution Centre</div>
                                        <div className="text-2xl font-black text-amber-400">{quarantinedRows.length}</div>
                                    </div>
                                    <AlertTriangle className="text-amber-400" size={28} />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ========================================================
                    TAB 2: SOLUTION CENTRE (JOURNALS)
                   ======================================================== */}
                {activeTab === 'solution_centre' && (
                    <div className="max-w-6xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-amber-950/30 border border-amber-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <AlertTriangle size={12} /> Journal Discrepancy Quarantine
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Journal Solution Centre: {quarantinedRows.length} Items Requiring Attention
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Resolve missing ledgers, unbalanced Dr/Cr entries, or duplicate voucher numbers. Once resolved, the badge turns green and moves to the Ready Queue.
                                </p>
                            </div>

                            {/* Issue Filter Pills */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {[
                                    { id: 'ALL', label: 'All Issues' },
                                    { id: 'UNBALANCED', label: 'Unbalanced Dr/Cr' },
                                    { id: 'MISSING_MASTERS', label: 'Missing Ledgers' },
                                    { id: 'DUPLICATES', label: 'Duplicates' },
                                    { id: 'FUZZY', label: 'Fuzzy Matches' },
                                    { id: 'FX', label: 'FX Rates' },
                                    { id: 'PERIOD_LOCKED', label: 'Period Locked' }
                               ].map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => setSolutionFilter(f.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            solutionFilter === f.id
                                                ? 'bg-amber-500 text-slate-950 shadow-md'
                                                : 'bg-white/5 text-slate-400 hover:text-white border border-white/5'
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Quarantined Items List */}
                        {filteredQuarantined.length === 0 ? (
                            <div className="p-16 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-center">
                                <CheckCircle2 size={48} className="text-indigo-400 mb-3" />
                                <h3 className="text-base font-bold text-white">All Journal Discrepancies Resolved!</h3>
                                <p className="text-xs text-slate-400 max-w-md mt-1 mb-4">
                                    There are no pending quarantined journal transactions under this filter.
                                </p>
                                <button
                                    onClick={() => setActiveTab('ready')}
                                    className="px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold flex items-center gap-2"
                                >
                                    <span>Proceed to Ready Queue</span>
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {filteredQuarantined.map((row) => {
                                    const isResolved = row.status === 'RESOLVED' || row.isResolved;
                                    return (
                                        <div
                                            key={row.id}
                                            className={`rounded-2xl border p-5 transition-all ${
                                                isResolved
                                                    ? 'bg-indigo-950/20 border-indigo-500/40 ring-1 ring-indigo-500/20'
                                                    : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                                                        isResolved
                                                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                    }`}>
                                                        {isResolved ? <Check size={18} /> : '!'}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-xs font-black text-white">{row.vchNo}</span>
                                                            <span className="text-[11px] text-slate-400">· Date: <b className="text-slate-200">{row.date || 'Invalid'}</b></span>
                                                            <span className="text-[11px] text-slate-400">· Row: <b className="text-slate-200">#{row.rowNumber}</b></span>
                                                            {row.isMultiSplit && (
                                                                <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                                                                    Multi-Leg Entry
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm font-bold text-white mt-0.5">
                                                            Dr: <span className="text-indigo-400">{row.paidTo || (row.drRows?.map(r=>r.targetName).join(', ')) || 'N/A'}</span>
                                                            <span className="text-slate-400 font-normal"> · Cr: <b className="text-slate-200">{row.paidFrom || (row.crRows?.map(r=>r.targetName).join(', ')) || 'N/A'}</b></span>
                                                        </div>

                                                        {/* Dr and Cr Visual Breakdown */}
                                                        {row.isMultiSplit && (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                                                                <div className="p-2 rounded-lg bg-black/30 border border-indigo-500/20 space-y-1">
                                                                    <div className="text-[10px] uppercase font-bold text-indigo-400">Debit (Dr) Entries:</div>
                                                                    {(row.drRows || []).map((dr, dIdx) => (
                                                                        <div key={dIdx} className="flex items-center justify-between text-xs text-slate-300 font-mono">
                                                                            <span className="truncate max-w-[140px]">· {dr.targetName}</span>
                                                                            <span className="font-bold text-indigo-400">{currencySymbol} {dr.amount?.toLocaleString()}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="p-2 rounded-lg bg-black/30 border border-purple-500/20 space-y-1">
                                                                    <div className="text-[10px] uppercase font-bold text-purple-400">Credit (Cr) Entries:</div>
                                                                    {(row.crRows || []).map((cr, cIdx) => (
                                                                        <div key={cIdx} className="flex items-center justify-between text-xs text-slate-300 font-mono">
                                                                            <span className="truncate max-w-[140px]">· {cr.targetName}</span>
                                                                            <span className="font-bold text-purple-400">{currencySymbol} {cr.amount?.toLocaleString()}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="text-right">
                                                        <div className="text-base font-black text-white">
                                                            {currencySymbol} {row.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-mono">
                                                            Dr: {row.totalDr?.toLocaleString()} | Cr: {row.totalCr?.toLocaleString()}
                                                        </div>
                                                    </div>

                                                    {isResolved ? (
                                                        <button
                                                            onClick={() => handleInsertResolvedTransaction(row.id)}
                                                            className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 animate-in zoom-in-95"
                                                        >
                                                            <CheckCircle2 size={16} />
                                                            <span>Insert Transaction</span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleAbortTransaction(row.id)}
                                                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 text-xs font-semibold border border-white/10"
                                                        >
                                                            Abort
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Issues & Inline Resolutions */}
                                            <div className="pt-4 space-y-3">
                                                {row.issues.map((issue, iIdx) => (
                                                    <div
                                                        key={iIdx}
                                                        className={`p-3 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs ${
                                                            issue.type === 'CRITICAL'
                                                                ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                                                                : issue.type === 'WARNING'
                                                                ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                                                                : 'bg-blue-500/10 border border-blue-500/20 text-blue-300'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <AlertCircle size={16} className="shrink-0" />
                                                            <span>{issue.message}</span>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {issue.rule === 'RULE_2_MISSING_MASTER' && (
                                                                <button
                                                                    onClick={() => handleOpenCreateMaster(row, issue.missingName, issue.missingType)}
                                                                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                                                                >
                                                                    <Plus size={14} />
                                                                    <span>Create Missing Ledger?</span>
                                                                </button>
                                                            )}

                                                            {issue.rule === 'RULE_5_FUZZY_MATCH' && issue.suggestion && (
                                                                <button
                                                                    onClick={() => handleAcceptFuzzy(row.id, issue.suggestion)}
                                                                    className="px-3 py-1 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                                                                >
                                                                    <Check size={14} />
                                                                    <span>Link to "{issue.suggestion.name}"</span>
                                                                </button>
                                                            )}

                                                            {issue.rule === 'RULE_1_DUPLICATE_REF' && (
                                                                <button
                                                                    onClick={() => handleAutoRenumber(row.id)}
                                                                    className="px-3 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs flex items-center gap-1.5"
                                                                >
                                                                    <RotateCcw size={14} />
                                                                    <span>Auto-Renumber (-JRNL-IMP)</span>
                                                                </button>
                                                            )}

                                                            {issue.rule === 'RULE_3_MISSING_FX' && (
                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        step="0.001"
                                                                        placeholder="Enter Rate"
                                                                        className="w-24 px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs font-mono"
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') handleUpdateFxRate(row.id, e.target.value);
                                                                        }}
                                                                    />
                                                                    <span className="text-[10px] text-slate-400">(Press Enter)</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ========================================================
                    TAB 3: READY TO IMPORT (JOURNALS)
                   ======================================================== */}
                {activeTab === 'ready' && (
                    <div className="max-w-6xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header Summary Banner */}
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-indigo-950/30 border border-indigo-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <CheckCircle2 size={12} /> Verified & Balanced Journal Ingestion Queue
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Ready to Ingest: {cleanRows.length} Journal Vouchers
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Total Value: <b className="text-indigo-400 font-mono text-sm">{currencySymbol} {cleanRows.reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>. All entries are double-entry verified and balanced.
                                </p>
                            </div>

                            <button
                                disabled={cleanRows.length === 0 || isImporting}
                                onClick={handleExecuteImport}
                                className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-xl transition-all ${
                                    cleanRows.length > 0 && !isImporting
                                        ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20 hover:scale-105 active:scale-95'
                                        : 'bg-white/10 text-slate-500 border border-white/5 cursor-not-allowed'
                                }`}
                            >
                                {isImporting ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={16} />
                                        <span>Importing Batch ({importProgress}%)...</span>
                                    </>
                                ) : (
                                    <>
                                        <Database size={16} />
                                        <span>Execute Batch Import ({cleanRows.length} Journals)</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Search & Grid Controls */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="relative max-w-xs w-full">
                                <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by Voucher No or Ledger..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                                />
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                                Showing {cleanRows.length} rows
                            </div>
                        </div>

                        {/* Verified Data Table */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
                            <div className="overflow-x-auto max-h-[50vh]">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="sticky top-0 bg-slate-900 border-b border-white/10 text-slate-400 z-10">
                                        <tr>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">#</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Date</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Voucher No</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Debit (Dr) Ledgers</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Credit (Cr) Ledgers</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Narration</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px] text-right">Amount ({currencySymbol})</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-slate-300 font-medium">
                                        {cleanRows
                                            .filter(r => {
                                                if (!searchQuery) return true;
                                                const q = searchQuery.toLowerCase();
                                                return r.vchNo.toLowerCase().includes(q) || r.paidTo.toLowerCase().includes(q) || r.paidFrom.toLowerCase().includes(q);
                                            })
                                            .map((row, idx) => (
                                                <tr key={row.id || idx} className="hover:bg-white/[0.03] transition-colors">
                                                    <td className="py-2.5 px-4 text-slate-500 font-mono">{idx + 1}</td>
                                                    <td className="py-2.5 px-4 font-mono text-slate-300">{row.date}</td>
                                                    <td className="py-2.5 px-4 font-mono font-bold text-indigo-400">
                                                        <div className="flex items-center gap-1.5">
                                                            <span>{row.vchNo}</span>
                                                            {row.isMultiSplit && (
                                                                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[9px] font-bold border border-purple-500/30">
                                                                    MULTI
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-4 font-bold text-white">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate max-w-[200px]">{row.paidTo}</span>
                                                            {row.drRows && row.drRows.length > 1 && (
                                                                <span className="shrink-0 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold">
                                                                    {row.drRows.length} Dr
                                                                </span>
                                                            )}
                                                        </div>
                                                        {row.drRows && row.drRows.length > 1 && (
                                                            <div className="text-[10px] text-slate-400 font-normal mt-1 space-y-0.5 bg-black/20 p-1.5 rounded-lg border border-white/5">
                                                                {row.drRows.map((d, di) => (
                                                                    <div key={di} className="flex items-center justify-between text-slate-300">
                                                                        <span className="truncate max-w-[140px] text-slate-400">· {d.targetName}</span>
                                                                        <span className="font-mono font-semibold text-indigo-400">{currencySymbol} {d.amount?.toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-4 font-bold text-white">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate max-w-[200px]">{row.paidFrom}</span>
                                                            {row.crRows && row.crRows.length > 1 && (
                                                                <span className="shrink-0 px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                                                                    {row.crRows.length} Cr
                                                                </span>
                                                            )}
                                                        </div>
                                                        {row.crRows && row.crRows.length > 1 && (
                                                            <div className="text-[10px] text-slate-400 font-normal mt-1 space-y-0.5 bg-black/20 p-1.5 rounded-lg border border-white/5">
                                                                {row.crRows.map((c, ci) => (
                                                                    <div key={ci} className="flex items-center justify-between text-slate-300">
                                                                        <span className="truncate max-w-[140px] text-slate-400">· {c.targetName}</span>
                                                                        <span className="font-mono font-semibold text-purple-400">{currencySymbol} {c.amount?.toLocaleString()}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-slate-400 truncate max-w-xs">{row.narration || '—'}</td>
                                                    <td className="py-2.5 px-4 font-mono font-bold text-right text-white">
                                                        {row.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* ========================================================
                    TAB 4: IMPORT HISTORY & BATCH ROLLBACK (JOURNALS)
                   ======================================================== */}
                {activeTab === 'history' && (
                    <div className="max-w-5xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-blue-950/30 border border-blue-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <History size={12} /> Journal Audit Trail
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Journal Import History & Rollback Centre
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Every import session receives an isolated Batch ID. You can inspect logs or initiate a full atomic rollback anytime.
                                </p>
                            </div>
                        </div>

                        {historyList.length === 0 ? (
                            <div className="p-16 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-center">
                                <Clock size={40} className="text-slate-500 mb-3" />
                                <h3 className="text-base font-bold text-white">No Journal Import History Found</h3>
                                <p className="text-xs text-slate-400 max-w-xs mt-1">
                                    Transactions imported through this module will appear here for audit tracking.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {historyList.map((item) => (
                                    <div
                                        key={item.id}
                                        className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs font-black text-indigo-400">{item.batchImportId}</span>
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                                    item.status === 'ROLLED_BACK'
                                                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                                        : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                                }`}>
                                                    {item.status || 'INGESTED'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-400">
                                                <span>Imported on: <b className="text-slate-200">{new Date(item.timestamp).toLocaleString()}</b></span>
                                                <span> · Total: <b className="text-white">{item.totalImported} Journal Vouchers</b></span>
                                                <span> · Operator: <b className="text-slate-200">{item.effectiveName || 'Admin'}</b></span>
                                            </div>
                                        </div>

                                        <div>
                                            {item.status !== 'ROLLED_BACK' && (
                                                <button
                                                    disabled={rollbackingId === item.batchImportId}
                                                    onClick={() => handleRollbackBatch(item.batchImportId)}
                                                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:border-rose-500 text-xs font-bold transition-all flex items-center gap-1.5"
                                                >
                                                    {rollbackingId === item.batchImportId ? (
                                                        <RefreshCw className="animate-spin" size={14} />
                                                    ) : (
                                                        <RotateCcw size={14} />
                                                    )}
                                                    <span>Rollback Batch</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ========================================================
                    TAB 5: INSTRUCTIONS & TEMPLATES
                   ======================================================== */}
                {activeTab === 'instructions' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900/60 to-purple-950/30 border border-purple-500/20 shadow-xl">
                            <h2 className="text-xl font-bold text-white tracking-tight mb-2">
                                Download Pre-Configured Journal Templates
                            </h2>
                            <p className="text-xs text-slate-400 max-w-xl mb-6">
                                Use our sample templates to ensure your column names and formatting are 100% compliant with AccPro and Tally Prime double-entry rules.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                                        <FileSpreadsheet size={18} />
                                        <span>Standard AccPro Journal Template</span>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Clean tabular format with `Date`, `Voucher No`, `Dr Ledger (Debit)`, `Cr Ledger (Credit)`, `Amount`, and `Narration`.
                                    </p>
                                    <button
                                        onClick={() => handleDownloadTemplate('standard')}
                                        className="px-4 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-bold flex items-center gap-2"
                                    >
                                        <Download size={14} />
                                        <span>Download Standard Template (.xlsx)</span>
                                    </button>
                                </div>

                                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-3">
                                    <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                                        <Layers size={18} />
                                        <span>Tally Prime Journal Register Template</span>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Columnar register exported directly from Tally Prime ({'Display > Account Books > Journal Register > Export'}).
                                    </p>
                                    <button
                                        onClick={() => handleDownloadTemplate('tally')}
                                        className="px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-bold flex items-center gap-2"
                                    >
                                        <Download size={14} />
                                        <span>Download Tally Format (.xlsx)</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Rules Guide */}
                        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider text-indigo-400">
                                Double-Entry Import Rules Summary
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
                                <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                                    <div className="font-bold text-white flex items-center gap-1.5">
                                        <Scale size={14} className="text-indigo-400" />
                                        <span>Total Debit = Total Credit Balance</span>
                                    </div>
                                    <p className="text-slate-400">
                                        Every journal voucher must balance. Imbalances are automatically intercepted and routed to the Solution Centre.
                                    </p>
                                </div>
                                <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                                    <div className="font-bold text-white flex items-center gap-1.5">
                                        <Sparkles size={14} className="text-indigo-400" />
                                        <span>1-Click Missing Master Creation</span>
                                    </div>
                                    <p className="text-slate-400">
                                        Missing ledgers can be created instantly in-line, turning the transaction to RESOLVED immediately.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================================
                INLINE MISSING MASTER CREATION MODAL
               ======================================================== */}
            {createMasterModal.isOpen && (
                <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="max-w-md w-full rounded-2xl bg-[#12133a] border border-indigo-500/40 p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <Plus className="text-indigo-400" size={18} />
                                <h3 className="text-sm font-bold text-white">Create Missing Ledger Master</h3>
                            </div>
                            <button
                                onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'expense', partyRole: 'supplier', isSubmitting: false })}
                                className="text-slate-400 hover:text-white"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Ledger Name</label>
                                <input
                                    type="text"
                                    value={createMasterModal.name}
                                    onChange={(e) => setCreateMasterModal(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/20 text-xs text-white focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">Account Category</label>
                                <select
                                    value={createMasterModal.type}
                                    onChange={(e) => setCreateMasterModal(prev => ({ ...prev, type: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/20 text-xs text-white focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="expense">Expense (Administrative)</option>
                                    <option value="direct_expense">Direct Expense (COGS)</option>
                                    <option value="party">Party / Counterparty (Debtor/Creditor)</option>
                                    <option value="account">Bank / Cash Account</option>
                                    <option value="income">Income / Revenue Head</option>
                                    <option value="asset">Fixed Asset</option>
                                    <option value="capital">Capital Account</option>
                                </select>
                            </div>

                            {createMasterModal.type === 'party' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">Party Role</label>
                                    <select
                                        value={createMasterModal.partyRole}
                                        onChange={(e) => setCreateMasterModal(prev => ({ ...prev, partyRole: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/20 text-xs text-white focus:outline-none focus:border-indigo-500"
                                    >
                                        <option value="supplier">Sundry Creditor (Supplier / Payee)</option>
                                        <option value="customer">Sundry Debtor (Customer / Payer)</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        <div className="pt-2 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'expense', partyRole: 'supplier', isSubmitting: false })}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-400"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={createMasterModal.isSubmitting}
                                onClick={handleConfirmCreateMaster}
                                className="px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-indigo-500/20"
                            >
                                {createMasterModal.isSubmitting ? (
                                    <RefreshCw className="animate-spin" size={14} />
                                ) : (
                                    <Check size={14} />
                                )}
                                <span>Create & Resolve</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
