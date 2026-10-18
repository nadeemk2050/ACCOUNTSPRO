import React, { useState } from 'react';
import {
    X, ArrowLeft, UploadCloud, FileText, RefreshCw, CheckCircle2, Boxes,
    Users, Sparkles, ShieldCheck, Clock, AlertTriangle
} from 'lucide-react';
import {
    parseLedgerMastersXml,
    parseStockMastersXml,
    bulkImportMasters,
    readXmlFileText
} from './utils/excelImportEngine';

const COLLECTION_LABEL = {
    parties: 'Parties (Customer / Supplier)',
    accounts: 'Cash & Bank Accounts',
    expenses: 'Expenses',
    direct_expenses: 'Direct Expenses',
    income_accounts: 'Income Accounts',
    capital_accounts: 'Capital Accounts',
    asset_accounts: 'Fixed Assets',
    products: 'Stock Items'
};

/**
 * Tally master importer — "Masters of Accounts" (ledgers) and "Masters of Stock" (stock items).
 */
export default function ImportMastersXmlModal({
    isOpen,
    onClose,
    onBack,
    mode = 'accounts', // 'accounts' | 'stock'
    user,
    dataOwnerId,
    effectiveName = 'Admin',
    showToast
}) {
    const isStock = mode === 'stock';
    const [fileName, setFileName] = useState('');
    const [isParsing, setIsParsing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [parsed, setParsed] = useState(null);
    const [result, setResult] = useState(null);
    const [search, setSearch] = useState('');

    const handleFile = async (file) => {
        if (!file) return;
        if (!(file.name || '').toLowerCase().endsWith('.xml')) {
            alert('This section imports Tally XML only. Use the Backup / Restore tools for spreadsheets.');
            return;
        }
        setFileName(file.name);
        setIsParsing(true);
        setResult(null);
        setParsed(null);
        try {
            const text = await readXmlFileText(file);
            const p = isStock ? parseStockMastersXml(text) : parseLedgerMastersXml(text);
            setParsed(p);
            if (showToast) {
                showToast({
                    type: 'success',
                    title: 'Masters Detected',
                    message: `${p.total} master record(s) found in ${file.name}.`
                });
            }
        } catch (err) {
            console.error('[MastersImport] Parse error:', err);
            alert(`Failed to read the XML: ${err.message}`);
        } finally {
            setIsParsing(false);
        }
    };

    const handleImport = async () => {
        if (!parsed) return;
        setIsImporting(true);
        setResult(null);
        try {
            const res = await bulkImportMasters(parsed.masters, { user, dataOwnerId, effectiveName });
            setResult(res);
            if (showToast) {
                showToast({
                    type: res.totalCreated > 0 ? 'success' : 'info',
                    title: 'Masters Imported',
                    message: `${res.totalCreated} created · ${res.totalSkipped} already existed.`
                });
            }
        } catch (err) {
            console.error('[MastersImport] Error:', err);
            alert(`Master import failed: ${err.message}`);
        } finally {
            setIsImporting(false);
        }
    };

    if (!isOpen) return null;

    const rows = (parsed?.masters || []).filter(m =>
        !search || `${m.name} ${m.parent || m.group || ''}`.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 300);

    return (
        <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#090d16] via-[#0f172a] to-[#090d16] text-white font-sans flex flex-col">
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
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isStock ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-300' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'}`}>
                            {isStock ? <Boxes size={22} /> : <Users size={22} />}
                        </div>
                        <div>
                            <h1 className="text-base font-bold tracking-tight">
                                {isStock ? 'IMPORT MASTERS OF STOCK FROM XML' : 'IMPORT MASTERS OF ACCOUNTS FROM XML'}
                            </h1>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {isStock
                                    ? 'Creates stock items with group, unit and opening quantity'
                                    : 'Creates customers, suppliers, bank/cash, expense, income and capital ledgers'}
                            </p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-white">
                    <X size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                <div className="rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-emerald-950/30 border border-emerald-500/20 p-6">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-black uppercase tracking-wider mb-2">
                        <Sparkles size={12} /> Tally Master Sync
                    </div>
                    <h2 className="text-xl font-bold tracking-tight">
                        {isStock ? 'Bring your Tally stock items into AccPro' : 'Bring your Tally ledgers into AccPro'}
                    </h2>
                    <p className="text-xs text-slate-400 max-w-2xl mt-1">
                        {isStock
                            ? 'Reads every <STOCKITEM> master: name, stock group, base unit and opening quantity / rate / value. Existing items are skipped (name match ignores case and spaces).'
                            : 'Reads every <LEDGER> master and maps its Tally group to the right AccPro master — Sundry Debtors → Customers, Sundry Creditors → Suppliers, Bank / Cash → Accounts, Direct/Indirect Expenses → Expenses, Sales Accounts → Income, Capital → Capital, Fixed Assets → Assets. Existing names are skipped.'}
                    </p>
                </div>

                <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }}
                    className="border-2 border-dashed border-white/10 hover:border-emerald-500/50 rounded-3xl p-10 bg-white/[0.02] flex flex-col items-center text-center transition-all cursor-pointer"
                    onClick={() => document.getElementById('masters-file-input')?.click()}
                >
                    <input
                        id="masters-file-input"
                        type="file"
                        accept=".xml"
                        className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                    />
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-300 mb-4">
                        {isParsing ? <RefreshCw className="animate-spin" size={28} /> : <UploadCloud size={32} />}
                    </div>
                    <h3 className="text-base font-bold mb-1">
                        {isParsing ? 'Reading masters…' : 'Click to browse or drop the Tally XML'}
                    </h3>
                    <p className="text-xs text-slate-400">Masters export or full Day Book export — both work · .xml only</p>
                    {fileName && (
                        <div className="mt-4 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-emerald-300 flex items-center gap-2">
                            <FileText size={12} /> {fileName}
                        </div>
                    )}
                </div>

                {parsed && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-bold">
                                <CheckCircle2 size={16} className="text-emerald-400" />
                                {parsed.total} master record(s) found
                            </div>
                            <button
                                onClick={handleImport}
                                disabled={isImporting}
                                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-2"
                            >
                                {isImporting ? <RefreshCw className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                                {isImporting ? 'Importing…' : `Import ${parsed.total} Master(s)`}
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {Object.entries(parsed.counts || {}).map(([coll, n]) => (
                                <span key={coll} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-bold text-slate-300">
                                    {COLLECTION_LABEL[coll] || coll}: <b className="text-emerald-300">{n}</b>
                                </span>
                            ))}
                        </div>

                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name or group…"
                            className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />

                        <div className="max-h-[380px] overflow-y-auto rounded-xl border border-white/10">
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-900 text-slate-400 uppercase text-[10px]">
                                    <tr>
                                        <th className="py-2 px-3">Name</th>
                                        <th className="py-2 px-3">{isStock ? 'Group' : 'Tally Group'}</th>
                                        <th className="py-2 px-3">{isStock ? 'Unit / Opening' : 'Maps To'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {rows.map((m, i) => (
                                        <tr key={`${m.name}-${i}`} className="hover:bg-white/[0.03]">
                                            <td className="py-1.5 px-3 font-semibold text-white">{m.name}</td>
                                            <td className="py-1.5 px-3 text-slate-400">{m.parent || m.group}</td>
                                            <td className="py-1.5 px-3 text-slate-300">
                                                {isStock
                                                    ? `${m.unit || '—'} · ${m.openingQty || 0}`
                                                    : (COLLECTION_LABEL[m.collection] || m.collection)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {parsed.total > 300 && (
                            <p className="text-[11px] text-slate-500">Preview limited to the first 300 rows — all {parsed.total} will be imported.</p>
                        )}
                    </div>
                )}

                {result && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                            <CheckCircle2 size={16} /> Import complete — {result.totalCreated} created, {result.totalSkipped} already existed
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(result.summary || {}).map(([coll, s]) => (
                                <span key={coll} className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10 text-[11px] text-slate-300">
                                    {COLLECTION_LABEL[coll] || coll}: <b className="text-emerald-300">{s.created}</b> created · {s.skipped} skipped
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="text-[11px] text-slate-500 flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-0.5 text-amber-400 shrink-0" />
                    Duplicate protection: names are compared ignoring capitals, spaces and punctuation, so re-importing the same export will not create duplicates.
                </div>
            </div>

            <div className="h-10 bg-black/40 border-t border-white/5 px-6 flex items-center justify-between text-[10px] text-slate-500">
                <div className="flex items-center gap-2">
                    <Clock size={11} />
                    <span>Tally Master Import · deduplicated</span>
                </div>
                <div>Batch Engine v2.7.1</div>
            </div>
        </div>
    );
}
