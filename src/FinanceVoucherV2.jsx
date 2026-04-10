/**
 * FinanceVoucherV2.jsx — Tally ERP 9 Inspired Payment/Receipt Voucher
 * Optimized for keyboard-centric flow (Enter-Enter navigation)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Save, Plus, Trash2, Search,
    FileText, DollarSign, Zap, Building2,
    CheckCircle2, Loader2, ChevronsUpDown, Receipt,
    Printer, Download, Eye, AlertCircle, TrendingUp, TrendingDown
} from 'lucide-react';
import DocumentGeneratorV2 from './DocumentGeneratorV2';
import DateInput from './DateInput';
import {
    collection, serverTimestamp, query, where,
    doc, runTransaction, onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';

const TallySelect = ({ options = [], value, onChange, placeholder = 'Search...', focused, onEnter, onEsc, className }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const ref = useRef(null);
    const inputRef = useRef(null);
    const selected = options.find(o => o.value === value);

    const filtered = useMemo(() => {
        if (!q) return options.slice(0, 80);
        const lq = q.toLowerCase();
        return options.filter(o => o.text?.toLowerCase().includes(lq)).slice(0, 80);
    }, [options, q]);

    useEffect(() => {
        if (focused && inputRef.current) {
            inputRef.current.focus();
            setOpen(true);
        } else {
            setOpen(false);
        }
    }, [focused]);

    useEffect(() => {
        setHighlightedIndex(0);
    }, [q]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(p => Math.min(p + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(p => Math.max(p - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered.length > 0) {
                const val = filtered[highlightedIndex].value;
                onChange(val);
                setOpen(false);
                setQ('');
                if (onEnter) onEnter(val);
            } else if (q === '' && onEnter) {
                onEnter('');
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            if (onEsc) onEsc();
        }
    };

    return (
        <div ref={ref} className={`relative w-full ${className}`}>
            <div className={`flex items-center gap-1 border border-transparent px-2 py-0.5 transition-all ${focused ? 'bg-[#fff59d] border-slate-400 font-bold' : 'bg-transparent'}`}>
                <input
                    ref={inputRef}
                    className="flex-1 text-[13px] bg-transparent outline-none text-slate-900 placeholder-slate-400"
                    placeholder={placeholder}
                    value={q || (selected ? selected.text : '')}
                    onChange={e => {
                        setQ(e.target.value);
                        setOpen(true);
                        // If user starts typing, clear current selection's text display internally
                    }}
                    onFocus={() => { if (focused) setOpen(true); }}
                    onKeyDown={handleKeyDown}
                />
            </div>
            {open && focused && (
                <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-slate-400 shadow-2xl z-[300] max-h-60 overflow-y-auto">
                    {filtered.length > 0 ? (
                        filtered.map((o, idx) => (
                            <div
                                key={o.value}
                                className={`px-2 py-1 text-[13px] cursor-pointer ${idx === highlightedIndex ? 'bg-[#2196f3] text-white' : 'text-slate-800 hover:bg-blue-50'}`}
                                onClick={() => { onChange(o.value); setOpen(false); setQ(''); if (onEnter) onEnter(o.value); }}
                            >
                                {o.text}
                            </div>
                        ))
                    ) : (
                        <div className="px-2 py-1 text-[13px] text-slate-400 italic font-medium">No results found</div>
                    )}
                </div>
            )}
        </div>
    );
};

const FinanceVoucherV2 = ({
    isOpen, onClose, user, subUser, dataOwnerId,
    parties, expenses, incomeAccounts, accounts, capitalAccounts, assetAccounts,
    initialData, lastDate, currencySymbol,
    onSwitchVoucher, onQuickCreate, showToast, zIndex = 200, companyProfile = {},
    type = 'payment'
}) => {
    const isPayment = type === 'payment';
    const isReceipt = type === 'receipt';
    const docTitle = isPayment ? 'Payment' : isReceipt ? 'Receipt' : 'Finance';
    const effectiveName = subUser?.username || user?.displayName || user?.email || 'System';

    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState({});
    const [rows, setRows] = useState([{ accountId: '', amount: '', narration: '' }]);
    const [currencies, setCurrencies] = useState([]);
    const [showGenModal, setShowGenModal] = useState(false);
    const [showAcceptPrompt, setShowAcceptPrompt] = useState(false);

    // Focus state
    // field: 'date' | 'source' | 'ledger' | 'amount' | 'narration'
    const [focusIndex, setFocusIndex] = useState(0); // For rows
    const [focusField, setFocusField] = useState('source'); 

    const refNoRef = useRef(null);
    const dateRef = useRef(null);
    const narrationRef = useRef(null);
    const saveButtonRef = useRef(null);

    // Listen for global Alt+S to save
    useEffect(() => {
        const handler = (e) => {
            if (e.altKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                setShowAcceptPrompt(true);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const targetUid = dataOwnerId || user?.uid;
        if (!targetUid) return;
        const unsub = onSnapshot(query(collection(db, 'currencies'), where('userId', '==', targetUid)), snap => setCurrencies(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        return () => unsub();
    }, [isOpen, dataOwnerId, user]);

    useEffect(() => {
        if (!isOpen) return;
            setFormData({
                date: initialData.date || new Date().toISOString().split('T')[0],
                refNo: initialData.refNo || '',
                sourceId: initialData.sourceId || '',
                currencyId: initialData.currencyId || 'BASE',
                exchangeRate: initialData.exchangeRate || 1,
                narration: initialData.narration || '',
            });
            setRows(initialData.rows || [{ accountId: '', amount: '', narration: '' }]);
            setFocusField('refNo');
            setTimeout(() => refNoRef.current?.focus(), 100);
        } else {
            setFormData({
                date: lastDate || new Date().toISOString().split('T')[0],
                refNo: '', sourceId: '', currencyId: 'BASE', exchangeRate: 1, narration: '',
            });
            setRows([{ accountId: '', amount: '', narration: '' }]);
            setFocusField('refNo');
            setTimeout(() => refNoRef.current?.focus(), 100);
        }
    }, [isOpen, initialData]);

    const totals = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

    // Gather all ledgers for the row selection
    const allLedgers = useMemo(() => [
        ...parties.map(p => ({ value: p.id, text: p.name, balance: p.balance, type: 'Party' })),
        ...expenses.map(e => ({ value: e.id, text: e.name, balance: e.balance, type: 'Expense' })),
        ...incomeAccounts.map(a => ({ value: a.id, text: a.name, balance: a.balance, type: 'Income' })),
        ...capitalAccounts.map(a => ({ value: a.id, text: a.name, balance: a.balance, type: 'Capital' })),
        ...assetAccounts.map(a => ({ value: a.id, text: a.name, balance: a.balance, type: 'Asset' })),
        ...accounts.map(a => ({ value: a.id, text: a.name, balance: a.balance, type: 'Cash/Bank' }))
    ], [parties, expenses, incomeAccounts, accounts, capitalAccounts, assetAccounts]);

    const handleSave = async () => {
        if (!formData.sourceId) {
            alert('⚠ Please select Cash/Bank Account!');
            setFocusField('source');
            return;
        }
        const validRows = rows.filter(r => r.accountId && Number(r.amount) > 0);
        if (validRows.length === 0) {
            alert('⚠ Please add at least one ledger with an amount!');
            setFocusField('ledger');
            setFocusIndex(0);
            return;
        }

        setSaving(true);
        try {
            await runTransaction(db, async (transaction) => {
                const targetUid = dataOwnerId || user.uid;
                const docRef = (initialData?.id) ? doc(db, 'finance_vouchers', initialData.id) : doc(collection(db, 'finance_vouchers'));
                
                const payload = {
                    type, version: 'v2', status: 'active',
                    ...formData,
                    rows: validRows,
                    totalAmount: totals * (Number(formData.exchangeRate) || 1),
                    userId: targetUid,
                    lastModifiedBy: user.uid,
                    lastModifiedByName: effectiveName,
                    lastModifiedAt: serverTimestamp(),
                    ...(!initialData ? { createdBy: user.uid, createdByName: effectiveName, createdAt: serverTimestamp() } : {})
                };

                if (initialData?.id) transaction.update(docRef, payload);
                else transaction.set(docRef, payload);

                const logRef = doc(collection(db, 'audit_logs'));
                transaction.set(logRef, {
                    date: serverTimestamp(), ownerId: targetUid, userId: user.uid, userName: effectiveName,
                    action: initialData ? 'UPDATED' : 'CREATED', docType: `${docTitle} Voucher (V2)`,
                    refNo: formData.refNo || 'N/A', amount: payload.totalAmount, voucherDate: formData.date, docId: docRef.id
                });
            });

            if (showToast) showToast({ type: 'success', title: 'Saved', message: `${docTitle} voucher recorded.` });
            if (initialData) onClose();
            else {
                setFormData(p => ({ ...p, refNo: '', narration: '' }));
                setRows([{ accountId: '', amount: '', narration: '' }]);
                setFocusField('source');
                setFocusIndex(0);
                setShowAcceptPrompt(false);
            }
        } catch (err) { console.error(err); alert('Error: ' + err.message); }
        finally { setSaving(false); }
    };

    if (!isOpen) return null;

    const sourceAcc = accounts.find(a => a.id === formData.sourceId);

    // Keyboard Flow Helpers
    const moveToNext = (v) => {
        if (focusField === 'refNo') {
            setFocusField('date');
        } else if (focusField === 'date') {
            setFocusField('source');
        } else if (focusField === 'source') {
            setFocusField('ledger');
            setFocusIndex(0);
        } else if (focusField === 'ledger') {
            if (!rows[focusIndex].accountId) {
                setFocusField('narration');
                setTimeout(() => narrationRef.current?.focus(), 50);
            } else {
                setFocusField('amount');
            }
        } else if (focusField === 'amount') {
            if (Number(rows[focusIndex].amount) > 0) {
                setRows(p => {
                    const n = [...p];
                    if (focusIndex === n.length - 1) n.push({ accountId: '', amount: '', narration: '' });
                    return n;
                });
                setFocusIndex(p => p + 1);
                setFocusField('ledger');
            } else {
                // If amount is 0/empty, focus the same field again or move to narration if it's not the first row
                if (focusIndex > 0) {
                    // Remove current empty row and go to narration
                    setRows(p => p.filter((_, idx) => idx !== focusIndex));
                    setFocusField('narration');
                    setTimeout(() => narrationRef.current?.focus(), 50);
                }
            }
        }
    };

    return createPortal(
        <>
            <div className="fixed inset-0 bg-white flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" style={{ zIndex, fontFamily: 'sans-serif' }}>
                {/* Standardized Header Toolbar */}
                <div className="flex-shrink-0 bg-gradient-to-r from-[#005ea8] to-[#00457c] border-b-2 border-[#003a68] px-5 py-2.5 flex items-center justify-between select-none shadow-xl">
                    <div className="flex items-center gap-6">
                        {/* 1. Identity */}
                        <div className="flex flex-col shrink-0 min-w-[140px]">
                            <span className="text-[9px] font-black text-blue-100 uppercase tracking-widest leading-none mb-1 opacity-70">Accounting Voucher</span>
                            <div className="relative group flex items-center bg-white/10 px-2.5 py-1 rounded-lg border border-white/20 cursor-pointer w-fit hover:bg-white/20 transition-all shadow-sm">
                                <span className="text-white font-extrabold text-sm uppercase leading-none pr-5">{docTitle}</span>
                                <div className="absolute right-1.5 pointer-events-none text-blue-200 group-hover:text-white transition-colors"><ChevronsUpDown size={12} strokeWidth={3} /></div>
                            </div>
                        </div>

                        {/* 2. Voucher Number */}
                        <div className="flex items-center gap-2 bg-black/20 p-1 px-2.5 rounded-lg border border-white/10 shadow-inner backdrop-blur-sm transition-all focus-within:ring-2 focus-within:ring-blue-400">
                            <span className="text-[10px] font-black text-blue-100 uppercase tracking-tight opacity-60">Vch No.</span>
                            <input 
                                ref={refNoRef}
                                className="bg-transparent border-none w-24 px-1.5 py-0.5 outline-none text-white font-black text-sm placeholder-white/30" 
                                value={formData.refNo || ''} 
                                onChange={e => setFormData(p => ({ ...p, refNo: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); moveToNext(); } }}
                                onFocus={() => setFocusField('refNo')}
                                placeholder="Ref..."
                            />
                        </div>

                        {/* 3. Tools Group */}
                        <div className={`flex items-center gap-3 bg-black/20 p-1 px-3 rounded-lg border shadow-inner backdrop-blur-sm transition-all ${focusField === 'date' ? 'border-yellow-400/50 ring-2 ring-yellow-400/20 bg-yellow-400/10' : 'border-white/10'}`}>
                            <div className="flex flex-col border-r border-white/10 pr-3">
                                <span className="text-[9px] font-black text-blue-100 uppercase tracking-tighter mb-0.5 opacity-60">Voucher Date</span>
                                <DateInput
                                    value={formData.date || ''}
                                    onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                                    onEnter={moveToNext}
                                    onFocus={() => setFocusField('date')}
                                    className="text-[11px] font-bold text-white bg-transparent border-none focus:ring-0 p-0 w-24 cursor-pointer"
                                />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-blue-100 uppercase tracking-tighter mb-0.5 opacity-60">Currency</span>
                                <select 
                                    className="text-[11px] font-bold text-cyan-300 bg-transparent border-none focus:ring-0 p-0 cursor-pointer"
                                    value={formData.currencyId || 'BASE'}
                                    onChange={e => {
                                        const v = e.target.value;
                                        setFormData(p => ({ ...p, currencyId: v, exchangeRate: v === 'BASE' ? 1 : p.exchangeRate }));
                                    }}
                                >
                                    <option value="BASE">{currencySymbol} (Base)</option>
                                    {currencies.map(c => (
                                        <option key={c.id} value={c.id}>{c.symbol} {c.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="bg-white/10 px-3 py-1 rounded-lg border border-white/10 hidden md:flex flex-col items-center">
                            <span className="text-[10px] font-bold text-white leading-none">{companyProfile.companyName || 'Main Company'}</span>
                            <span className="text-[8px] text-blue-200 uppercase font-black tracking-widest mt-0.5 opacity-60">Active Company</span>
                        </div>

                        <div className="w-px h-8 bg-white/10 mx-1"></div>
                    </div>
                </div>


                {/* Main Account Selection Area */}
                <div className="flex-shrink-0 bg-white px-8 py-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="text-[13px] font-medium w-32 mt-1">Account</div>
                        <div className="w-96 flex flex-col gap-1">
                            <span className="text-[13px] font-bold">:</span>
                            <TallySelect 
                                className="ml-2"
                                options={accounts.map(o => ({ value: o.id, text: o.name }))}
                                value={formData.sourceId}
                                focused={focusField === 'source'}
                                onChange={v => setFormData(p => ({ ...p, sourceId: v }))}
                                onEnter={moveToNext}
                            />
                            {sourceAcc && (
                                <div className="ml-4 text-[12px] italic text-slate-600 font-bold">
                                    Current balance : {Number(sourceAcc.balance || 0).toFixed(2).toLocaleString()} {Number(sourceAcc.balance || 0) >= 0 ? 'Dr' : 'Cr'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Rows Table */}
                <div className="flex-1 overflow-x-hidden overflow-y-auto bg-white flex flex-col border-t border-slate-300">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-300 text-[13px] font-bold bg-slate-50">
                                <th className="px-8 py-1.5 border-r border-slate-300">Particulars</th>
                                <th className="px-8 py-1.5 w-48 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, i) => {
                                const ledger = allLedgers.find(l => l.value === row.accountId);
                                return (
                                    <React.Fragment key={i}>
                                        <tr className="group">
                                            <td className="px-8 py-1.5 border-r border-slate-300 relative align-top">
                                                <TallySelect
                                                    options={allLedgers}
                                                    value={row.accountId}
                                                    focused={focusField === 'ledger' && focusIndex === i}
                                                    onChange={v => setRows(p => { const n = [...p]; n[i].accountId = v; return n; })}
                                                    onEnter={moveToNext}
                                                    placeholder=""
                                                />
                                                {ledger && (
                                                    <div className="ml-4 text-[11px] font-bold text-slate-400 italic mt-0.5">
                                                        Cur Bal: {Number(ledger.balance || 0).toFixed(2).toLocaleString()} {Number(ledger.balance || 0) >= 0 ? 'Dr' : 'Cr'}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-8 py-1.5 align-top">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className={`w-full text-right text-[14px] font-bold outline-none px-1 py-0.5 transition-colors ${focusField === 'amount' && focusIndex === i ? 'bg-[#fff59d] border-slate-400 border' : 'bg-transparent border border-transparent'}`}
                                                    value={row.amount}
                                                    onChange={e => setRows(p => { const n = [...p]; n[i].amount = e.target.value; return n; })}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            moveToNext();
                                                        }
                                                        if (e.key === 'Backspace' && row.amount === '') {
                                                            setFocusField('ledger');
                                                        }
                                                    }}
                                                    ref={el => { if (focusField === 'amount' && focusIndex === i && el) el.focus(); }}
                                                />
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                            {/* Fill empty rows to keep the Tally look */}
                            {[...Array(Math.max(0, 10 - rows.length))].map((_, i) => (
                                <tr key={`empty-${i}`}>
                                    <td className="px-8 py-3.5 border-r border-slate-300"></td>
                                    <td className="px-8 py-3.5"></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer and Narration Area */}
                <div className="flex-shrink-0 bg-gradient-to-r from-[#005ea8] to-[#00457c] border-t-2 border-[#003a68] p-5 space-y-4 shadow-[0_-8px_30px_rgba(0,0,0,0.2)]">
                    <div className="flex justify-between items-end bg-black/10 p-4 rounded-xl border border-white/5 shadow-inner">
                        <div className="flex-1 max-w-2xl flex items-start gap-4">
                            <span className="text-[13px] font-black text-blue-100 uppercase tracking-widest pt-1.5 opacity-70">Narration</span>
                            <span className="pt-1.5 text-[13px] font-black text-white">:</span>
                            <textarea
                                ref={narrationRef}
                                className={`flex-1 border-b border-white/10 text-[13px] font-bold outline-none px-2 py-1 resize-none h-16 transition-colors bg-transparent text-white placeholder-white/20 ${focusField === 'narration' ? 'bg-white/10 border-white/40' : ''}`}
                                value={formData.narration || ''}
                                onChange={e => setFormData(p => ({ ...p, narration: e.target.value }))}
                                placeholder="Enter transaction remarks..."
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        setShowAcceptPrompt(true);
                                    }
                                    if (e.key === 'Backspace' && formData.narration === '') {
                                        setFocusField('amount');
                                        setFocusIndex(rows.length -1);
                                    }
                                }}
                            />
                        </div>
                        <div className="text-right">
                            <div className="text-[24px] font-black text-black flex items-center gap-5 bg-white/95 px-6 py-2.5 rounded-xl shadow-2xl border border-white/20">
                                <span className="text-[10px] text-slate-500 uppercase tracking-[0.3em] font-black opacity-60">Total Amount:</span>
                                <span className="font-mono leading-none tracking-tighter">{currencySymbol} {totals.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                            <button onClick={onClose} className="bg-white/10 hover:bg-red-500/80 text-white px-6 py-2 text-[12px] font-black uppercase tracking-widest border border-white/20 rounded shadow-sm transition-all active:scale-95 flex items-center gap-2">
                                <X size={14} /> ESC: Quit
                            </button>
                            <button onClick={() => setShowGenModal(true)} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 text-[12px] font-black uppercase tracking-widest border border-white/20 rounded shadow-sm transition-all active:scale-95 flex items-center gap-2">
                                <Printer size={14} /> P: Print
                            </button>
                            <button onClick={() => {/* Download Logic */}} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 text-[12px] font-black uppercase tracking-widest border border-white/20 rounded shadow-sm transition-all active:scale-95 flex items-center gap-2">
                                <Download size={14} /> D: Download
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <button 
                                ref={saveButtonRef}
                                onClick={() => setShowAcceptPrompt(true)} 
                                onKeyDown={e => { if (e.key === 'Enter') setShowAcceptPrompt(true); }}
                                className="bg-white text-[#00457c] hover:bg-blue-50 px-10 py-2 text-[12px] font-black uppercase tracking-[0.2em] rounded-lg shadow-[0_4px_14px_0_rgba(255,255,255,0.2)] transition-all active:scale-95 flex items-center gap-2"
                            >
                                <Save size={16} /> A: Accept Transaction
                            </button>
                        </div>
                    </div>
                </div>


                {/* Tally Style Accept Prompt */}
                {showAcceptPrompt && (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/10 backdrop-blur-[1px]">
                        <div className="bg-white border-2 border-[#1a237e] shadow-2xl p-6 min-w-[280px] animate-in slide-in-from-bottom-5 duration-100">
                            <div className="text-[18px] font-bold text-slate-800 text-center mb-6">Accept?</div>
                            <div className="flex items-center justify-center gap-4">
                                <button 
                                    autoFocus
                                    onClick={handleSave} 
                                    className="bg-[#2196f3] text-white px-10 py-1.5 text-[13px] font-black border border-[#1976d2] shadow-sm hover:bg-[#1e88e5]"
                                    onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'n' || e.key === 'N') setShowAcceptPrompt(false); }}
                                >
                                    Yes
                                </button>
                                <button 
                                    onClick={() => setShowAcceptPrompt(false)} 
                                    className="bg-slate-100 text-slate-800 px-10 py-1.5 text-[13px] font-black border border-slate-300 shadow-sm hover:bg-slate-200"
                                >
                                    No
                                </button>
                            </div>
                            <div className="mt-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">Alt+S to quick save</div>
                        </div>
                    </div>
                )}

                {saving && (
                    <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm">
                        <Loader2 className="animate-spin text-[#1a237e] mb-2" size={32} />
                        <span className="text-[14px] font-bold text-[#1a237e]">Saving Transaction...</span>
                    </div>
                )}
            </div>

            <DocumentGeneratorV2
                isOpen={showGenModal} onClose={() => setShowGenModal(false)}
                data={{ ...formData, rows, totalAmount: totals, type, currencySymbol }}
                type={type} companyProfile={companyProfile} dataOwnerId={dataOwnerId} user={user} zIndex={zIndex + 10}
            />
        </>
        , document.body
    );
};

export default FinanceVoucherV2;
