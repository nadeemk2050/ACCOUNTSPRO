import React, { useState, useEffect } from 'react';
import {
    X, ArrowLeft, FileSpreadsheet, UploadCloud, History,
    FileText, Sparkles, Download, Clock, CheckCircle2,
    AlertCircle, Layers, ArrowRight, ShieldCheck
} from 'lucide-react';

export default function ImportPaymentExcelModal({
    isOpen,
    onClose,
    onBack,
    user,
    dataOwnerId,
    companyProfile
}) {
    const [activeTab, setActiveTab] = useState('import');

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (onBack) onBack();
                else onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onBack]);

    if (!isOpen) return null;

    const tabs = [
        {
            id: 'import',
            label: 'Start New Import',
            badge: 'Coming Soon',
            badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            icon: UploadCloud,
            desc: 'Upload & ingest Payment vouchers from Excel or Tally'
        },
        {
            id: 'history',
            label: 'Show Import History',
            badge: 'Coming Soon',
            badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            icon: History,
            desc: 'Audit logs of past imports, batches and voucher counts'
        },
        {
            id: 'instructions',
            label: 'Import Excel Instructions and Template',
            badge: 'Coming Soon',
            badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
            icon: FileText,
            desc: 'Formatting guidelines, column specifications & sample download'
        }
    ];

    return (
        <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#0b1324] via-[#111e38] to-[#0b1324] text-white font-sans flex flex-col animate-in fade-in duration-300">
            {/* TOP HEADER */}
            <div className="h-16 bg-black/40 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-6 shrink-0 shadow-lg">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack || onClose}
                        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-semibold group"
                        title="Back to Management Hub (Esc)"
                    >
                        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform text-emerald-400" />
                        <span>Back</span>
                    </button>

                    <div className="h-6 w-px bg-white/10" />

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                            <FileSpreadsheet size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-bold text-white tracking-tight leading-tight">
                                    Import Payment Voucher from Excel
                                </h1>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    Tally & Excel Engine
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium leading-none mt-1">
                                Bulk ingestion of payment vouchers with intelligent ledger auto-mapping
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-[11px] text-slate-400 hidden md:flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Press <kbd className="px-1.5 py-0.5 bg-black/40 border border-white/10 rounded font-mono text-[10px] text-slate-300">Esc</kbd> to exit</span>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 border border-white/10 text-slate-400 hover:border-rose-500/30 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* TAB NAVIGATION BAR */}
            <div className="bg-black/20 border-b border-white/5 px-6 py-2 shrink-0 backdrop-blur-sm">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                                    isActive
                                        ? 'bg-white/10 text-white border-emerald-500/50 shadow-md ring-1 ring-emerald-500/20'
                                        : 'bg-white/[0.02] text-slate-400 hover:text-slate-200 border-white/5 hover:bg-white/[0.05]'
                                }`}
                            >
                                <Icon size={16} className={isActive ? 'text-emerald-400' : 'text-slate-400'} />
                                <span>{tab.label}</span>
                                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${tab.badgeColor}`}>
                                    {tab.badge}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col justify-start">
                {/* TAB 1: START NEW IMPORT */}
                {activeTab === 'import' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header Banner */}
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-emerald-950/30 border border-emerald-500/20 p-6 shadow-xl">
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                        <Sparkles size={12} /> Step 1: Upload & Auto-Detect
                                    </div>
                                    <h2 className="text-xl font-bold text-white tracking-tight">
                                        Start New Payment Voucher Import
                                    </h2>
                                    <p className="text-xs text-slate-400 max-w-xl">
                                        Upload your exported Excel file from Tally 9, TallyPrime, or custom accounting sheet. Our importer will automatically match ledgers and preview before writing.
                                    </p>
                                </div>
                                <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-black uppercase tracking-widest self-start md:self-center">
                                    Coming Soon
                                </span>
                            </div>
                        </div>

                        {/* Upload Dropzone Preview (Wireframe / Coming Soon) */}
                        <div className="border-2 border-dashed border-white/10 hover:border-emerald-500/40 rounded-3xl p-12 bg-white/[0.02] flex flex-col items-center justify-center text-center transition-all group">
                            <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-5 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                                <UploadCloud size={40} />
                            </div>

                            <h3 className="text-lg font-bold text-white tracking-tight mb-2">
                                Drag & Drop your Excel file here
                            </h3>
                            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
                                Supports <span className="text-emerald-400 font-semibold">.xlsx</span>, <span className="text-emerald-400 font-semibold">.xls</span>, and <span className="text-emerald-400 font-semibold">.csv</span> formats from Tally 9 & TallyPrime exports.
                            </p>

                            <button
                                disabled
                                className="px-6 py-3 rounded-xl bg-white/10 border border-white/10 text-slate-400 font-bold text-xs uppercase tracking-wider cursor-not-allowed flex items-center gap-2"
                            >
                                <FileSpreadsheet size={16} />
                                <span>Browse File (Awaiting Excel Format Alignment)</span>
                            </button>
                        </div>

                        {/* Feature Highlights Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                                    <CheckCircle2 size={16} />
                                    <span>Tally 9 & Prime Ready</span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    Handles Tally Daybook or Voucher Register exports with automatic Dr/Cr column detection.
                                </p>
                            </div>

                            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                                <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold">
                                    <ShieldCheck size={16} />
                                    <span>Zero-Risk Preview</span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    Full interactive verification grid before saving — highlights duplicate Ref Nos & unmatched ledgers.
                                </p>
                            </div>

                            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                                    <Sparkles size={16} />
                                    <span>Auto-Balance Updates</span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    Automatically credits Bank/Cash and debits Party/Expense ledgers with complete audit trail stamps.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: SHOW IMPORT HISTORY */}
                {activeTab === 'history' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-blue-950/30 border border-blue-500/20 p-6 shadow-xl">
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                        <History size={12} /> Audit & Traceability
                                    </div>
                                    <h2 className="text-xl font-bold text-white tracking-tight">
                                        Excel Import Activity Log
                                    </h2>
                                    <p className="text-xs text-slate-400 max-w-xl">
                                        Track all past Excel voucher import sessions, total records ingested, skipped duplicates, and timestamps.
                                    </p>
                                </div>
                                <span className="px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-black uppercase tracking-widest self-start md:self-center">
                                    Coming Soon
                                </span>
                            </div>
                        </div>

                        {/* Empty State / Coming Soon Wireframe */}
                        <div className="p-16 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-center">
                            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
                                <Clock size={32} />
                            </div>
                            <h3 className="text-base font-bold text-white mb-1">No Past Import Sessions Yet</h3>
                            <p className="text-xs text-slate-400 max-w-md">
                                Once you run your first Payment voucher import from Excel, all batch entries, file names, and row summaries will be archived here.
                            </p>
                        </div>
                    </div>
                )}

                {/* TAB 3: INSTRUCTIONS & TEMPLATE */}
                {activeTab === 'instructions' && (
                    <div className="max-w-4xl mx-auto w-full space-y-6 animate-in fade-in zoom-in-95 duration-200">
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-amber-950/30 border border-amber-500/20 p-6 shadow-xl">
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2">
                                        <FileText size={12} /> Format Guidelines & Sample
                                    </div>
                                    <h2 className="text-xl font-bold text-white tracking-tight">
                                        Excel Format Guidelines & Sample Template
                                    </h2>
                                    <p className="text-xs text-slate-400 max-w-xl">
                                        Review the column requirements for Payment vouchers and download pre-configured Excel templates.
                                    </p>
                                </div>
                                <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-widest self-start md:self-center">
                                    Coming Soon
                                </span>
                            </div>
                        </div>

                        {/* Requirements Card */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 space-y-4">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Layers size={16} className="text-amber-400" />
                                <span>Core Fields Required for Payment Vouchers</span>
                            </h3>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/10 text-slate-400">
                                            <th className="py-2.5 px-3 font-bold uppercase text-[10px]">Field</th>
                                            <th className="py-2.5 px-3 font-bold uppercase text-[10px]">Description</th>
                                            <th className="py-2.5 px-3 font-bold uppercase text-[10px]">Tally Equivalent</th>
                                            <th className="py-2.5 px-3 font-bold uppercase text-[10px]">Example</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-slate-300">
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Date</td>
                                            <td className="py-2.5 px-3">Transaction Date</td>
                                            <td className="py-2.5 px-3 text-slate-400">Date</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">2026-04-01 / 01-04-2026</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Voucher No</td>
                                            <td className="py-2.5 px-3">Voucher or Reference No</td>
                                            <td className="py-2.5 px-3 text-slate-400">Vch No.</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">PAY-1001 / 1024</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Paid From</td>
                                            <td className="py-2.5 px-3">Bank or Cash Account (Credit)</td>
                                            <td className="py-2.5 px-3 text-slate-400">Account (Bank/Cash)</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">Main Cash / Commercial Bank</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Paid To</td>
                                            <td className="py-2.5 px-3">Vendor / Party / Expense Ledger (Debit)</td>
                                            <td className="py-2.5 px-3 text-slate-400">Particulars (Debit Ledger)</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">Al Falah Trading / Office Rent</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Amount</td>
                                            <td className="py-2.5 px-3">Payment amount</td>
                                            <td className="py-2.5 px-3 text-slate-400">Debit / Amount</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">5000.00</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2.5 px-3 font-semibold text-white">Narration</td>
                                            <td className="py-2.5 px-3">Remarks or bill reference</td>
                                            <td className="py-2.5 px-3 text-slate-400">Narration</td>
                                            <td className="py-2.5 px-3 font-mono text-emerald-400">Payment against Inv 402</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="pt-4 flex items-center justify-between border-t border-white/5">
                                <p className="text-[11px] text-slate-400">
                                    Sample Excel templates (.xlsx) for Tally 9 & TallyPrime will be available for download here.
                                </p>
                                <button
                                    disabled
                                    className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 font-bold text-xs uppercase tracking-wider cursor-not-allowed flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    <span>Download Template (Coming Soon)</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* SUBTLE FOOTER */}
            <div className="h-10 bg-black/40 border-t border-white/5 px-6 flex items-center justify-between text-[10px] text-slate-500 font-medium shrink-0">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>ACCPRO Data Ingestion Engine · Module: Payments</span>
                </div>
                <div>Pro Edition 2026</div>
            </div>
        </div>
    );
}
