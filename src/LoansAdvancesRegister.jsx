import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

const TYPE_META = {
    'our-advance':   { label: 'OUR ADVANCE',   prefix: 'OA', bg: 'bg-blue-500/20',   text: 'text-blue-300',   border: 'border-blue-500/40' },
    'their-advance': { label: 'THEIR ADVANCE', prefix: 'TA', bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/40' },
    'our-loan':      { label: 'OUR LOAN',      prefix: 'OL', bg: 'bg-amber-500/20',  text: 'text-amber-300',  border: 'border-amber-500/40' },
    'their-loan':    { label: 'THEIR LOAN',    prefix: 'TL', bg: 'bg-rose-500/20',   text: 'text-rose-300',   border: 'border-rose-500/40' },
};

const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
};
const format3 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const LoansAdvancesRegister = ({ isOpen, onClose, onBack, user, dataOwnerId, parties, currencySymbol, zIndex }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedRow, setSelectedRow] = useState(null); // for mini-ledger panel

    const today = new Date().toISOString().substring(0, 10);

    const loadData = useCallback(async () => {
        if (!isOpen || !user) return;
        setLoading(true);
        try {
            const targetUid = dataOwnerId || user.uid;
            const snap = await getDocs(query(collection(db, 'payments'), where('userId', '==', targetUid)));

            // Map: advRefNo → aggregated row
            const refMap = new Map();

            snap.docs.forEach(docSnap => {
                const voucher = docSnap.data();
                if (!voucher.isMulti || !voucher.splits) return;
                const vType = voucher.type; // 'in' or 'out'

                voucher.splits.forEach(split => {
                    const pa = split.paymentAgainst;
                    if (!TYPE_META[pa]) return;
                    if (!split.advRefNo) return;

                    const ref = split.advRefNo;
                    const amt = Number(split.amount || 0) * Number(voucher.exchangeRate || 1);
                    const splitDue = split.loanReturnDate || split.advanceReturnDate || null;

                    if (!refMap.has(ref)) {
                        refMap.set(ref, {
                            refNo: ref,
                            type: pa,
                            partyId: split.targetId,
                            partyName: split.targetName || null,
                            startDate: voucher.date || '',
                            originalAmount: amt,
                            totalOut: 0,
                            totalIn: 0,
                            firstDueDate: splitDue,
                            latestDueDate: splitDue,
                            remark: split.advRemark || split.loanRemark || split.advanceRemark || '',
                            entries: [],
                        });
                    }

                    const row = refMap.get(ref);

                    // Track earliest date as start date
                    if (voucher.date && voucher.date < row.startDate) {
                        row.startDate = voucher.date;
                        row.originalAmount = amt;
                    }

                    // Track amounts by direction
                    if (vType === 'out') row.totalOut += amt;
                    else if (vType === 'in') row.totalIn += amt;

                    // Track due dates: earliest = original, latest = possible extension
                    if (splitDue) {
                        if (!row.firstDueDate || splitDue < row.firstDueDate) row.firstDueDate = splitDue;
                        if (!row.latestDueDate || splitDue > row.latestDueDate) row.latestDueDate = splitDue;
                    }

                    // Collect remark from any entry if missing
                    if (!row.remark && (split.advRemark || split.loanRemark || split.advanceRemark)) {
                        row.remark = split.advRemark || split.loanRemark || split.advanceRemark || '';
                    }

                    row.entries.push({
                        voucherId: docSnap.id,
                        voucherType: vType,
                        date: voucher.date,
                        amount: amt,
                        refNo: voucher.refNo,
                    });
                });
            });

            // Read invoices that have been adjusted against these advance refs
            const invAdjMap = {};
            if (refMap.size > 0) {
                const invSnap = await getDocs(query(collection(db, 'invoices'), where('userId', '==', targetUid)));
                invSnap.docs.forEach(d => {
                    const inv = d.data();
                    if (inv.adjustedAdvanceRef && inv.adjustedAdvanceAmount && refMap.has(inv.adjustedAdvanceRef)) {
                        const adjAmt = Number(inv.adjustedAdvanceAmount);
                        invAdjMap[inv.adjustedAdvanceRef] = (invAdjMap[inv.adjustedAdvanceRef] || 0) + adjAmt;
                        // Also add the invoice as an entry
                        const row = refMap.get(inv.adjustedAdvanceRef);
                        row.entries.push({
                            voucherId: d.id,
                            voucherType: inv.type === 'purchase' ? 'purchase-adj' : 'sales-adj',
                            date: inv.date,
                            amount: -adjAmt,
                            refNo: inv.refNo,
                        });
                    }
                });
            }

            const result = [];
            refMap.forEach(row => {
                // Balance:
                // OA/OL (we gave): we want money BACK → balance = totalOut - totalIn
                // TA/TL (they gave): we owe them → balance = totalIn - totalOut
                let rawBalance;
                if (['our-advance', 'our-loan'].includes(row.type)) {
                    rawBalance = row.totalOut - row.totalIn;
                } else {
                    rawBalance = row.totalIn - row.totalOut;
                }
                // Subtract invoice adjustments from balance
                const adjUsed = invAdjMap[row.refNo] || 0;
                const netBalance = rawBalance - adjUsed;
                row.balance = Math.max(0, netBalance);
                row.isCompleted = netBalance <= 0.01;

                // Receiving/Paying details: join entries descriptions
                const entryLines = row.entries.map(e => {
                    if (e.voucherType === 'purchase-adj') return `Purchase Adj −${format3(Math.abs(e.amount))} on ${formatDate(e.date)}${e.refNo ? ' (Ref: ' + e.refNo + ')' : ''}`;
                    if (e.voucherType === 'sales-adj') return `Sales Adj −${format3(Math.abs(e.amount))} on ${formatDate(e.date)}${e.refNo ? ' (Ref: ' + e.refNo + ')' : ''}`;
                    return `${e.voucherType === 'out' ? 'Paid' : 'Recd'} ${format3(e.amount)} on ${formatDate(e.date)}${e.refNo ? ' (Ref: ' + e.refNo + ')' : ''}`;
                });
                row.receivingPayingDetails = entryLines.join(' | ');

                // Due date = original; extendedUntil = latest if different
                row.dueDate = row.firstDueDate;
                row.extendedUntil = (row.latestDueDate && row.latestDueDate !== row.firstDueDate) ? row.latestDueDate : null;

                // Resolve party name
                if (!row.partyName && row.partyId && parties) {
                    const p = parties.find(pt => pt.id === row.partyId);
                    if (p) row.partyName = p.name;
                }

                result.push(row);
            });

            result.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
            setRows(result);
        } catch (e) {
            console.error('LoansAdvancesRegister load error:', e);
        }
        setLoading(false);
    }, [isOpen, user, dataOwnerId, parties]);

    useEffect(() => {
        if (isOpen) loadData();
    }, [isOpen, loadData]);

    if (!isOpen) return null;

    // Apply status filter
    const filtered = rows.filter(row => {
        if (statusFilter === 'completed') return row.isCompleted;
        if (statusFilter === 'overaged') return !row.isCompleted && row.dueDate && row.dueDate < today;
        if (statusFilter === 'not-overaged') return !row.isCompleted && (!row.dueDate || row.dueDate >= today);
        return true;
    });

    const getRowColors = (row) => {
        if (row.isCompleted) return { row: 'bg-emerald-900/20 hover:bg-emerald-900/30', text: 'text-emerald-300' };
        const isOveraged = row.dueDate && row.dueDate < today;
        if (isOveraged) return { row: 'bg-red-900/10 hover:bg-red-900/20', text: 'text-red-400' };
        return { row: 'bg-white/[0.02] hover:bg-white/[0.05]', text: 'text-emerald-300' };
    };

    // Summary totals
    const totalBalance = filtered.reduce((sum, r) => sum + (r.isCompleted ? 0 : r.balance), 0);
    const completedCount = filtered.filter(r => r.isCompleted).length;
    const overdueCount = filtered.filter(r => !r.isCompleted && r.dueDate && r.dueDate < today).length;

    return (
        <div
            className="fixed inset-0 bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] text-white flex flex-col font-sans"
            style={{ zIndex: zIndex || 200 }}
        >
            {/* HEADER */}
            <div className="h-14 bg-black/30 flex items-center justify-between px-6 border-b border-white/10 shrink-0">
                <div
                    className="flex items-center gap-4 cursor-pointer hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
                    onClick={onBack || onClose}
                >
                    <div className="bg-white/10 p-2 rounded-md">
                        <ArrowRight className="rotate-180" size={18} />
                    </div>
                    <div>
                        <div className="text-[8px] font-black uppercase tracking-[0.25em] opacity-40">Registers</div>
                        <div className="text-sm font-black tracking-wide uppercase">Loans & Advances Tracker</div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={loadData}
                        className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors"
                        title="Refresh data"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full text-white/40 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* FILTER BUTTONS */}
            <div className="bg-black/20 border-b border-white/10 px-6 py-3 flex items-center gap-2 flex-wrap shrink-0">
                {[
                    { key: 'all', label: 'View All', active: 'bg-white text-slate-900', inactive: 'bg-white/5 text-white/60 hover:bg-white/10' },
                    { key: 'not-overaged', label: 'Only Not Over Aged', active: 'bg-emerald-500 text-white', inactive: 'bg-white/5 text-emerald-400 hover:bg-emerald-900/30' },
                    { key: 'overaged', label: 'Only Over Aged', active: 'bg-red-500 text-white', inactive: 'bg-white/5 text-red-400 hover:bg-red-900/30' },
                    { key: 'completed', label: 'Only Completed', active: 'bg-emerald-600 text-white', inactive: 'bg-white/5 text-emerald-400 hover:bg-emerald-900/30' },
                ].map(f => (
                    <button
                        key={f.key}
                        onClick={() => setStatusFilter(f.key)}
                        className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${statusFilter === f.key ? f.active : f.inactive}`}
                    >
                        {f.label}
                    </button>
                ))}

                {/* Summary chips */}
                <div className="ml-auto flex items-center gap-3">
                    {overdueCount > 0 && (
                        <div className="text-[9px] font-black text-red-400 bg-red-900/20 px-3 py-1 rounded-full border border-red-500/30">
                            {overdueCount} OVERDUE
                        </div>
                    )}
                    {completedCount > 0 && (
                        <div className="text-[9px] font-black text-emerald-400 bg-emerald-900/20 px-3 py-1 rounded-full border border-emerald-500/30">
                            {completedCount} COMPLETED
                        </div>
                    )}
                    <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">
                        {filtered.length} RECORDS
                    </div>
                </div>
            </div>

            {/* SUMMARY CARDS */}
            {filtered.length > 0 && (
                <div className="px-6 py-3 flex gap-3 shrink-0 border-b border-white/5">
                    {Object.entries(TYPE_META).map(([typeKey, meta]) => {
                        const typeRows = filtered.filter(r => r.type === typeKey && !r.isCompleted);
                        if (typeRows.length === 0) return null;
                        const typeBalance = typeRows.reduce((s, r) => s + r.balance, 0);
                        return (
                            <div key={typeKey} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${meta.border} ${meta.bg}`}>
                                <span className={`text-[8px] font-black uppercase tracking-widest ${meta.text}`}>{meta.label}</span>
                                <span className={`text-xs font-black tabular-nums ${meta.text}`}>{format3(typeBalance)}</span>
                            </div>
                        );
                    })}
                    {totalBalance > 0 && (
                        <div className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white/10 border border-white/20">
                            <span className="text-[8px] font-black uppercase tracking-widest text-white/50">Total Outstanding</span>
                            <span className="text-sm font-black tabular-nums text-white">{currencySymbol || ''} {format3(totalBalance)}</span>
                        </div>
                    )}
                </div>
            )}

            {/* TABLE */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-40 gap-3 text-white/30">
                        <Loader2 size={24} className="animate-spin" />
                        <span className="text-sm font-bold uppercase tracking-widest">Loading register data...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-white/20">
                        <div className="text-4xl">📋</div>
                        <div className="text-sm font-bold uppercase tracking-widest">No records found</div>
                        <div className="text-xs text-white/10">Tag payments as Our/Their Advance or Loan to see them here</div>
                    </div>
                ) : (
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
                            <tr className="text-white/30 text-[8px] uppercase tracking-[0.15em] font-black border-b border-white/10">
                                <th className="text-left px-4 py-3 w-28">Ref No.</th>
                                <th className="text-left px-4 py-3 w-28">Starting Date</th>
                                <th className="text-right px-4 py-3 w-28">Amount</th>
                                <th className="text-center px-4 py-3 w-32">Payment Type</th>
                                <th className="text-left px-4 py-3">Customer / Party</th>
                                <th className="text-center px-4 py-3 w-28">Due Date</th>
                                <th className="text-center px-4 py-3 w-28">Extended Until?</th>
                                <th className="text-left px-4 py-3">Receiving / Paying Details</th>
                                <th className="text-right px-4 py-3 w-32">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((row, idx) => {
                                const colors = getRowColors(row);
                                const meta = TYPE_META[row.type] || {};
                                const isOveraged = !row.isCompleted && row.dueDate && row.dueDate < today;
                                return (
                                    <tr
                                        key={row.refNo + idx}
                                        className={`border-b border-white/5 transition-colors ${colors.row}`}
                                    >
                        {/* Ref No. — clickable to open mini-ledger */}
                                        <td className={`px-4 py-3 font-black tracking-wide ${colors.text}`}>
                                            <button
                                                type="button"
                                                className="underline underline-offset-2 decoration-dotted hover:no-underline hover:opacity-80 transition-opacity text-left"
                                                onClick={() => setSelectedRow(row)}
                                                title="View advance ledger note"
                                            >
                                                {row.refNo}
                                            </button>
                                        </td>

                                        {/* Starting Date */}
                                        <td className={`px-4 py-3 ${colors.text} opacity-80`}>
                                            {formatDate(row.startDate)}
                                        </td>

                                        {/* Amount */}
                                        <td className={`px-4 py-3 text-right font-black tabular-nums ${colors.text}`}>
                                            {format3(row.originalAmount)}
                                        </td>

                                        {/* Payment Type badge */}
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-block px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${meta.bg || ''} ${meta.text || ''} ${meta.border || ''}`}>
                                                {meta.label || row.type}
                                            </span>
                                        </td>

                                        {/* Customer */}
                                        <td className={`px-4 py-3 font-bold ${colors.text}`}>
                                            {row.partyName || <span className="text-white/20">—</span>}
                                        </td>

                                        {/* Due Date */}
                                        <td className={`px-4 py-3 text-center ${isOveraged ? 'text-red-400 font-bold' : colors.text + ' opacity-70'}`}>
                                            {formatDate(row.dueDate)}
                                        </td>

                                        {/* Extended Until */}
                                        <td className={`px-4 py-3 text-center ${row.extendedUntil ? 'text-amber-400 font-bold' : 'text-white/15'}`}>
                                            {row.extendedUntil ? formatDate(row.extendedUntil) : '—'}
                                        </td>

                                        {/* Receiving / Paying Details */}
                                        <td className={`px-4 py-3 max-w-[220px] ${colors.text} opacity-60`}>
                                            <div className="truncate text-[10px]" title={row.receivingPayingDetails}>
                                                {row.remark ? (
                                                    <span className="font-bold">{row.remark}</span>
                                                ) : (
                                                    row.receivingPayingDetails || <span className="text-white/15">—</span>
                                                )}
                                            </div>
                                            {row.remark && (
                                                <div className="text-[9px] opacity-60 mt-0.5 truncate" title={row.receivingPayingDetails}>
                                                    {row.receivingPayingDetails}
                                                </div>
                                            )}
                                        </td>

                                        {/* Balance */}
                                        <td className={`px-4 py-3 text-right font-black tabular-nums`}>
                                            {row.isCompleted ? (
                                                <span className="text-emerald-400 text-[10px] font-black tracking-wider">✓ COMPLETED</span>
                                            ) : (
                                                <span className={isOveraged ? 'text-red-400' : 'text-emerald-400'}>
                                                    {format3(row.balance)}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ─── MINI-LEDGER SLIDE-IN PANEL ─── */}
            {selectedRow && (() => {
                const meta = TYPE_META[selectedRow.type] || {};
                // Sort entries by date
                const sortedEntries = [...(selectedRow.entries || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                let running = 0;
                return (
                    <div
                        className="fixed inset-0 z-[9999] flex items-center justify-end"
                        onClick={() => setSelectedRow(null)}
                    >
                        <div
                            className="h-full w-full max-w-md bg-[#0f172a] border-l border-white/10 flex flex-col shadow-2xl overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Panel Header */}
                            <div className="bg-black/40 border-b border-white/10 px-6 py-4 shrink-0">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="text-[8px] font-black uppercase tracking-[0.25em] opacity-40 mb-1">Advance Ledger Note</div>
                                        <div className={`text-xl font-black tracking-wide ${meta.text || 'text-white'}`}>{selectedRow.refNo}</div>
                                        <div className="text-[11px] text-white/60 mt-1 font-bold">
                                            {selectedRow.partyName || <span className="text-white/25">— No party tagged —</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2.5 py-1 rounded-full text-[8px] font-black border ${meta.border} ${meta.bg} ${meta.text}`}>
                                            {meta.label || selectedRow.type}
                                        </span>
                                        <button
                                            onClick={() => setSelectedRow(null)}
                                            className="p-2 hover:bg-white/10 rounded-full text-white/30 hover:text-white transition-colors"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>
                                {/* Summary chips */}
                                <div className="flex gap-3 mt-3">
                                    <div className="text-[9px] font-black text-white/30 uppercase">
                                        Started: <span className="text-white/60">{formatDate(selectedRow.startDate)}</span>
                                    </div>
                                    {selectedRow.remark && (
                                        <div className="text-[9px] font-black text-white/30 uppercase">
                                            Note: <span className="text-white/60">{selectedRow.remark}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Entries Table */}
                            <div className="flex-1 overflow-y-auto">
                                {sortedEntries.length === 0 ? (
                                    <div className="flex items-center justify-center h-24 text-white/20 text-xs font-bold uppercase tracking-widest">
                                        No entries recorded
                                    </div>
                                ) : (
                                    <table className="w-full text-xs border-collapse">
                                        <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-white/10">
                                            <tr className="text-white/25 text-[8px] uppercase tracking-widest font-black">
                                                <th className="text-left px-5 py-3">Date</th>
                                                <th className="text-center px-3 py-3">Type</th>
                                                <th className="text-left px-3 py-3">Voucher Ref</th>
                                                <th className="text-right px-5 py-3">Amount</th>
                                                <th className="text-right px-5 py-3">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {sortedEntries.map((entry, idx) => {
                                                const isPurchAdj = entry.voucherType === 'purchase-adj' || entry.voucherType === 'sales-adj';
                                                const amt = Number(entry.amount || 0);
                                                running += amt;
                                                const isOut = entry.voucherType === 'out';
                                                return (
                                                    <tr key={idx} className={`transition-colors ${isPurchAdj ? 'bg-amber-900/10 hover:bg-amber-900/20' : 'hover:bg-white/[0.03]'}`}>
                                                        <td className="px-5 py-3 text-white/50 tabular-nums whitespace-nowrap">
                                                            {formatDate(entry.date)}
                                                        </td>
                                                        <td className="px-3 py-3 text-center">
                                                            <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black ${
                                                                isPurchAdj ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                                                isOut ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                                                                'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                            }`}>
                                                                {isPurchAdj ? 'Adj.' : isOut ? 'Paid' : 'Recd'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 text-white/40 font-bold">{entry.refNo || '—'}</td>
                                                        <td className={`px-5 py-3 text-right font-black tabular-nums ${isPurchAdj ? 'text-amber-400' : isOut ? 'text-red-400' : 'text-emerald-400'}`}>
                                                            {isPurchAdj ? '−' : isOut ? '+' : '−'}{format3(Math.abs(amt))}
                                                        </td>
                                                        <td className={`px-5 py-3 text-right font-black tabular-nums ${running <= 0.01 ? 'text-emerald-400' : 'text-white/70'}`}>
                                                            {format3(Math.abs(running))}
                                                            {running <= 0.01 && <span className="ml-1 text-[8px] text-emerald-400">✓</span>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* Panel Footer — Balance summary */}
                            <div className={`shrink-0 px-6 py-4 border-t border-white/10 flex items-center justify-between ${selectedRow.isCompleted ? 'bg-emerald-900/20' : 'bg-black/20'}`}>
                                <div>
                                    <div className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30 mb-1">Outstanding Balance</div>
                                    {selectedRow.isCompleted ? (
                                        <span className="text-emerald-400 font-black text-lg">✓ FULLY SETTLED</span>
                                    ) : (
                                        <span className={`font-black text-lg tabular-nums ${meta.text || 'text-white'}`}>
                                            {format3(selectedRow.balance)}
                                        </span>
                                    )}
                                </div>
                                {selectedRow.dueDate && (
                                    <div className="text-right">
                                        <div className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30 mb-1">Due Date</div>
                                        <span className={`font-black text-sm ${selectedRow.dueDate < new Date().toISOString().split('T')[0] && !selectedRow.isCompleted ? 'text-red-400' : 'text-white/60'}`}>
                                            {formatDate(selectedRow.dueDate)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* FOOTER */}
            <div className="bg-black/20 border-t border-white/5 px-6 py-2.5 flex items-center justify-between shrink-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-white/20">
                    Loans & Advances · Tracking Register
                </div>
                <div className="text-[9px] font-mono bg-white/5 px-2 py-1 rounded text-white/30">
                    OA · TA · OL · TL
                </div>
            </div>
        </div>
    );
};

export default LoansAdvancesRegister;
