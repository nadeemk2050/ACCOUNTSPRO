import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X, ArrowLeft, FileSpreadsheet, UploadCloud, History,
    FileText, Sparkles, Download, Clock, CheckCircle2,
    AlertCircle, Layers, ArrowRight, ShieldCheck, AlertTriangle,
    RefreshCw, Filter, Search, Plus, ExternalLink, RotateCcw,
    Check, HelpCircle, ChevronRight, Lock, DollarSign, Database,
    ArrowDownLeft
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

export default function ImportReceiptExcelModal({
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
    payments = [],
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

    // Missing Master Creator Modal State (Default to Customer for Receipts)
    const [createMasterModal, setCreateMasterModal] = useState({
        isOpen: false,
        rowId: null,
        name: '',
        type: 'party', // 'party' | 'account' | 'income'
        partyRole: 'customer',
        isSubmitting: false
    });

    const fileInputRef = useRef(null);

    // Refresh history on open
    useEffect(() => {
        if (isOpen) {
            setHistoryList(getBatchHistory().filter(h => h.voucherType === 'in' || h.docLabel === 'Receipt' || !h.voucherType));
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
            const parsed = await parseUniversalFile(file, { voucherMode: 'receipt' });
            setParsedData(parsed);

            // Run Validation Middleware (Rules 1-6)
            const validation = validateImportBatch(parsed.vouchers, {
                existingVouchers: payments,
                masters: {
                    accounts,
                    parties,
                    expenses,
                    directExpenseAccounts,
                    incomeAccounts
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
                        message: `${validation.quarantinedRows.length} receipt transactions routed to Solution Centre.`
                    });
                }
            } else {
                setActiveTab('ready');
                if (showToast) {
                    showToast({
                        type: 'success',
                        title: 'File Validated Cleanly',
                        message: `All ${validation.cleanRows.length} receipt vouchers are ready for batch ingestion.`
                    });
                }
            }
        } catch (err) {
            console.error('[ImportReceiptExcel] Parse error:', err);
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
            const newVchNo = `${row.vchNo}-RCP-IMP`;
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
    const handleAcceptFuzzy = (rowId, suggestion) => {
        setQuarantinedRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const updatedSplits = (row.resolvedSplits || []).map(s => ({
                ...s,
                targetId: suggestion.id,
                targetName: suggestion.name,
                matchedMaster: suggestion
            }));
            const updatedIssues = row.issues.filter(i => i.rule !== 'RULE_5_FUZZY_MATCH');
            const stillHasIssues = updatedIssues.some(i => i.type === 'CRITICAL');
            return {
                ...row,
                paidTo: suggestion.name,
                resolvedSplits: updatedSplits,
                issues: updatedIssues,
                status: stillHasIssues ? 'WARNING' : 'VALID',
                isResolved: !stillHasIssues
            };
        }));
    };

    // Rule 2: Open Create Missing Master Modal (Defaults to Customer)
    const handleOpenCreateMaster = (row, missingName, missingType = 'party') => {
        setCreateMasterModal({
            isOpen: true,
            rowId: row.id,
            name: missingName || row.paidTo || '',
            type: missingType,
            partyRole: 'customer',
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
            else if (type === 'income') incomeAccounts.push(created);

            // Update row in quarantined list
            setQuarantinedRows(prev => prev.map(row => {
                if (row.id !== rowId) return row;
                const updatedSplits = (row.resolvedSplits || []).map(s => {
                    if (s.targetName.trim().toLowerCase() === name.trim().toLowerCase() || !s.targetId) {
                        return {
                            ...s,
                            targetId: created.id,
                            targetName: created.name,
                            matchedMaster: created,
                            category: type
                        };
                    }
                    return s;
                });

                let updatedPaidFrom = row.matchedPaidFrom;
                if (type === 'account' && row.paidFrom.trim().toLowerCase() === name.trim().toLowerCase()) {
                    updatedPaidFrom = { match: created, type: 'account', score: 1.0, isExact: true };
                }

                const updatedIssues = row.issues.filter(i => {
                    if (i.rule === 'RULE_2_MISSING_MASTER') {
                        return i.missingName?.trim().toLowerCase() !== name.trim().toLowerCase();
                    }
                    return true;
                });

                const stillHasCritical = updatedIssues.some(i => i.type === 'CRITICAL');
                return {
                    ...row,
                    matchedPaidFrom: updatedPaidFrom,
                    resolvedSplits: updatedSplits,
                    issues: updatedIssues,
                    status: stillHasCritical ? 'WARNING' : 'RESOLVED',
                    isResolved: !stillHasCritical
                };
            }));

            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Customer Master Created',
                    message: `Master "${created.name}" created. Status updated to RESOLVED.`
                });
            }
            setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', partyRole: 'customer', isSubmitting: false });
        } catch (err) {
            console.error('[CreateMaster] Error:', err);
            alert(`Failed to create master: ${err.message}`);
            setCreateMasterModal(prev => ({ ...prev, isSubmitting: false }));
        }
    };

    // Move Resolved Row to Ready to Import Queue
    const handleInsertResolvedTransaction = (rowId) => {
        const row = quarantinedRows.find(r => r.id === rowId);
        if (!row) return;

        let finalRow = { ...row };
        if (!finalRow.matchedPaidFrom && accounts.length > 0) {
            const defaultCash = accounts.find(a => /cash/i.test(a.name)) || accounts[0];
            finalRow.matchedPaidFrom = { match: defaultCash, type: 'account', score: 1.0, isExact: true };
        }

        setQuarantinedRows(prev => prev.filter(r => r.id !== rowId));
        setCleanRows(prev => [...prev, { ...finalRow, status: 'VALID' }]);

        if (showToast) {
            showToast({
                type: 'success',
                title: 'Transaction Approved',
                message: `Receipt voucher "${row.vchNo}" moved to Ready to Import queue.`
            });
        }
    };

    // Abort/Discard Quarantined Transaction
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

    // --- BATCH IMPORT EXECUTION (RECEIPTS: type: 'in') ---
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
                voucherType: 'in', // INWARD FLOW (Receipt)
                docLabel: 'Receipt'
            });

            setImportProgress(100);
            setImportResult(result);
            setHistoryList(getBatchHistory());
            setCleanRows([]);

            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Batch Receipt Import Completed',
                    message: `Successfully ingested ${result.totalImported} receipt vouchers. Batch ID: ${result.batchImportId}`
                });
            }
        } catch (err) {
            console.error('[BatchReceiptImport] Error:', err);
            alert(`Batch receipt import failed: ${err.message}`);
        } finally {
            setIsImporting(false);
        }
    };

    // --- BATCH ROLLBACK HANDLER ---
    const handleRollbackBatch = async (batchId) => {
        if (!confirm(`Are you sure you want to ROLLBACK Batch ${batchId}?\nThis will permanently delete all imported receipt vouchers and revert account balance changes.`)) {
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
                    message: `Rollback complete: ${res.deletedCount} receipt vouchers removed.`
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
                ['Date', 'Voucher No', 'Received In (Bank/Cash)', 'Received From (Customer)', 'Amount', 'Currency', 'Exchange Rate', 'Narration'],
                ['2026-04-01', 'RCP-2001', 'Commercial Bank', 'Global Metal Importers LLC', 15000, 'BASE', 1.0, 'Customer payment inv 892'],
                ['2026-04-02', 'RCP-2002', 'Main Cash', 'Sunrise Trading FZE', 3500, 'BASE', 1.0, 'Cash settlement bill 104'],
                ['2026-04-03', 'RCP-2003', 'Commercial Bank', 'Direct Scrap Sale Cash', 8200, 'BASE', 1.0, 'Direct yard scrap sales']
            ];
            ws = XLSX.utils.aoa_to_sheet(sampleData);
        } else {
            const sampleData = [
                ['AL SHAMS AL MUSHRIQAH METAL SCRAP TR'],
                ['SAJJA INDUSTRIAL AREA, SHARJAH'],
                ['Receipt Register'],
                ['1-Feb-2026 to 28-Feb-2026'],
                ['Date', 'Particulars', 'Party', 'Voucher Type', 'Voucher No.', 'Voucher Ref. No.', 'Voucher Ref. Date', 'Narration', 'Quantity', 'Rate', 'Value', 'Gross Total', 'Commercial Bank', 'Main Cash', 'RAK BANK'],
                ['01-02-2026', 'Global Metal Importers', '', 'Receipt', '2101', '', null, 'Customer advance', null, null, null, 15000, 15000, null, null],
                ['02-02-2026', 'Sunrise Trading FZE', '', 'Receipt', '2102', '', null, 'Cash collection', null, null, null, 3500, null, 3500, null]
            ];
            ws = XLSX.utils.aoa_to_sheet(sampleData);
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Receipt Template');
        XLSX.writeFile(wb, `AccPro_Receipt_Template_${type}.xlsx`);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#06181b] via-[#0b2830] to-[#06181b] text-white font-sans flex flex-col animate-in fade-in duration-300">
            {/* TOP HEADER */}
            <div className="h-16 bg-black/40 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-6 shrink-0 shadow-lg">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack || onClose}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-semibold group"
                        title="Back to Management Hub (Esc)"
                    >
                        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform text-teal-400" />
                        <span>Back</span>
                    </button>

                    <div className="h-6 w-px bg-white/10" />

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shadow-[0_0_20px_rgba(20,184,166,0.15)]">
                            <ArrowDownLeft size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-bold text-white tracking-tight leading-tight">
                                    IMP RECPT VCHR XLSX XML CSV
                                </h1>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                                    Universal Engine
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium leading-none mt-1">
                                Bulk Customer Inflows, Auto-Debiting Bank/Cash, Multi-Giver Voucher Consolidation
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {fileName && (
                        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-teal-400">
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
                                ? 'bg-white/10 text-white border-teal-500/50 shadow-md ring-1 ring-teal-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <UploadCloud size={16} className={activeTab === 'upload' ? 'text-teal-400' : 'text-slate-400'} />
                        <span>1. Upload Receipts</span>
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

                    {/* Tab 3: Ready to Import */}
                    <button
                        onClick={() => setActiveTab('ready')}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 relative ${
                            activeTab === 'ready'
                                ? 'bg-white/10 text-white border-teal-500/50 shadow-md ring-1 ring-teal-500/20'
                                : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                        }`}
                    >
                        <CheckCircle2 size={16} className={activeTab === 'ready' ? 'text-teal-400' : 'text-slate-400'} />
                        <span>3. Ready to Ingest</span>
                        {cleanRows.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/30 text-[10px] font-black">
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
                        <span>Receipt History & Rollback</span>
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
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-950/40 via-slate-900/60 to-teal-950/30 border border-teal-500/20 p-6 shadow-xl">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <Sparkles size={12} /> Inward Receipt Vouchers Pipeline (XLSX / XML / CSV)
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Upload Receipt Vouchers (Excel, XML, CSV)
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl">
                                    Drop your exported spreadsheet from Tally Prime (Receipt Register), Tally XML Data Interchange, or CSV file. Cashier receiving payments from multiple givers under the same voucher is automatically grouped and consolidated into multi-split vouchers!
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
                            className="border-2 border-dashed border-white/10 hover:border-teal-500/50 rounded-3xl p-12 bg-white/[0.02] hover:bg-white/[0.04] flex flex-col items-center justify-center text-center transition-all cursor-pointer group shadow-inner"
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

                            <div className="w-20 h-20 rounded-3xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-5 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(20,184,166,0.15)]">
                                {isParsing ? <RefreshCw className="animate-spin" size={36} /> : <ArrowDownLeft size={40} />}
                            </div>

                            <h3 className="text-lg font-bold text-white tracking-tight mb-2">
                                {isParsing ? 'Parsing Receipts & Running Validation Rules...' : 'Click to Browse or Drag & Drop File'}
                            </h3>
                            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
                                Supports <span className="text-teal-400 font-semibold">XLSX</span>, <span className="text-teal-400 font-semibold">XML (Tally Interchange)</span>, and <span className="text-teal-400 font-semibold">CSV</span> files. Automatically groups multiple givers sharing the same Voucher No!
                            </p>

                            <button
                                type="button"
                                className="px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-teal-500/20 transition-all flex items-center gap-2"
                            >
                                <FileSpreadsheet size={16} />
                                <span>Select Receipt File (XLSX, XML, CSV)</span>
                            </button>
                        </div>

                        {/* Quick Stats Grid If Loaded */}
                        {parsedData && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-300">
                                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-slate-400">Total Receipts Parsed</div>
                                        <div className="text-2xl font-black text-white">{parsedData.vouchers.length}</div>
                                    </div>
                                    <Layers className="text-blue-400" size={28} />
                                </div>
                                <div className="p-4 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-teal-400">Ready for Ingestion</div>
                                        <div className="text-2xl font-black text-teal-400">{cleanRows.length}</div>
                                    </div>
                                    <CheckCircle2 className="text-teal-400" size={28} />
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
                    TAB 2: SOLUTION CENTRE (RECEIPTS)
                   ======================================================== */}
                {activeTab === 'solution_centre' && (
                    <div className="max-w-6xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-amber-950/30 border border-amber-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <AlertTriangle size={12} /> Receipt Discrepancy Quarantine
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Receipt Solution Centre: {quarantinedRows.length} Items Requiring Attention
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Resolve missing customers, duplicate receipt numbers, or fuzzy matches. Once resolved, the badge turns green and moves to the Ingestion Queue.
                                </p>
                            </div>

                            {/* Issue Filter Pills */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {[
                                    { id: 'ALL', label: 'All Issues' },
                                    { id: 'MISSING_MASTERS', label: 'Missing Customers' },
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
                                <CheckCircle2 size={48} className="text-teal-400 mb-3" />
                                <h3 className="text-base font-bold text-white">All Receipt Discrepancies Resolved!</h3>
                                <p className="text-xs text-slate-400 max-w-md mt-1 mb-4">
                                    There are no pending quarantined receipt transactions under this filter.
                                </p>
                                <button
                                    onClick={() => setActiveTab('ready')}
                                    className="px-5 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold flex items-center gap-2"
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
                                                    ? 'bg-teal-950/20 border-teal-500/40 ring-1 ring-teal-500/20'
                                                    : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                                                        isResolved
                                                            ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
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
                                                                    Multi-Giver ({row.splits?.length || 2} Parties)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm font-bold text-white mt-0.5">
                                                            Received From: <span className="text-teal-400">{row.paidTo || 'N/A'}</span>
                                                            {row.paidFrom && (
                                                                <span className="text-slate-400 font-normal"> · Into: <b className="text-slate-200">{row.paidFrom}</b></span>
                                                            )}
                                                        </div>
                                                        {row.isMultiSplit && row.splits && row.splits.length > 1 && (
                                                            <div className="mt-2 p-2 rounded-lg bg-black/30 border border-white/5 space-y-1">
                                                                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Givers Breakdown:</div>
                                                                {row.splits.map((s, sIdx) => (
                                                                    <div key={sIdx} className="flex items-center justify-between text-xs text-slate-300 font-mono">
                                                                        <span>· {s.targetName}</span>
                                                                        <span className="font-bold text-teal-400">{currencySymbol} {s.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                                    </div>
                                                                ))}
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
                                                            {row.currency} @ {row.exchangeRate}
                                                        </div>
                                                    </div>

                                                    {isResolved ? (
                                                        <button
                                                            onClick={() => handleInsertResolvedTransaction(row.id)}
                                                            className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-teal-500/20 animate-in zoom-in-95"
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
                                                                    <span>Create Missing Customer?</span>
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
                                                                    <span>Auto-Renumber (-RCP-IMP)</span>
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
                    TAB 3: READY TO IMPORT (RECEIPTS)
                   ======================================================== */}
                {activeTab === 'ready' && (
                    <div className="max-w-6xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-teal-950/40 via-slate-900/60 to-teal-950/30 border border-teal-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <CheckCircle2 size={12} /> Ready for Inward Ledger Update
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Ready to Ingest: {cleanRows.length} Receipt Vouchers
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Total Collection: <b className="text-teal-400 font-mono text-sm">{currencySymbol} {cleanRows.reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>. Automatically increases cash/bank & reduces customer balances.
                                </p>
                            </div>

                            <button
                                disabled={cleanRows.length === 0 || isImporting}
                                onClick={handleExecuteImport}
                                className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-xl transition-all ${
                                    cleanRows.length > 0 && !isImporting
                                        ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-teal-500/20 hover:scale-105 active:scale-95'
                                        : 'bg-white/10 text-slate-500 border border-white/5 cursor-not-allowed'
                                }`}
                            >
                                {isImporting ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={16} />
                                        <span>Importing Receipts ({importProgress}%)...</span>
                                    </>
                                ) : (
                                    <>
                                        <Database size={16} />
                                        <span>Execute Batch Receipt Ingestion ({cleanRows.length} Vouchers)</span>
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
                                    placeholder="Search by Voucher No or Customer..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500/50"
                                />
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                                Showing {cleanRows.length} receipt rows
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
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Received In (Debit Bank/Cash)</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Received From (Credit Customer)</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px]">Narration</th>
                                            <th className="py-3 px-4 font-bold uppercase text-[10px] text-right">Amount ({currencySymbol})</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-slate-300 font-medium">
                                        {cleanRows
                                            .filter(r => {
                                                if (!searchQuery) return true;
                                                const q = searchQuery.toLowerCase();
                                                return r.vchNo.toLowerCase().includes(q) || r.paidTo.toLowerCase().includes(q);
                                            })
                                            .map((row, idx) => (
                                                <tr key={row.id || idx} className="hover:bg-white/[0.03] transition-colors">
                                                    <td className="py-2.5 px-4 text-slate-500 font-mono">{idx + 1}</td>
                                                    <td className="py-2.5 px-4 font-mono text-slate-300">{row.date}</td>
                                                    <td className="py-2.5 px-4 font-mono font-bold text-teal-400">
                                                        <div className="flex items-center gap-1.5">
                                                            <span>{row.vchNo}</span>
                                                            {row.isMultiSplit && (
                                                                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[9px] font-bold border border-purple-500/30">
                                                                    MULTI
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-4 text-slate-200">{row.paidFrom || 'Main Cash'}</td>
                                                    <td className="py-2.5 px-4 font-bold text-white">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate max-w-[200px]">{row.paidTo}</span>
                                                            {row.isMultiSplit && (
                                                                <span className="shrink-0 px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                                                                    {row.splits?.length || 2} Givers
                                                                </span>
                                                            )}
                                                        </div>
                                                        {row.isMultiSplit && row.splits && row.splits.length > 1 && (
                                                            <div className="text-[10px] text-slate-400 font-normal mt-1 space-y-0.5 bg-black/20 p-1.5 rounded-lg border border-white/5">
                                                                {row.splits.map((s, si) => (
                                                                    <div key={si} className="flex items-center justify-between text-slate-300">
                                                                        <span className="truncate max-w-[150px] text-slate-400">· {s.targetName}</span>
                                                                        <span className="font-mono font-semibold text-teal-400">{currencySymbol} {s.amount?.toLocaleString()}</span>
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
                    TAB 4: IMPORT HISTORY & BATCH ROLLBACK (RECEIPTS)
                   ======================================================== */}
                {activeTab === 'history' && (
                    <div className="max-w-5xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-blue-950/30 border border-blue-500/30 shadow-xl">
                            <div>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                    <History size={12} /> Receipt Audit Trail
                                </div>
                                <h2 className="text-xl font-bold text-white tracking-tight">
                                    Receipt Import History & Rollback Centre
                                </h2>
                                <p className="text-xs text-slate-400 max-w-xl mt-1">
                                    Inspect past receipt import sessions or rollback an entire batch in 1 click.
                                </p>
                            </div>
                        </div>

                        {historyList.length === 0 ? (
                            <div className="p-16 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-center">
                                <Clock size={48} className="text-blue-400/40 mb-3" />
                                <h3 className="text-base font-bold text-white">No Receipt Batch Imports Yet</h3>
                                <p className="text-xs text-slate-400 max-w-md mt-1">
                                    Completed receipt imports will be recorded here with complete rollback protection.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {historyList.map((batch) => {
                                    const isRolledBack = batch.status === 'ROLLED_BACK';
                                    return (
                                        <div
                                            key={batch.batchImportId}
                                            className={`p-5 rounded-2xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                                                isRolledBack
                                                    ? 'bg-rose-950/10 border-rose-500/20 opacity-70'
                                                    : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                                            }`}
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs font-black text-white">{batch.batchImportId}</span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                                                        isRolledBack
                                                            ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                                                            : 'bg-teal-500/20 text-teal-400 border-teal-500/30'
                                                    }`}>
                                                        {batch.status}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-400">
                                                    Imported by <b className="text-slate-200">{batch.user}</b> on{' '}
                                                    <span className="font-mono">{new Date(batch.timestamp).toLocaleString()}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <div className="text-sm font-bold text-white">
                                                        {batch.count} Receipts
                                                    </div>
                                                    <div className="text-xs font-mono text-teal-400 font-bold">
                                                        {currencySymbol} {batch.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </div>
                                                </div>

                                                {!isRolledBack && (
                                                    <button
                                                        disabled={rollbackingId === batch.batchImportId}
                                                        onClick={() => handleRollbackBatch(batch.batchImportId)}
                                                        className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:border-rose-500/50 text-xs font-bold transition-all flex items-center gap-1.5"
                                                    >
                                                        {rollbackingId === batch.batchImportId ? (
                                                            <RefreshCw className="animate-spin" size={14} />
                                                        ) : (
                                                            <RotateCcw size={14} />
                                                        )}
                                                        <span>Rollback Batch</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ========================================================
                    TAB 5: INSTRUCTIONS & TEMPLATES
                   ======================================================== */}
                {activeTab === 'instructions' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900/60 to-purple-950/30 border border-purple-500/30 shadow-xl">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                <FileText size={12} /> Receipt Specifications
                            </div>
                            <h2 className="text-xl font-bold text-white tracking-tight">
                                Receipt Excel Format Guidelines & Sample Templates
                            </h2>
                            <p className="text-xs text-slate-400 max-w-xl mt-1">
                                Download sample templates configured for customer receipts and inward cash/bank settlement.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                                <div className="flex items-center gap-2 font-bold text-white text-sm">
                                    <FileSpreadsheet className="text-teal-400" size={18} />
                                    <span>Standard Receipt Template</span>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    Date, Voucher No, Received In (Bank/Cash), Received From (Customer), Amount, and Narration.
                                </p>
                                <button
                                    onClick={() => handleDownloadTemplate('standard')}
                                    className="px-4 py-2 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 font-bold text-xs flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    <span>Download Standard (.xlsx)</span>
                                </button>
                            </div>

                            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
                                <div className="flex items-center gap-2 font-bold text-white text-sm">
                                    <FileSpreadsheet className="text-blue-400" size={18} />
                                    <span>Tally Prime Receipt Format</span>
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    Formatted to match Tally Prime's Receipt Register export with bank and customer columns.
                                </p>
                                <button
                                    onClick={() => handleDownloadTemplate('tally')}
                                    className="px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold text-xs flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    <span>Download Tally Format (.xlsx)</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================================
                RULE 2: CREATE MISSING CUSTOMER MODAL
               ======================================================== */}
            {createMasterModal.isOpen && (
                <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0b2830] border border-white/20 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between pb-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                                    <Plus size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white">Create Missing Master Record</h3>
                                    <p className="text-[10px] text-slate-400">Rule 2: Customer / Income Generation</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', partyRole: 'customer', isSubmitting: false })}
                                className="text-slate-400 hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-300 block mb-1">Customer / Entity Name</label>
                                <input
                                    type="text"
                                    value={createMasterModal.name}
                                    onChange={(e) => setCreateMasterModal(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-bold focus:outline-none focus:border-teal-500"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-300 block mb-1">Entity Classification</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'party', label: 'Customer / Debtor' },
                                        { id: 'account', label: 'Cash / Bank' },
                                        { id: 'income', label: 'Income Head' }
                                    ].map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setCreateMasterModal(prev => ({ ...prev, type: t.id }))}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all text-center ${
                                                createMasterModal.type === t.id
                                                    ? 'bg-teal-500 text-slate-950 border-teal-500'
                                                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                                            }`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                            <button
                                type="button"
                                onClick={() => setCreateMasterModal({ isOpen: false, rowId: null, name: '', type: 'party', partyRole: 'customer', isSubmitting: false })}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={createMasterModal.isSubmitting}
                                onClick={handleConfirmCreateMaster}
                                className="px-5 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-teal-500/20"
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

            {/* SUBTLE FOOTER */}
            <div className="h-10 bg-black/40 border-t border-white/5 px-6 flex items-center justify-between text-[10px] text-slate-500 font-medium shrink-0">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                    <span>AccPro Enterprise Ingestion Pipeline · Receipts Engine Active</span>
                </div>
                <div>Batch Engine v2.7.1</div>
            </div>
        </div>
    );
}
