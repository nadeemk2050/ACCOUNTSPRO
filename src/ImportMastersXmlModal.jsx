import React, { useState } from 'react';
import {
    X, ArrowLeft, UploadCloud, FileText, RefreshCw, CheckCircle2, Boxes,
    Users, Sparkles, ShieldCheck, Clock, AlertTriangle
} from 'lucide-react';
import {
    parseLedgerMastersXml,
    parseStockMastersXml,
    bulkImportMasters,
    rollbackBatchImport,
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
    products: 'Stock Items',
    party_groups: 'Customer / Supplier Groups',
    expense_groups: 'Expense Groups',
    stock_groups: 'Stock Groups',
    units: 'Units of Measure'
};

/**
 * Tally master importer — "Masters of Accounts" (ledgers) and "Masters of Stock" (stock items).
 */
/**
 * Step-by-step Tally ERP 9 / Prime export guide.
 * Written from real 6.5.x menu labels; alternatives given where Tally builds differ.
 */
function TallyExportGuide({ isStock }) {
    const step = (n, text) => (
        <li key={n} className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black flex items-center justify-center">{n}</span>
            <span>{text}</span>
        </li>
    );

    return (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 md:p-6 space-y-5 text-xs text-slate-300">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
                <FileText size={16} className="text-emerald-400" />
                How to export this file from Tally
            </div>

            {/* STOCK */}
            <div className={`rounded-xl border p-4 space-y-2 ${isStock ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="font-black text-cyan-300 uppercase tracking-wider text-[11px]">A · Stock Masters (items + groups + units)</div>
                <ol className="space-y-1.5 list-none">
                    {step(1, <>Gateway of Tally → <b className="text-white">Display More Reports</b> → <b className="text-white">List of Accounts</b>.</>)}
                    {step(2, <>Open the <b className="text-white">Items</b> tab (List of Stock Items). If your build shows it separately: <b className="text-white">Display More Reports → Statements of Inventory → List of Stock Items</b>.</>)}
                    {step(3, <>Press <b className="text-white">E: Export</b> (or <b className="text-white">Ctrl + E</b>).</>)}
                    {step(4, <>Format → <b className="text-amber-300">XML (Data Interchange)</b>. Never choose Excel / ASCII — this importer reads XML only.</>)}
                    {step(5, <>Type of Masters → <b className="text-white">Stock Items</b> (use <b className="text-white">All Inventory Masters</b> to get stock groups + units in the same file).</>)}
                    {step(6, <>Include dependent masters → <b className="text-emerald-300">Yes</b> — required, otherwise the groups/units are missing and items land under “Primary”.</>)}
                    {step(7, <>Language → <b className="text-white">Default (All Languages)</b>.</>)}
                    {step(8, <>Export Location → <b className="text-white">Desktop</b> or <b className="text-white">Documents</b> (avoid Program Files — Windows may block the write). Output file name e.g. <span className="font-mono text-cyan-300">stock_master.xml</span>.</>)}
                    {step(9, <>Press <b className="text-white">Enter</b> on “Open Exported Folder” only after the export finishes, then upload that file in <b>Import Masters of Stock from XML</b>.</>)}
                </ol>
            </div>

            {/* ACCOUNTS */}
            <div className={`rounded-xl border p-4 space-y-2 ${!isStock ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="font-black text-emerald-300 uppercase tracking-wider text-[11px]">B · Accounts / Ledger Masters (groups + ledgers)</div>
                <ol className="space-y-1.5 list-none">
                    {step(1, <>Same screen → <b className="text-white">Ledgers</b> list (from List of Accounts).</>)}
                    {step(2, <>Press <b className="text-white">E: Export</b> → Format <b className="text-amber-300">XML (Data Interchange)</b>.</>)}
                    {step(3, <>Type of Masters → <b className="text-white">Ledgers</b> · Include dependent masters → <b className="text-emerald-300">Yes</b> (this is what brings the <span className="font-mono">&lt;GROUP&gt;</span> records so ledgers file under the right group).</>)}
                    {step(4, <>Output file name e.g. <span className="font-mono text-emerald-300">account_master.xml</span> → upload in <b>Import Masters of Accounts from XML</b>.</>)}
                </ol>
            </div>

            {/* ALL MASTERS */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-2">
                <div className="font-black text-purple-300 uppercase tracking-wider text-[11px]">C · Everything in one file (recommended)</div>
                <p>Type of Masters → <b className="text-white">All Masters</b> · Include dependent masters → <b className="text-emerald-300">Yes</b>. One file (e.g. <span className="font-mono">Master.xml</span>) works in <b>both</b> the Accounts and the Stock importer.</p>
            </div>

            {/* SETTINGS TABLE */}
            <div className="space-y-2">
                <div className="font-black text-white uppercase tracking-wider text-[11px]">Settings that actually matter</div>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full text-left text-[11px]">
                        <thead className="bg-white/5 text-slate-400 uppercase text-[10px]">
                            <tr>
                                <th className="py-2 px-3">Option</th>
                                <th className="py-2 px-3">Must be</th>
                                <th className="py-2 px-3">Why</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            <tr><td className="py-1.5 px-3">Format</td><td className="py-1.5 px-3 text-amber-300 font-bold">XML (Data Interchange)</td><td className="py-1.5 px-3 text-slate-400">Excel/ASCII exports cannot be read.</td></tr>
                            <tr><td className="py-1.5 px-3">Include dependent masters</td><td className="py-1.5 px-3 text-emerald-300 font-bold">Yes</td><td className="py-1.5 px-3 text-slate-400">Adds the &lt;GROUP&gt; / &lt;STOCKGROUP&gt; / &lt;UNIT&gt; records.</td></tr>
                            <tr><td className="py-1.5 px-3">Export Closing Balances as Opening</td><td className="py-1.5 px-3 text-emerald-300 font-bold">No</td><td className="py-1.5 px-3 text-slate-400">Yes doubles your opening stock/balances.</td></tr>
                            <tr><td className="py-1.5 px-3">Language</td><td className="py-1.5 px-3 text-slate-200">Default (All Languages)</td><td className="py-1.5 px-3 text-slate-400">Avoids translated field names.</td></tr>
                            <tr><td className="py-1.5 px-3">Export Location</td><td className="py-1.5 px-3 text-slate-200">Desktop / Documents</td><td className="py-1.5 px-3 text-slate-400">Program Files needs admin rights.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* VERIFY block removed per user request to keep the guide short and clear */}

            <div className="text-[11px] text-slate-500">
                Tip: the period selected on the report does not limit masters — but always export <b className="text-slate-300">all</b> items/ledgers, not a filtered/grouped view, otherwise only the visible rows are written.
            </div>
        </div>
    );
}

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
    const [showHelp, setShowHelp] = useState(false);

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

    const handleRollback = async () => {
        if (!result?.batchImportId) return;
        if (!confirm('Undo this masters import? Every master created by this batch will be deleted.')) return;
        try {
            const res = await rollbackBatchImport(result.batchImportId, { user, dataOwnerId, effectiveName });
            setResult(null);
            setParsed(null);
            if (showToast) showToast({ type: 'success', title: 'Import Undone', message: `${res.deletedCount} master(s) removed.` });
        } catch (err) {
            alert(`Undo failed: ${err.message}`);
        }
    };

    if (!isOpen) return null;

    const rows = (parsed?.masters || []).filter(m =>
        !search || `${m.name} ${m.parent || m.group || ''}`.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 300);

    const groupCount = (parsed?.masters || []).filter(m => String(m.kind || '').endsWith('_group')).length;
    const entryCount = (parsed?.masters || []).length - groupCount;

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
                            ? 'Reads every <STOCKGROUP> and <STOCKITEM> master: groups are created first (with their parent), then each item with its group, base unit and opening quantity / rate / value. Existing names are skipped (match ignores case and spaces).'
                            : 'Reads every <GROUP> and <LEDGER> master. Groups are created first (Customer / Supplier Groups and Expense Groups), then each ledger is attached to its Tally sub-group. Classification follows the PRIMARY group ancestry — Sundry Debtors → Customers, Sundry Creditors → Suppliers, Cash-in-Hand / Bank → Accounts, Direct/Indirect Expenses → Expenses, Sales/Income → Income, Capital → Capital, Assets → Fixed Assets. Existing names are skipped.'}
                    </p>
                    <button
                        onClick={() => setShowHelp(v => !v)}
                        className={`mt-4 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border flex items-center gap-2 transition-all ${showHelp ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'}`}
                    >
                        <FileText size={13} />
                        {showHelp ? 'Hide export instructions' : 'Instructions: how to export from Tally'}
                    </button>
                </div>

                {showHelp && <TallyExportGuide isStock={isStock} />}

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
                                {parsed.total} record(s) found — <span className="text-cyan-300">{groupCount} group(s)</span> + <span className="text-emerald-300">{entryCount} {isStock ? 'item(s)' : 'ledger(s)'}</span>{isStock && parsed.unitCount ? <span className="text-slate-400"> · {parsed.unitCount} unit(s)</span> : null}
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
                                        <th className="py-2 px-3">Type</th>
                                        <th className="py-2 px-3">Name</th>
                                        <th className="py-2 px-3">{isStock ? 'Group' : 'Tally Group'}</th>
                                        <th className="py-2 px-3">{isStock ? 'Unit / Opening' : 'Maps To'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {rows.map((m, i) => {
                                        const isGroup = String(m.kind || '').endsWith('_group');
                                        return (
                                            <tr key={`${m.name}-${i}`} className={isGroup ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-white/[0.03]'}>
                                                <td className="py-1.5 px-3">
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${isGroup ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                                                        {isGroup ? 'GROUP' : (isStock ? 'ITEM' : 'LEDGER')}
                                                    </span>
                                                </td>
                                                <td className="py-1.5 px-3 font-semibold text-white">{m.name}</td>
                                                <td className="py-1.5 px-3 text-slate-400">{m.parent || m.group}</td>
                                                <td className="py-1.5 px-3 text-slate-300">
                                                    {isGroup
                                                        ? (COLLECTION_LABEL[m.collection] || m.collection)
                                                        : isStock
                                                            ? `${m.unit || '—'} · ${m.openingQty || 0}`
                                                            : (COLLECTION_LABEL[m.collection] || m.collection)}
                                                </td>
                                            </tr>
                                        );
                                    })}
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
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                                <CheckCircle2 size={16} /> Import complete — {result.totalCreated} created, {result.totalSkipped} already existed
                            </div>
                            {result.batchImportId && (
                                <button
                                    onClick={handleRollback}
                                    className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold"
                                >
                                    Undo this import
                                </button>
                            )}
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
