import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import {
    ArrowLeft, X, FileSpreadsheet, CheckCircle2, AlertTriangle, Search,
    ShieldCheck, Landmark, ReceiptText, ShoppingCart, FileText
} from 'lucide-react';

/* ============================================================================
   VAT 311 COMMON TEMPLATE — UAE FTA Legal Reporting Module
   ----------------------------------------------------------------------------
   Generates FTA VAT 311 Common Template compliant reports directly in-app:

     • Box 1  — Sales / Output (standard-rated supplies, tax invoices issued)
     • Box 9  — Purchases / Input (standard-rated purchases, tax invoices received)

   Column schemas, sheet names ("Box 1" / "Box 9"), date format (dd-mm-yyyy),
   TRN-as-text handling and 2-decimal amounts mirror the official
   "V311 Common Template.xlsx" workbook (header row 1, data from row 2).

   Amounts "before VAT" are the tax-exclusive line-item material subtotal at the
   supplier/customer original rate (capitalized internal expenses excluded) —
   the same isolation used by the V201 module.
   ========================================================================= */

const norm = (s) => String(s || '').trim().toLowerCase();
const safeNum = (n) => { const v = Number(n); return isNaN(v) ? 0 : v; };

const fmt2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// Internal dates are yyyy-mm-dd; official template shows dd-mm-yyyy
const toDmy = (d) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    if (!y || !m || !day) return String(d);
    return `${day}-${m}-${y}`;
};
const iso = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Default to the current calendar quarter (full quarter range for V311)
const quarterRange = () => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const to = new Date(now.getFullYear(), q * 3 + 3, 0); // last day of quarter
    return { from: iso(from), to: iso(to) };
};

const QUARTERS = [
    { label: 'Q1 (Jan–Mar)', m: 0 }, { label: 'Q2 (Apr–Jun)', m: 3 },
    { label: 'Q3 (Jul–Sep)', m: 6 }, { label: 'Q4 (Oct–Dec)', m: 9 },
];

// Official V311 Common Template column headers (verbatim)
const BOX1_HEADERS = [
    'Transaction Type',
    'Taxpayer TRN',
    'Company Name / Member Company Name (If applicable)',
    'Tax Invoice/Tax credit note No',
    'Tax Invoice/Tax credit note Date',
    'Tax Invoice/Tax credit note Amount AED (before VAT)',
    'Reporting period from',
    'Reporting period to',
    'VAT Amount AED',
    'Customer Name',
    'Customer TRN',
    'Clear description of the supply',
    'VAT adjustments',
];
const BOX9_HEADERS = [
    'Transaction Type',
    'Taxpayer TRN',
    'Company Name / Member Company Name (If applicable)',
    'Tax Invoice/Tax credit note No',
    'Tax Invoice/Tax credit note Date',
    'Tax Invoice/Tax credit note Received Date',
    'Reporting period from',
    'Reporting period to',
    'Tax Invoice/Tax credit note Amount AED (before VAT)',
    'Supplier Name',
    "Supplier's TRN",
    'Clear description of the supply',
    'VAT Amount AED',
    'VAT Amount Recovered AED',
    'VAT adjustments',
];

// Transaction-type codes used by the official template dropdowns
const TX_TYPE = { INVOICE: '01 Invoice', CREDIT: '02 Credit note', DEBIT: '03 Debit note' };

export default function V311ReportModal({
    isOpen, onClose, onBack,
    user, dataOwnerId,
    parties = [], products = [], taxRates = [],
    companyProfile = null, displayCompanyName = '',
    taxId = null, taxName = null,
    currencySymbol = 'AED'
}) {
    const uid = dataOwnerId || user?.uid || '';
    const qRange = quarterRange();

    const [screen, setScreen] = useState('choose');   // 'choose' | 'report'
    const [box, setBox] = useState('1');              // '1' | '9'
    const [from, setFrom] = useState(qRange.from);
    const [to, setTo] = useState(qRange.to);
    const [search, setSearch] = useState('');
    const [claimRecovery, setClaimRecovery] = useState(false); // Box 9: recovered = VAT amount
    const [loading, setLoading] = useState(true);

    const [invoices, setInvoices] = useState([]);
    const [prods, setProds] = useState(products);

    useEffect(() => { if (products?.length) setProds(products); }, [products]);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            const q = quarterRange();
            setFrom(q.from); setTo(q.to);
            setScreen('choose'); setSearch(''); setClaimRecovery(false);
        }
    }, [isOpen]);

    // Live subscriptions (read-only)
    useEffect(() => {
        if (!isOpen || !uid) return;
        const subs = [];
        const qInv = query(collection(db, 'invoices'), where('userId', '==', uid));
        subs.push(onSnapshot(qInv, (snap) => {
            setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, (err) => { console.error('[V311] invoices load error', err); setLoading(false); }));
        if (!prods.length) {
            const qProd = query(collection(db, 'products'), where('userId', '==', uid));
            subs.push(onSnapshot(qProd, (snap) => {
                setProds(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            }, (err) => { console.error('[V311] products load error', err); setLoading(false); }));
        }
        return () => subs.forEach(u => u && u());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, uid]);

    // ── Taxpayer (this company) ────────────────────────────────────────────
    const taxpayerTrn = String(companyProfile?.trn || '').trim();
    const taxpayerName = String(companyProfile?.name || displayCompanyName || '').trim();

    const productName = (id) => prods.find(p => p.id === id)?.name || '';
    const partyName = (id) => parties.find(p => p.id === id)?.name || '';
    const partyTrn = (id) => parties.find(p => p.id === id)?.trn || '';

    const taxMatches = (inv) => {
        if (taxId && String(inv?.taxId || '').trim() === taxId) return true;
        if (taxName && norm(inv?.taxName) === norm(taxName)) return true;
        return !taxId && !taxName; // opened generically → any VAT-carrying doc qualifies
    };
    const appliedTaxAmount = (inv) => {
        if (!Array.isArray(inv.appliedTaxes)) return 0;
        const m = inv.appliedTaxes.find(at =>
            (taxId && String(at.taxId || '').trim() === taxId) ||
            (taxName && norm(at.taxName) === norm(taxName)) ||
            (!taxId && !taxName)
        );
        return m ? safeNum(m.calculatedAmount || 0) : 0;
    };

    // Tax-exclusive material base (isolates capitalized internal expenses via originalRate)
    const materialBase = (inv) => {
        const items = Array.isArray(inv.items) ? inv.items : [];
        let base = safeNum(inv.taxableValue || 0);
        if (base <= 0) {
            base = items.reduce((sum, it) => {
                const origR = safeNum(it.originalRate);
                const v = origR > 0
                    ? (safeNum(it.quantity) * origR)
                    : (safeNum(it.total) || (safeNum(it.quantity) * safeNum(it.rate)));
                return sum + (v > 0 ? v : 0);
            }, 0);
        }
        if (base <= 0) base = Math.max(0, safeNum(inv.totalAmount || inv.amount || 0) - safeNum(inv.taxAmount || 0));
        return base;
    };

    const describe = (inv) => {
        const names = (Array.isArray(inv.items) ? inv.items : [])
            .map(it => productName(it.productId) || it.productName || it.name || '')
            .filter(Boolean);
        const uniq = [...new Set(names)];
        const d = uniq.join(', ');
        return d || inv.narration || inv.description || '(No description)';
    };

    // ── Aggregation ────────────────────────────────────────────────────────
    const buildRows = useMemo(() => {
        const invNo = (i, boxNo) => boxNo === '1' ? (i.refNo || i.taxInvNo || '') : (i.taxInvNo || i.refNo || '');
        const inPeriod = (d) => !!d && d >= from && d <= to;

        const box1 = [];
        const box9 = [];

        (invoices || []).forEach(inv => {
            if (!inPeriod(inv?.date)) return;

            const vat = appliedTaxAmount(inv) || (taxMatches(inv) ? safeNum(inv.taxAmount) : 0);
            if (!(vat > 0)) return; // standard-rated only (zero-rated/exempt are other boxes)

            const base = materialBase(inv);
            if (!(base > 0)) return;

            const desc = describe(inv);
            const periodFrom = from, periodTo = to;

            // ---------- BOX 1 (Sales / Output) ----------
            if (inv.type === 'sales' || inv.type === 'debit_note') {
                const custId = inv.partyId;
                box1.push({
                    transactionType: inv.type === 'debit_note' ? TX_TYPE.DEBIT : TX_TYPE.INVOICE,
                    taxpayerTrn, taxpayerName,
                    invoiceNo: invNo(inv, '1'),
                    invoiceDate: toDmy(inv.date),
                    amountBeforeVat: base,
                    periodFrom: toDmy(periodFrom), periodTo: toDmy(periodTo),
                    vatAmount: vat,
                    counterName: partyName(custId) || inv.partyName || '(Unknown Customer)',
                    counterTrn: partyTrn(custId),
                    description: desc,
                    adjustments: 0,
                    _sort: inv.date,
                });
            }

            // ---------- BOX 9 (Purchases / Input) ----------
            if (inv.type === 'purchase' || inv.type === 'credit_note') {
                const supId = inv.partyId;
                box9.push({
                    transactionType: inv.type === 'credit_note' ? TX_TYPE.CREDIT : TX_TYPE.INVOICE,
                    taxpayerTrn, taxpayerName,
                    invoiceNo: invNo(inv, '9'),
                    invoiceDate: toDmy(inv.date),
                    receivedDate: toDmy(inv.receivedDate || inv.date),
                    periodFrom: toDmy(periodFrom), periodTo: toDmy(periodTo),
                    amountBeforeVat: base,
                    counterName: partyName(supId) || inv.partyName || '(Unknown Supplier)',
                    counterTrn: partyTrn(supId),
                    description: desc,
                    vatAmount: vat,
                    vatRecovered: 0,           // set below per claimRecovery
                    adjustments: 0,
                    _sort: inv.date,
                });
            }
        });

        const sortD = (a, b) => (a._sort < b._sort ? -1 : a._sort > b._sort ? 1 : 0);
        box1.sort(sortD);
        box9.sort(sortD);
        return { box1, box9 };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invoices, prods, parties, from, to, taxId, taxName, taxpayerTrn, taxpayerName, claimRecovery]);

    const activeRows = useMemo(() => {
        const rows = (box === '1' ? buildRows.box1 : buildRows.box9).map(r => {
            if (box === '9') r.vatRecovered = claimRecovery ? safeNum(r.vatAmount) : 0;
            return r;
        });
        const q = (search || '').trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r =>
            `${r.invoiceNo} ${r.counterName} ${r.counterTrn} ${r.description} ${r.transactionType}`.toLowerCase().includes(q)
        );
    }, [buildRows, box, search, claimRecovery]);

    const totals = useMemo(() => {
        const t = { rows: activeRows.length, amount: 0, vat: 0, recovered: 0, noTrn: 0, noInvNo: 0 };
        activeRows.forEach(r => {
            t.amount += safeNum(r.amountBeforeVat);
            t.vat += safeNum(r.vatAmount);
            t.recovered += safeNum(r.vatRecovered);
            if (!r.counterTrn) t.noTrn++;
            if (!r.invoiceNo) t.noInvNo++;
        });
        return t;
    }, [activeRows]);

    // ── XLSX export (official structure) ───────────────────────────────────
    const downloadXLSX = async () => {
        try {
            const XLSX = await import('xlsx');
            const headers = box === '1' ? BOX1_HEADERS : BOX9_HEADERS;
            const is1 = box === '1';

            // Build typed rows (TRNs as text; dates dd-mm-yyyy; amounts as numbers)
            const data = activeRows.map(r => {
                const row = [
                    r.transactionType,
                    String(r.taxpayerTrn || ''),
                    r.taxpayerName,
                    String(r.invoiceNo || ''),
                    r.invoiceDate,
                ];
                if (is1) {
                    row.push(safeNum(r.amountBeforeVat));
                    row.push(r.periodFrom, r.periodTo);
                    row.push(safeNum(r.vatAmount));
                    row.push(r.counterName, String(r.counterTrn || ''), r.description, safeNum(r.adjustments));
                } else {
                    row.push(r.receivedDate);
                    row.push(r.periodFrom, r.periodTo);
                    row.push(safeNum(r.amountBeforeVat));
                    row.push(r.counterName, String(r.counterTrn || ''), r.description);
                    row.push(safeNum(r.vatAmount), safeNum(r.vatRecovered), safeNum(r.adjustments));
                }
                return row;
            });

            const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
            // Column widths (approx. official layout)
            ws['!cols'] = headers.map((h, i) => ({
                wch: i === 2 || i === 11 || i === 3 ? 40 : (h.includes('TRN') ? 18 : (h.includes('Amount') || h.includes('VAT') ? 14 : 13)),
            }));

            // Light official styling: dark-blue bold header row + 2-decimal amounts
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
            for (let c = 0; c <= range.e.c; c++) {
                const addr = XLSX.utils.encode_cell({ r: 0, c });
                const cell = ws[addr];
                if (cell) cell.s = {
                    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
                    fill: { patternType: 'solid', fgColor: { rgb: 'FF1F4E78' } },
                    alignment: { vertical: 'center', wrapText: true },
                };
            }
            // Number format for monetary columns (Box1: 5=amount,8=vat,12=adj; Box9: 8=amount,12=vat,13=rec,14=adj)
            const moneyCols = is1 ? [5, 8, 12] : [8, 12, 13, 14];
            for (let r = 1; r <= range.e.r; r++) {
                moneyCols.forEach(c => {
                    if (c > range.e.c) return;
                    const addr = XLSX.utils.encode_cell({ r, c });
                    const cell = ws[addr];
                    if (cell && typeof cell.v === 'number') cell.z = '0.00';
                });
            }

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Box ${box}`);   // official sheet name
            XLSX.writeFile(wb, `VAT311_Common_Template_Box${box}_${from}_${to}.xlsx`);
        } catch (e) {
            console.error('[V311] Excel export error', e);
            alert('Excel export failed: ' + e.message);
        }
    };

    if (!isOpen) return null;

    // ── Render ─────────────────────────────────────────────────────────────
    const headers = box === '1' ? BOX1_HEADERS : BOX9_HEADERS;
    const th = 'px-2 py-2 text-left text-[8.5px] font-black uppercase tracking-wide text-white border-r border-white/10 whitespace-nowrap';
    const td = 'px-2 py-1.5 border-b border-slate-100 text-[10.5px] align-top whitespace-nowrap';
    const tdW = 'px-2 py-1.5 border-b border-slate-100 text-[10.5px] align-top';
    const tdR = 'px-2 py-1.5 border-b border-slate-100 text-[10.5px] text-right tabular-nums align-top whitespace-nowrap';

    const statCard = 'bg-white rounded-xl border border-slate-200 p-3 shadow-sm';
    const statLbl = 'text-[8.5px] font-black uppercase tracking-widest text-slate-400';
    const statVal = 'text-base font-black text-slate-800 tabular-nums mt-1';

    const chooseCard = (b, icon, title, desc, accent) => (
        <button
            onClick={() => { setBox(b); setScreen('report'); }}
            className={`group flex-1 text-left bg-white rounded-2xl border-2 ${accent} shadow-md hover:shadow-xl transition-all p-5 min-h-[190px]`}
        >
            <div className={`w-11 h-11 rounded-xl ${accent === 'border-blue-200' ? 'bg-blue-600' : 'bg-emerald-600'} text-white flex items-center justify-center mb-3`}>{icon}</div>
            <div className="text-sm font-black text-slate-800">{title}</div>
            <div className="text-[10.5px] font-semibold text-slate-500 mt-1 leading-relaxed">{desc}</div>
            <div className={`mt-3 inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-widest ${b === '1' ? 'text-blue-700' : 'text-emerald-700'}`}>
                Generate report →
            </div>
        </button>
    );

    return (
        <>
            <style>{`.v311-scroll::-webkit-scrollbar{height:9px;width:9px}.v311-scroll::-webkit-scrollbar-thumb{background:#9db9d4;border-radius:8px}.v311-scroll::-webkit-scrollbar-track{background:#f1f5f9}`}</style>
            <div className="fixed inset-0 z-[10060] bg-[#0b1e33]/85 backdrop-blur-[2px] flex items-start justify-center overflow-hidden animate-in fade-in duration-150">
                <div className="w-full h-full bg-[#eef3f8] flex flex-col">
                    {/* ── Header ── */}
                    <div className="h-11 bg-gradient-to-r from-[#12263f] to-[#1f4e79] text-white flex items-center justify-between px-3 flex-shrink-0 shadow-md">
                        <div className="flex items-center gap-2 min-w-0">
                            <button onClick={screen === 'report' ? (() => setScreen('choose')) : (onBack || onClose)} className="p-1 hover:bg-white/15 rounded transition-colors shrink-0" title={screen === 'report' ? 'Back to report types' : 'Back'}>
                                <ArrowLeft size={17} />
                            </button>
                            <div className="w-7 h-7 rounded-md bg-white/15 flex items-center justify-center text-[11px] font-black shrink-0">3</div>
                            <div className="leading-tight min-w-0">
                                <div className="text-[12px] font-black tracking-wide truncate">VAT 311 LEGAL REPORTS — UAE FTA COMMON TEMPLATE</div>
                                <div className="text-[8px] text-blue-200/80 font-bold truncate">
                                    {taxpayerName ? `${taxpayerName} · TRN ${taxpayerTrn || 'NOT SET'}` : 'Taxpayer details not configured — set company name & TRN in Manage Company'}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {screen === 'report' && (
                                <button onClick={downloadXLSX} className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[9.5px] font-black flex items-center gap-1 shadow transition-colors" title="Download XLSX (official template format)">
                                    <FileSpreadsheet size={12} /> Download XLSX
                                </button>
                            )}
                            <button onClick={onClose} className="p-1.5 hover:bg-white/15 rounded-lg transition-colors" title="Close"><X size={17} /></button>
                        </div>
                    </div>

                    {!taxpayerTrn && screen === 'report' && (
                        <div className="mx-3 mt-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 flex items-start gap-2 flex-shrink-0">
                            <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-[10.5px] font-semibold text-amber-800">
                                <b>Taxpayer TRN is not set.</b> Go to Management Hub → Manage Company and enter your VAT TRN so it appears in the 'Taxpayer TRN' column of every row.
                            </p>
                        </div>
                    )}

                    {screen === 'choose' ? (
                        /* ─────────── REPORT TYPE SELECTION ─────────── */
                        <div className="flex-1 overflow-auto p-6 v311-scroll">
                            <div className="max-w-4xl mx-auto">
                                <div className="mb-6 text-center">
                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1f4e79]/10 text-[#1f4e79] text-[10px] font-black uppercase tracking-widest mb-3">
                                        <Landmark size={13} /> UAE Federal Tax Authority · VAT 311 Common Template
                                    </div>
                                    <h2 className="text-xl font-black text-[#12263f]">Choose the legal report to generate</h2>
                                    <p className="text-[11px] font-semibold text-slate-500 mt-1">Standard-rated VAT transactions for the reporting period — compiled live from your vouchers.</p>
                                </div>

                                {/* Period */}
                                <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[#1f4e79]">Reporting period</span>
                                    <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                                        className="px-2 py-1.5 border border-slate-300 rounded-md text-[11px] font-bold bg-white outline-none focus:border-[#1f4e79] text-slate-800" />
                                    <span className="text-slate-400 text-[11px] font-black">→</span>
                                    <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                                        className="px-2 py-1.5 border border-slate-300 rounded-md text-[11px] font-bold bg-white outline-none focus:border-[#1f4e79] text-slate-800" />
                                    <select value={`${from}|${to}`}
                                        onChange={(e) => { const [f, t] = e.target.value.split('|'); setFrom(f); setTo(t); }}
                                        className="px-2 py-1.5 border border-slate-300 rounded-md text-[10px] font-black bg-white outline-none text-slate-700">
                                        {QUARTERS.map(q => {
                                            const y = new Date().getFullYear();
                                            const f = iso(new Date(y, q.m, 1));
                                            const t = iso(new Date(y, q.m + 3, 0));
                                            return <option key={q.label} value={`${f}|${t}`}>{q.label} {y}</option>;
                                        })}
                                        <option value={`${qRange.from}|${qRange.to}`}>Current Quarter</option>
                                        <option value={`${iso(new Date(new Date().getFullYear(), 0, 1))}|${iso(new Date(new Date().getFullYear(), 11, 31))}`}>Full Year</option>
                                    </select>
                                </div>

                                <div className="flex flex-col md:flex-row gap-5">
                                    {chooseCard('1', <ReceiptText size={22} />, 'Generate Box 1 (Sales Report)', 'Output VAT — standard-rated supplies & tax invoices you issued to customers (Invoice / Debit note).', 'border-blue-200 hover:border-blue-500')}
                                    {chooseCard('9', <ShoppingCart size={22} />, 'Generate Box 9 (Purchase Report)', 'Input VAT — standard-rated purchases & tax invoices you received from suppliers (Invoice / Credit note).', 'border-emerald-200 hover:border-emerald-500')}
                                </div>

                                <div className="mt-8 bg-white/70 rounded-xl border border-slate-200 p-4 text-[10px] font-semibold text-slate-500 leading-relaxed">
                                    <div className="font-black text-slate-600 uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1.5"><ShieldCheck size={12} /> Filing notes</div>
                                    • Box 1 &amp; Box 9 list <b>standard-rated</b> transactions only (invoices carrying VAT). Zero-rated / exempt / out-of-scope transactions are reported in other V311 boxes and are not included here.<br />
                                    • “Amount AED (before VAT)” = the tax-exclusive material value on the supplier/customer tax invoice (capitalized internal expenses excluded).<br />
                                    • Export sheets use the official names (<b>“Box 1”</b> / <b>“Box 9”</b>) and header order of the FTA Common Template.
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* ─────────── REPORT PREVIEW ─────────── */
                        <>
                            {/* Toolbar */}
                            <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2 flex-shrink-0">
                                <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black text-white flex items-center gap-1.5 ${box === '1' ? 'bg-[#1f4e79]' : 'bg-emerald-700'}`}>
                                    {box === '1' ? <ReceiptText size={13} /> : <ShoppingCart size={13} />} BOX {box} — {box === '1' ? 'SALES (OUTPUT VAT)' : 'PURCHASES (INPUT VAT)'}
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Period</span>
                                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="px-1.5 py-1 border border-slate-300 rounded-md text-[10.5px] font-bold outline-none text-slate-700" />
                                <span className="text-slate-400 font-black">→</span>
                                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="px-1.5 py-1 border border-slate-300 rounded-md text-[10.5px] font-bold outline-none text-slate-700" />
                                <button onClick={() => setScreen('choose')} className="px-2.5 py-1 rounded-lg border border-slate-300 text-[9px] font-black uppercase text-slate-600 hover:bg-slate-50">Change report</button>
                                <div className="flex-1" />
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 min-w-[180px]">
                                    <Search size={12} className="text-slate-400 shrink-0" />
                                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / party / description…"
                                        className="bg-transparent outline-none text-[10.5px] font-semibold w-full text-slate-700 placeholder:text-slate-400" />
                                </div>
                                {box === '9' && (
                                    <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 cursor-pointer" title="Sets 'VAT Amount Recovered' = 'VAT Amount' for every row (full input VAT claim)">
                                        <input type="checkbox" checked={claimRecovery} onChange={(e) => setClaimRecovery(e.target.checked)} className="accent-emerald-600" />
                                        <span className="text-[9px] font-black text-emerald-700 uppercase">VAT Recovered = VAT Amount (full claim)</span>
                                    </label>
                                )}
                            </div>

                            {/* Summary cards */}
                            <div className="px-3 pt-2 grid grid-cols-2 md:grid-cols-5 gap-2 flex-shrink-0">
                                <div className={statCard}><div className={statLbl}>Transactions</div><div className={statVal}>{fmtInt(totals.rows)}</div></div>
                                <div className={statCard}><div className={statLbl}>Amount AED (before VAT)</div><div className={`${statVal} text-[#1f4e79]`}>{fmt2(totals.amount)}</div></div>
                                <div className={statCard}><div className={statLbl}>VAT Amount AED</div><div className={`${statVal} text-emerald-700`}>{fmt2(totals.vat)}</div></div>
                                {box === '9'
                                    ? <div className={statCard}><div className={statLbl}>VAT Recovered AED</div><div className={`${statVal} text-emerald-700`}>{fmt2(totals.recovered)}</div></div>
                                    : <div className={statCard}><div className={statLbl}>Customers</div><div className={statVal}>{fmtInt(new Set(activeRows.map(r => r.counterName)).size)}</div></div>}
                                <div className={`${statCard} ${totals.noTrn > 0 ? 'border-rose-300 bg-rose-50' : ''}`}>
                                    <div className={statLbl}>{box === '1' ? 'Customers w/o TRN' : 'Suppliers w/o TRN'}</div>
                                    <div className={`${statVal} ${totals.noTrn > 0 ? 'text-rose-600' : 'text-slate-800'}`}>{totals.noTrn}</div>
                                </div>
                            </div>

                            {/* Preview grid */}
                            <div className="flex-1 overflow-auto p-3 pt-2 v311-scroll">
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    {loading ? (
                                        <div className="p-14 text-center text-xs font-bold text-slate-400">Compiling legal report…</div>
                                    ) : (
                                        <>
                                            <div className="overflow-auto max-h-[60vh]">
                                                <table className="w-full border-collapse">
                                                    <thead className="sticky top-0 z-10">
                                                        <tr className={box === '1' ? 'bg-[#1f4e79]' : 'bg-emerald-800'}>
                                                            {headers.map((h, i) => (
                                                                <th key={i} className={th}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {activeRows.length === 0 && (
                                                            <tr><td colSpan={headers.length} className="p-12 text-center">
                                                                <div className="text-4xl mb-2 opacity-20"><FileText size={40} className="mx-auto" /></div>
                                                                <p className="text-xs font-bold text-slate-400">No standard-rated {box === '1' ? 'sales' : 'purchase'} transactions with VAT found in this period.</p>
                                                            </td></tr>
                                                        )}
                                                        {activeRows.map((r, i) => (
                                                            <tr key={i} className={`${i % 2 ? 'bg-slate-50/60' : 'bg-white'} hover:bg-blue-50/50 border-b border-slate-100`}>
                                                                <td className={tdW}><span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${r.transactionType.includes('Credit') ? 'bg-orange-100 text-orange-700' : r.transactionType.includes('Debit') ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{r.transactionType}</span></td>
                                                                <td className={td}>{r.taxpayerTrn || '-'}</td>
                                                                <td className={tdW}>{r.taxpayerName}</td>
                                                                <td className={td}>{r.invoiceNo || '-'}</td>
                                                                <td className={td}>{r.invoiceDate}</td>
                                                                {box === '9' && <td className={td}>{r.receivedDate}</td>}
                                                                <td className={`${tdR} font-black text-slate-800`}>{fmt2(r.amountBeforeVat)}</td>
                                                                <td className={td}>{r.periodFrom}</td>
                                                                <td className={td}>{r.periodTo}</td>
                                                                {box === '1' ? (
                                                                    <>
                                                                        <td className={`${tdR} font-black text-emerald-700`}>{fmt2(r.vatAmount)}</td>
                                                                        <td className={tdW}><div className="font-black text-slate-800">{r.counterName}</div></td>
                                                                        <td className={td}>{r.counterTrn
                                                                            ? <span className="font-bold text-slate-600">{r.counterTrn}</span>
                                                                            : <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-1 py-0.5 rounded">NO TRN</span>}</td>
                                                                        <td className={`${tdW} !whitespace-normal min-w-[160px]`}><span className="text-slate-600 italic">{r.description}</span></td>
                                                                        <td className={tdR}>{fmt2(r.adjustments)}</td>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <td className={tdW}><div className="font-black text-slate-800">{r.counterName}</div></td>
                                                                        <td className={td}>{r.counterTrn
                                                                            ? <span className="font-bold text-slate-600">{r.counterTrn}</span>
                                                                            : <span className="text-[8px] font-black text-rose-500 bg-rose-50 px-1 py-0.5 rounded">NO TRN</span>}</td>
                                                                        <td className={`${tdW} !whitespace-normal min-w-[160px]`}><span className="text-slate-600 italic">{r.description}</span></td>
                                                                        <td className={`${tdR} font-black text-emerald-700`}>{fmt2(r.vatAmount)}</td>
                                                                        <td className={`${tdR} font-black ${claimRecovery ? 'text-emerald-700' : 'text-slate-400'}`}>{fmt2(r.vatRecovered)}</td>
                                                                        <td className={tdR}>{fmt2(r.adjustments)}</td>
                                                                    </>
                                                                )}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    {activeRows.length > 0 && (
                                                        <tfoot>
                                                            {box === '1' ? (
                                                                <tr className="bg-[#12263f]">
                                                                    <td className="px-2 py-2 font-black text-white" colSpan={5}>TOTALS ({totals.rows} transactions)</td>
                                                                    <td className="px-2 py-2 text-right font-black text-white">{fmt2(totals.amount)}</td>
                                                                    <td className="px-2 py-2 text-white/70 font-bold text-center" colSpan={2}>{`${toDmy(from)} → ${toDmy(to)}`}</td>
                                                                    <td className="px-2 py-2 text-right font-black text-emerald-300">{fmt2(totals.vat)}</td>
                                                                    <td className="px-2 py-2" colSpan={3}></td>
                                                                    <td className="px-2 py-2 text-right font-black text-emerald-300">0.00</td>
                                                                </tr>
                                                            ) : (
                                                                <tr className="bg-emerald-950">
                                                                    <td className="px-2 py-2 font-black text-white" colSpan={6}>TOTALS ({totals.rows} transactions)</td>
                                                                    <td className="px-2 py-2 text-white/70 font-bold text-center" colSpan={2}>{`${toDmy(from)} → ${toDmy(to)}`}</td>
                                                                    <td className="px-2 py-2 text-right font-black text-white">{fmt2(totals.amount)}</td>
                                                                    <td className="px-2 py-2" colSpan={3}></td>
                                                                    <td className="px-2 py-2 text-right font-black text-emerald-300">{fmt2(totals.vat)}</td>
                                                                    <td className="px-2 py-2 text-right font-black text-emerald-300">{fmt2(totals.recovered)}</td>
                                                                    <td className="px-2 py-2 text-right font-black text-emerald-300">0.00</td>
                                                                </tr>
                                                            )}
                                                        </tfoot>
                                                    )}
                                                </table>
                                            </div>

                                            <div className={`px-3 py-1.5 ${box === '1' ? 'bg-[#12263f] text-blue-100' : 'bg-emerald-950 text-emerald-100'} text-[8.5px] font-semibold flex items-center gap-2`}>
                                                <CheckCircle2 size={11} className="shrink-0" />
                                                {box === '1'
                                                    ? <>Box 1 lists standard-rated <b>sales invoices</b> (and debit notes) issued in the period. Column order &amp; headers match the official <b>V311 Common Template — “Box 1”</b> sheet. VAT adjustments default to 0.00.</>
                                                    : <>Box 9 lists standard-rated <b>purchase invoices</b> (and credit notes) received in the period. Column order &amp; headers match the official <b>“Box 9”</b> sheet. <b>VAT Recovered</b> = 0.00 by default; tick <i>“VAT Recovered = VAT Amount”</i> to claim the full input VAT in the export.</>}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
