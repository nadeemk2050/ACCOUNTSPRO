/**
 * ReportsV2.jsx — Premium TallyPrime & Oracle-inspired Reporting Engine
 * Supporting Day Book, Ledgers, Registers, Summaries, and Entity Lists.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Search, Filter, Printer, Download, ArrowRight,
    Calendar, ChevronDown, ChevronRight, ChevronLeft, FileText,
    TrendingUp, TrendingDown, Wallet, BookOpen,
    Eye, LayoutGrid, List, BarChart3, Maximize2,
    CheckCircle2, AlertCircle, Loader2, Hash, ArrowUpRight,
    MoreVertical, Info, Heart, Star, Wrench, Package,
    ShoppingBag, Building2, Coins, ReceiptText, ShieldAlert,
    Trash, Layers, User as UserIcon, CalendarDays, ArrowLeft,
    UserCircle, Briefcase, Globe
} from 'lucide-react';
import {
    collection, query, where, getDocs, onSnapshot, doc
} from 'firebase/firestore';
import { db } from './firebase';

// ── V2 Styling Tokens ──
const headerGrad = 'from-[#0f172a] via-[#1e293b] to-[#0f172a]';
const cardBg = 'bg-white/5 backdrop-blur-md border border-white/10';
const activeTabClass = 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 border-blue-500';
const inactiveTabClass = 'text-slate-400 hover:text-white hover:bg-white/5 border-transparent';

// ── Helper Components ──
const StatCard = ({ label, value, icon: Icon, color, subValue, trend }) => (
    <div className={`${cardBg} rounded-2xl p-4 flex-1 min-w-[200px] transition-all hover:scale-[1.02] hover:border-white/20 group animate-in fade-in duration-500`}>
        <div className="flex justify-between items-start mb-2">
            <div className={`p-2 rounded-xl ${color} bg-opacity-20 transition-transform group-hover:rotate-12 duration-500`}>
                <Icon size={18} className={color.replace('bg-', 'text-')} />
            </div>
            {trend !== undefined && (
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                    {trend > 0 ? '+' : ''}{trend}%
                </div>
            )}
        </div>
        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 group-hover:text-slate-300 transition-colors">{label}</div>
        <div className="text-xl font-black text-white tracking-tight">{value}</div>
        {subValue && <div className="text-[10px] text-slate-400 mt-1 font-medium">{subValue}</div>}
    </div>
);

const ReportsV2 = ({
    isOpen, onClose, onBack, zIndex = 200,
    user, dataOwnerId, userRole, effectiveName, // ✅ ADDED THIS
    parties = [], products = [], expenses = [], incomeAccounts = [],
    accounts = [], capitalAccounts = [], assetAccounts = [], taxRates = [],
    subUsers = [], initialState, onViewTransaction, onDeleteTransaction,
    currencySymbol = 'AED', units = []
}) => {
    // ── State ──
    const [filter, setFilter] = useState({ type: 'daybook', id: '', startDate: '', endDate: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('detailed'); // 'detailed' | 'monthly' | 'entities' | 'chart'
    const [loading, setLoading] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [entitiesWithBalances, setEntitiesWithBalances] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [sortOrder, setSortOrder] = useState('date_asc');
    const [showSearch, setShowSearch] = useState(false);
    const [expandDetails, setExpandDetails] = useState(false);
    const [showDateOptionsMenu, setShowDateOptionsMenu] = useState(false);
    const [durationType, setDurationType] = useState('daywise');
    const ITEMS_PER_PAGE = 50;

    // ── Pre-fetch / Initial State ──
    useEffect(() => {
        if (isOpen) {
            const today = new Date().toISOString().split('T')[0];
            if (initialState) {
                const updatedFilter = { 
                    ...initialState, 
                    startDate: initialState.startDate || today,
                    endDate: initialState.endDate || today 
                };
                setFilter(updatedFilter);
                
                // If special register type, we might want 'entities' view mode
                if (initialState.type === 'party_register' || initialState.type === 'customer_register') {
                    setViewMode('entities');
                } else {
                    setViewMode('detailed');
                }
                
                generateReport(updatedFilter);
            } else {
                const startOfMonth = today.substring(0, 8) + '01';
                const defaultFilter = { type: 'daybook', id: '', startDate: startOfMonth, endDate: today };
                setFilter(defaultFilter);
                setViewMode('detailed');
                generateReport(defaultFilter);
            }
        }
    }, [isOpen, initialState]);

    const safeNum = (v) => isNaN(Number(v)) ? 0 : Number(v);
    const formatAmt = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatDate = (d) => { if (!d) return '-'; const [y, m, d1] = d.split('-'); return `${d1}/${m}/${y}`; };

    const findName = (id) => {
        if (!id) return '';
        const allEnt = [...parties, ...accounts, ...expenses, ...incomeAccounts, ...capitalAccounts, ...assetAccounts, ...products, ...taxRates];
        return allEnt.find(x => x.id === id)?.name || id;
    };

    // --- KEYBOARD SHORTCUTS ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;
            
            // Alt+D Toggle Details
            if (e.altKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                setExpandDetails(prev => !prev);
            }

            // H Cycle Modes
            if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
                    const modes = ['detailed', 'monthly'];
                    const next = modes[(modes.indexOf(viewMode) + 1) % modes.length];
                    if (viewMode !== 'entities') {
                        setViewMode(next);
                        setCurrentPage(1);
                    }
                }
            }

            // S Search Toggle
            if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
                    setShowSearch(prev => !prev);
                }
            }

            // ESC Close
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, viewMode]);
    const toIsoDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const parseIsoDate = (isoDate) => {
        if (!isoDate) return null;
        const [y, m, d] = isoDate.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d, 12, 0, 0);
    };

    const addDaysToIso = (isoDate, days) => {
        const base = parseIsoDate(isoDate);
        if (!base) return isoDate;
        base.setDate(base.getDate() + days);
        return toIsoDate(base);
    };

    const moveDateRange = (direction) => {
        setFilter(prev => {
            const today = toIsoDate(new Date());
            const startStr = prev.startDate || today;
            const endStr = prev.endDate || today;
            
            let newStart = startStr;
            let newEnd = endStr;

            if (durationType === 'daywise') {
                newStart = addDaysToIso(startStr, direction);
                newEnd = newStart;
            } else if (durationType === 'weekly') {
                newStart = addDaysToIso(startStr, direction * 7);
                newEnd = addDaysToIso(newStart, 6);
            } else if (durationType === 'monthly') {
                const d = parseIsoDate(startStr);
                if (d) {
                    d.setMonth(d.getMonth() + direction);
                    d.setDate(1);
                    newStart = toIsoDate(d);
                    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                    newEnd = toIsoDate(lastDay);
                }
            } else if (durationType === 'quarterly') {
                const d = parseIsoDate(startStr);
                if (d) {
                    const qStartMonth = Math.floor(d.getMonth() / 3) * 3 + (direction * 3);
                    const qStart = new Date(d.getFullYear(), qStartMonth, 1);
                    newStart = toIsoDate(qStart);
                    const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
                    newEnd = toIsoDate(qEnd);
                }
            } else if (durationType === 'annually') {
                const d = parseIsoDate(startStr);
                if (d) {
                    const yStart = new Date(d.getFullYear() + direction, 0, 1);
                    newStart = toIsoDate(yStart);
                    const yEnd = new Date(yStart.getFullYear(), 11, 31);
                    newEnd = toIsoDate(yEnd);
                }
            } else {
                newStart = addDaysToIso(startStr, direction);
                newEnd = addDaysToIso(endStr, direction);
            }

            const updated = { ...prev, startDate: newStart, endDate: newEnd };
            generateReport(updated);
            return updated;
        });
    };

    const handleDurationChange = (type) => {
        setDurationType(type);
        const today = new Date();
        let start = toIsoDate(today);
        let end = toIsoDate(today);

        if (type === 'weekly') {
            const day = today.getDay();
            const diffToFri = (day + 2) % 7; 
            const fri = new Date(today);
            fri.setDate(today.getDate() - diffToFri);
            start = toIsoDate(fri);
            const thu = new Date(fri);
            thu.setDate(fri.getDate() + 6);
            end = toIsoDate(thu);
        } else if (type === 'monthly') {
            start = toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
            end = toIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        } else if (type === 'quarterly') {
            const qMonth = Math.floor(today.getMonth() / 3) * 3;
            start = toIsoDate(new Date(today.getFullYear(), qMonth, 1));
            end = toIsoDate(new Date(today.getFullYear(), qMonth + 3, 0));
        } else if (type === 'annually') {
            start = `${today.getFullYear()}-01-01`;
            end = `${today.getFullYear()}-12-31`;
        } else if (type === 'all') {
            start = ''; end = '';
        }

        const updated = { ...filter, startDate: start, endDate: end };
        setFilter(updated);
        generateReport(updated);
    };

    const generateReport = async (activeFilterArg) => {
        const activeFilter = activeFilterArg || filter;
        setLoading(true);
        setTransactions([]);
        
        const targetUid = dataOwnerId || user?.uid;
        if (!targetUid) return;

        try {
            // Broader fetch for historical accuracy
            const baseConstraints = [where('userId', '==', targetUid)];
            // No role-based createdBy filter. All roles see all data within company.

            const [invSnap, paySnap, jvSnap, mfgSnap] = await Promise.all([
                getDocs(query(collection(db, 'invoices'), ...baseConstraints)),
                getDocs(query(collection(db, 'payments'), ...baseConstraints)),
                getDocs(query(collection(db, 'journal_vouchers'), ...baseConstraints)),
                getDocs(query(collection(db, 'stock_journals'), ...baseConstraints))
            ]);

            const buildRow = (doc, d) => {
                const baseVal = safeNum(d.grandTotal || d.totalAmount || d.amount || 0);
                const totalQty = (d.items || []).reduce((s, it) => s + safeNum(it.quantity || it.qty), 0);
                const avgRate = totalQty > 0 ? (baseVal / totalQty) : 0;
                let drName = '-', crName = '-', typeLabel = (d.type || 'Vch').toUpperCase();
                let amtIn = 0, amtOut = 0;
                let vchType = d.type || 'voucher';

                if (d.type === 'sales') { 
                    drName = d.partyName || findName(d.partyId); crName = 'Sales Account'; typeLabel = 'SALES INV'; amtIn = baseVal; 
                } else if (d.type === 'purchase') { 
                    drName = 'Purchase Account'; crName = d.partyName || findName(d.partyId); typeLabel = 'PURCHASE INV'; amtOut = baseVal; 
                } else if (d.type === 'in' || d.type === 'receipt') { 
                    drName = accounts.find(a => a.id === d.accountId)?.name || 'Cash/Bank'; crName = d.partyName || findName(d.partyId) || 'Payer'; typeLabel = 'RECEIPT'; amtIn = baseVal;
                } else if (d.type === 'out' || d.type === 'payment') { 
                    drName = d.partyName || findName(d.partyId || d.expenseId || d.assetId || d.capitalId) || 'Payee'; crName = accounts.find(a => a.id === d.accountId)?.name || 'Cash/Bank'; typeLabel = 'PAYMENT'; amtOut = baseVal;
                } else if (d.type === 'contra') { 
                    drName = findName(d.toAccountId); crName = findName(d.accountId); typeLabel = 'CONTRA'; amtIn = (d.toAccountId === activeFilter.id) ? baseVal : 0; amtOut = (d.accountId === activeFilter.id) ? baseVal : 0;
                } else if (d.type === 'journal') { 
                    drName = findName(d.drId); crName = findName(d.crId); typeLabel = 'JOURNAL'; amtIn = (d.drId === activeFilter.id) ? baseVal : 0; amtOut = (d.crId === activeFilter.id) ? baseVal : 0;
                } else if (d.type === 'manufacturing') { 
                    drName = 'Mfg Output'; crName = 'Mfg Input'; typeLabel = 'MFG JOURNAL'; amtIn = baseVal;
                }

                // --- GENERATE DETAILED VIEW CONTENT (The "Alt+D" Details) ---
                const detailedItems = [];
                
                // 1. Single-mode Target
                if (!d.isMulti && !d.rows) {
                   const singleId = d.partyId || d.expenseId || d.assetId || d.capitalId || d.incomeId || d.toAccountId || d.drId || d.crId;
                   if (singleId) {
                       const targetName = findName(singleId);
                       detailedItems.push({ label: targetName, value: formatAmt(baseVal) });
                   }
                }

                // 2. Items (Products)
                const items = d.items || (d.type === 'manufacturing' ? [...(d.produced || []), ...(d.consumed || [])] : []);
                items.forEach(it => {
                    const itemName = products.find(p => p.id === it.productId)?.name || it.productId || 'Unknown Item';
                    const qty = safeNum(it.quantity || it.qty);
                    const rate = safeNum(it.rate);
                    const weight = it.weight ? `[${it.weight}]` : '';
                    if (qty > 0) detailedItems.push({ label: `${itemName} ${weight}`, value: `${qty.toLocaleString()} @ ${rate.toLocaleString()}` });
                });

                // 3. Splits / Multiple Accounts
                const splits = d.splits || d.rows || [];
                splits.forEach(s => {
                    const sid = s.targetId || s.id || s.partyId || s.accountId || s.expenseId || s.assetId || s.capitalId || s.incomeId;
                    const sname = findName(sid);
                    const samt = safeNum(s.amount);
                    if (samt > 0) detailedItems.push({ label: sname, value: formatAmt(samt) });
                });

                // 4. Tax & Expenses
                if (safeNum(d.taxAmount) > 0) detailedItems.push({ label: `Tax: ${d.taxName || 'VAT'}`, value: formatAmt(d.taxAmount) });
                (d.expenses || []).forEach(ex => { detailedItems.push({ label: findName(ex.expenseId), value: formatAmt(ex.amount) }); });
                
                // 5. Remark
                if (d.narration || d.description) detailedItems.push({ label: "Remark/Cause", value: d.narration || d.description });

                return {
                    id: doc.id, date: d.date || '', ref: d.refNo || d.invoiceNo || 'N/A',
                    vchType: typeLabel, vType: d.type, drName, crName,
                    particulars: d.partyName || findName(d.partyId) || `${drName} / ${crName}`,
                    qty: ['sales', 'purchase'].includes(d.type) ? totalQty : 0,
                    rate: ['sales', 'purchase'].includes(d.type) ? avgRate : 0,
                    amount: ['sales', 'purchase'].includes(d.type) ? baseVal : 0,
                    amountIn: amtIn, amountOut: amtOut, total: baseVal,
                    details: detailedItems,
                    narration: d.narration || d.description || '',
                    partyId: d.partyId, accountId: d.accountId,
                    searchStr: `${d.refNo} ${drName} ${crName} ${d.narration || ''} ${typeLabel}`.toLowerCase()
                };
            };

            const allTx = [];
            const rawProcess = (snap) => {
                snap.forEach(doc => {
                    const row = buildRow(doc, doc.data());
                    const d = doc.data();

                    if (activeFilter.type === 'daybook' || activeFilter.type === 'user') {
                        if (activeFilter.type === 'user' && d.createdBy !== activeFilter.id) return;
                        allTx.push(row);
                    } else if (activeFilter.type === 'sales' && d.type === 'sales') {
                        allTx.push(row);
                    } else if (activeFilter.type === 'purchase' && d.type === 'purchase') {
                        allTx.push(row);
                    } else if (activeFilter.type === 'party' && d.partyId === activeFilter.id) {
                        const isDr = ['sales', 'out', 'payment'].includes(d.type);
                        allTx.push({ ...row, amountIn: isDr ? row.total : 0, amountOut: !isDr ? row.total : 0 });
                    } else if (activeFilter.type === 'account' && d.accountId === activeFilter.id) {
                        const isDr = ['in', 'receipt'].includes(d.type) || (d.type === 'contra' && d.toAccountId === d.accountId);
                        allTx.push({ ...row, amountIn: isDr ? row.total : 0, amountOut: !isDr ? row.total : 0 });
                    } else if (activeFilter.type === 'item') {
                        if (docType === 'jv') return; // ✅ Ignore JVs in Item Ledger

                        const itemsToProcess = d.items || (d.type === 'manufacturing' ? [...(d.produced || []), ...(d.consumed || [])] : []);
                        const matched = itemsToProcess.filter(i => i.productId === activeFilter.id) || [];
                        
                        if (matched.length > 0) {
                            const qTotal = matched.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                            const valTotal = matched.reduce((s, i) => s + (Number(i.quantity) * Number(i.rate) || 0), 0);
                            
                            // Determine Direction
                            let isInward = ['purchase', 'in', 'sales_return', 'credit_note'].includes(d.type);
                            let isOutward = ['sales', 'out', 'purchase_return', 'debit_note'].includes(d.type);

                            // For MFG: we check if this specific item is in 'produced' (In) or 'consumed' (Out)
                            if (d.type === 'manufacturing') {
                                const pQty = (d.produced || []).filter(i => i.productId === activeFilter.id).reduce((s, i) => s+Number(i.quantity), 0);
                                const cQty = (d.consumed || []).filter(i => i.productId === activeFilter.id).reduce((s, i) => s+Number(i.quantity), 0);
                                const pVal = (d.produced || []).filter(i => i.productId === activeFilter.id).reduce((s, i) => s + (Number(i.quantity) * Number(i.rate)), 0);
                                const cVal = (d.consumed || []).filter(i => i.productId === activeFilter.id).reduce((s, i) => s + (Number(i.quantity) * Number(i.rate)), 0);

                                allTx.push({ ...row, amountIn: pVal, amountOut: cVal, qtyIn: pQty, qtyOut: cQty });
                            } else {
                                allTx.push({ 
                                    ...row, 
                                    amountIn: isInward ? valTotal : 0, 
                                    amountOut: isOutward ? valTotal : 0, 
                                    qtyIn: isInward ? qTotal : 0, 
                                    qtyOut: isOutward ? qTotal : 0 
                                });
                            }
                        }
                    } else if (['party_register', 'customer_register', 'account_register'].includes(activeFilter.type)) {
                        // We need all transactions to calc balances per party
                        allTx.push(row);
                    }
                });
            };

            rawProcess(invSnap); rawProcess(paySnap); rawProcess(jvSnap); rawProcess(mfgSnap);
            allTx.sort((a, b) => new Date(a.date) - new Date(b.date));

            const startStr = activeFilter.startDate || '0000-00-00';
            const endStr = activeFilter.endDate || '9999-99-99';

            if (['party_register', 'customer_register', 'account_register'].includes(activeFilter.type)) {
                // Calculate Balances for all relevant entities
                const balances = {};
                const sourceList = activeFilter.type === 'account_register' ? accounts : parties;
                
                sourceList.forEach(e => { balances[e.id] = { ...e, balance: 0, count: 0 }; });

                allTx.forEach(t => {
                    if (t.date > endStr) return; // Future
                    if (activeFilter.type === 'account_register') {
                        if (t.accountId && balances[t.accountId]) {
                            const isDr = ['in', 'receipt'].includes(t.vType) || (t.vType === 'contra' && t.toAccountId === t.accountId);
                            balances[t.accountId].balance += (isDr ? t.total : -t.total);
                            balances[t.accountId].count++;
                        }
                    } else {
                        if (t.partyId && balances[t.partyId]) {
                            const isDr = ['sales', 'out', 'payment'].includes(t.vType);
                            balances[t.partyId].balance += (isDr ? t.total : -t.total);
                            balances[t.partyId].count++;
                        }
                    }
                });
                setEntitiesWithBalances(Object.values(balances).filter(b => b.count > 0 || b.balance !== 0));
                setTransactions([]); // Clear transactional list if in register mode
            } else {
                let openingBal = 0; let openingQty = 0;
                const currentPeriod = [];
                allTx.forEach(t => {
                    if (t.date < startStr) {
                        openingBal += (t.amountIn - t.amountOut);
                        openingQty += (safeNum(t.qtyIn) - safeNum(t.qtyOut));
                    } else if (t.date <= endStr) {
                        currentPeriod.push(t);
                    }
                });

                if (activeFilter.id) { // Single Ledger
                    const opRow = { id: 'OP_BAL', date: startStr, vchType: 'OPENING', drName: 'Opening Balance', crName: 'B/F', amountIn: openingBal > 0 ? openingBal : 0, amountOut: openingBal < 0 ? Math.abs(openingBal) : 0, qtyIn: openingQty > 0 ? openingQty : 0, qtyOut: openingQty < 0 ? Math.abs(openingQty) : 0, isOpening: true, total: Math.abs(openingBal) };
                    setTransactions([opRow, ...currentPeriod]);
                } else {
                    setTransactions(currentPeriod);
                }
            }

        } catch (err) {
            console.error("Report generation failed:", err);
        } finally {
            setLoading(false);
        }
    };

    const { processedData, summary, monthlySummary } = useMemo(() => {
        let runningBal = 0; let runningQty = 0;
        let filtered = transactions.filter(t => !searchTerm || t.searchStr?.includes(searchTerm.toLowerCase()));
        const mapped = filtered.map(t => {
            runningBal += (t.amountIn - t.amountOut); runningQty += (safeNum(t.qtyIn) - safeNum(t.qtyOut));
            return { ...t, runningBal, runningQty };
        });
        const sum = mapped.reduce((acc, t) => {
            if (!t.isOpening) {
                acc.in += t.amountIn;
                acc.out += t.amountOut;
                acc.qIn += safeNum(t.qtyIn);
                acc.qOut += safeNum(t.qtyOut);
                acc.totalQty += safeNum(t.qty);
                acc.totalAmount += safeNum(t.amount);
            }
            return acc;
        }, { in: 0, out: 0, qIn: 0, qOut: 0, totalQty: 0, totalAmount: 0, count: mapped.length });
        const months = {};
        mapped.forEach(t => { if (t.isOpening) return; const m = t.date.substring(0, 7); if (!months[m]) months[m] = { m, in: 0, out: 0 }; months[m].in += t.amountIn; months[m].out += t.amountOut; });
        return { 
            processedData: sortOrder === 'date_desc' ? [...mapped].reverse() : mapped, 
            summary: sum,
            monthlySummary: Object.values(months).sort((a,b) => a.m.localeCompare(b.m))
        };
    }, [transactions, searchTerm, sortOrder]);

    const filteredEntities = useMemo(() => {
        return entitiesWithBalances.filter(e => !searchTerm || e.name?.toLowerCase().includes(searchTerm.toLowerCase())).sort((a,b) => b.balance - a.balance);
    }, [entitiesWithBalances, searchTerm]);

    if (!isOpen) return null;

    const reportTitle = (filter.type === 'daybook' ? 'Day Book' : (filter.type === 'sales' ? 'Sales Register' : (filter.type === 'purchase' ? 'Purchase Register' : (filter.type === 'customer_register' ? 'Customers Balances' : (filter.id ? findName(filter.id) : 'Modern Ledger')))));
    const isSalesPurchaseRegister = ['sales', 'purchase'].includes(filter.type);

    return createPortal(
        <div className="fixed inset-0 bg-white text-slate-900 flex flex-col overflow-hidden animate-in fade-in duration-300 font-sans" style={{ zIndex }}>
            
            {/* Standardized Header Toolbar - Top Line Theme Style */}
            <div className="flex-shrink-0 bg-slate-50 border-b border-slate-200 px-5 py-2 flex items-center justify-between select-none shadow-sm z-50">
                <div className="flex items-center gap-4">
                    {/* 1. Identity */}
                    <div className="flex flex-col shrink-0 min-w-[140px]">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">System Report</span>
                        <div className="bg-blue-50 px-2 py-1 rounded border border-blue-200 w-fit">
                            <span className="text-blue-900 font-extrabold text-sm uppercase leading-none">{reportTitle}</span>
                        </div>
                    </div>

                    {/* 2. Tool Groups */}
                    <div className="flex items-center gap-1.5 bg-white p-0.5 rounded border border-slate-200 shadow-sm overflow-hidden">
                        {/* Duration Navigator */}
                        <div className="flex items-center">
                            <button onClick={() => moveDateRange(-1)} className="p-1 px-1.5 hover:bg-blue-50 text-blue-600 border-r border-slate-100 transition-colors"><ChevronLeft size={12} /></button>
                            <button 
                                onClick={() => setShowDateOptionsMenu(true)} 
                                className="flex flex-col items-center px-4 py-0.5 hover:bg-slate-50 transition-colors group"
                            >
                                <span className="text-[7.5px] font-black text-slate-400 uppercase tracking-tighter leading-none mb-0.5">Report Duration</span>
                                <div className="flex items-center gap-1">
                                    <span className="text-[9px] font-black text-blue-900 uppercase">{durationType}:</span>
                                    <span className="text-[9.5px] font-black text-slate-700">{formatDate(filter.startDate)} — {formatDate(filter.endDate)}</span>
                                    <ChevronDown size={8} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                                </div>
                            </button>
                            <button onClick={() => moveDateRange(1)} className="p-1 px-1.5 hover:bg-blue-50 text-blue-600 border-l border-slate-100 transition-colors"><ChevronRight size={12} /></button>
                        </div>

                        {/* Search Group */}
                        <div className="flex items-center gap-1.5 px-3 border-l border-slate-100">
                            <Search size={11} className="text-slate-300" />
                            <input 
                                type="text" 
                                placeholder="LOOKUP..." 
                                className="w-28 text-[9.5px] font-black border-none bg-transparent focus:ring-0 p-0 uppercase placeholder:text-slate-300" 
                                value={searchTerm} 
                                onChange={e => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>

                    {/* Action Tools */}
                    <div className="flex items-center gap-1.5 bg-white p-1 rounded border border-slate-200 shadow-sm">
                        <button onClick={() => setExpandDetails(!expandDetails)} className={`px-3 py-1 rounded transition-all text-[9px] font-black uppercase tracking-tighter ${expandDetails ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-blue-600'}`}>
                            {expandDetails ? 'CONDENSED (ALT+D)' : 'DETAILED (ALT+D)'}
                        </button>
                        <button onClick={() => {
                            const modes = ['detailed', 'monthly'];
                            const next = modes[(modes.indexOf(viewMode) + 1) % modes.length];
                            if (viewMode !== 'entities') setViewMode(next);
                        }} className="px-3 py-1 hover:bg-slate-100 rounded text-[9px] font-black text-slate-500 uppercase tracking-tighter transition-colors">
                            VIEW: {viewMode === 'detailed' ? 'MONTHLY' : 'DAILY'}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-blue-900/5 px-3 py-1 rounded border border-blue-100 hidden lg:flex flex-col items-center">
                        <span className="text-[10px] font-bold text-blue-900">{effectiveName || 'Admin'}</span>
                        <span className="text-[8px] text-blue-400 uppercase font-black tracking-widest leading-none mt-0.5">Session User</span>
                    </div>

                    <div className="w-px h-8 bg-slate-200 mx-1"></div>

                </div>
            </div>

            {/* Sub-Header: Expanded Search Panel */}
            {showSearch && (
                <div className="bg-[#eff6ff] px-4 py-2 border-b border-blue-200 animate-in slide-in-from-top-2">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" size={14} />
                        <input 
                            type="text" autoFocus
                            placeholder="Type to filter transactions..."
                            className="w-full bg-white border border-blue-300 rounded pl-9 pr-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[#2b5797] shadow-sm"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            )}

            {/* ── MAIN CONTENT ── */}
            <div className="flex-1 flex flex-col overflow-hidden">
                
            {/* ── TALLY-STYLE SUMMARY STRIP ── */}
            {!loading && (
                <div className="bg-[#fcf8e3] border-b border-[#e6db55] px-4 py-1 flex items-center justify-between text-[11px] font-bold text-slate-700 select-none">
                    <div className="flex gap-8">
                        <div className="flex gap-2 items-baseline">
                            <span className="text-[10px] opacity-60 uppercase">Records:</span>
                            <span className="text-[#2b5797]">{viewMode === 'entities' ? filteredEntities.length : summary.count}</span>
                        </div>
                        {isSalesPurchaseRegister ? (
                            <>
                                <div className="flex gap-2 items-baseline">
                                    <span className="text-[10px] opacity-60 uppercase">Total Amount:</span>
                                    <span className="text-emerald-700">{currencySymbol} {formatAmt(summary.totalAmount)}</span>
                                </div>
                                <div className="flex gap-2 items-baseline">
                                    <span className="text-[10px] opacity-60 uppercase">Total Qty:</span>
                                    <span className="text-[#2b5797]">{Number(summary.totalQty || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex gap-2 items-baseline">
                                    <span className="text-[10px] opacity-60 uppercase">Total In:</span>
                                    <span className="text-emerald-700">{currencySymbol} {formatAmt(summary.in)}</span>
                                </div>
                                <div className="flex gap-2 items-baseline">
                                    <span className="text-[10px] opacity-60 uppercase">Total Out:</span>
                                    <span className="text-rose-700">{currencySymbol} {formatAmt(summary.out)}</span>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="flex gap-4 items-center">
                        {!isSalesPurchaseRegister && (
                            <div className="flex items-center gap-2">
                                 <span className="text-[10px] opacity-60 uppercase">Net Balance:</span>
                                 <span className={`text-[13px] font-black ${ (summary.in - summary.out) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {currencySymbol} {formatAmt(Math.abs(summary.in - summary.out))} {(summary.in - summary.out) >= 0 ? 'Dr' : 'Cr'}
                                 </span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── MAIN DATA AREA ── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
                    
                    {/* View Switcher Bar */}
                    <div className="px-8 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center gap-1.5 bg-black/40 p-1.5 rounded-2xl border border-white/5 shadow-inner">
                            {[
                                { id: 'detailed', label: 'Detailed Ledger', icon: List, hide: viewMode === 'entities' },
                                { id: 'entities', label: 'Entity List', icon: UserCircle, show: viewMode === 'entities' },
                                { id: 'monthly', label: 'Monthly Summary', icon: LayoutGrid },
                                { id: 'chart', label: 'Analytics Pro', icon: BarChart3 }
                            ].map(tab => ( (tab.show || !tab.hide) && 
                                <button key={tab.id} onClick={() => setViewMode(tab.id)} className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 ${viewMode === tab.id ? activeTabClass : inactiveTabClass}`}>
                                    <tab.icon size={14} className={viewMode === tab.id ? 'text-white' : 'text-slate-500'} /> {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-6 items-center">
                            {viewMode === 'detailed' && (
                                <div className="flex items-center gap-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-white/5 pr-6">
                                    <span className="opacity-50">Sort Protocol:</span>
                                    <select className="bg-transparent text-blue-400 outline-none cursor-pointer hover:text-white transition-colors" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                                        <option value="date_asc">Ascending Date</option>
                                        <option value="date_desc">Descending Date</option>
                                    </select>
                                </div>
                            )}
                            <div className="text-[10px] font-black text-slate-500 flex items-center gap-3 uppercase tracking-widest">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)] animate-pulse"></span>
                                <span>{viewMode === 'entities' ? filteredEntities.length : summary.count} Computed Records</span>
                            </div>
                        </div>
                    </div>

                    {/* Content Views */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {loading ? (
                            <div className="h-full flex flex-col items-center justify-center gap-6">
                                <div className="relative w-24 h-24"><Loader2 size={64} className="text-blue-500 animate-spin absolute inset-0 m-auto" /><div className="absolute inset-0 rounded-full border-4 border-blue-500/20 animate-ping"></div></div>
                                <div className="text-sm font-black text-slate-500 animate-pulse uppercase tracking-[0.4em]">Optimizing Queries...</div>
                            </div>
                        ) : viewMode === 'entities' ? (
                            <table className="w-full text-left border-collapse table-fixed">
                                <thead>
                                    <tr className="bg-[#dceaff] text-[#2b5797] text-[10px] font-black uppercase tracking-widest border-b border-blue-300 shadow-sm">
                                        <th className="px-4 py-3 w-12 text-center">#</th>
                                        <th className="px-5 py-3 flex-1 text-left">Entity / Account Name</th>
                                        <th className="px-5 py-3 w-44 text-left">Contact / Info</th>
                                        <th className="px-5 py-3 w-32 text-center border-l border-blue-200">Trx Count</th>
                                        <th className="px-8 py-3 w-52 text-right bg-blue-50/50 border-l border-blue-200">Balance</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.03]">
                                    {filteredEntities.map((e, idx) => (
                                        <tr key={e.id} onClick={() => { setFilter({ ...filter, type: filter.type === 'account_register' ? 'account' : 'party', id: e.id }); setViewMode('detailed'); generateReport({ ...filter, type: filter.type === 'account_register' ? 'account' : 'party', id: e.id }); }} className="group hover:bg-blue-600/5 transition-all cursor-pointer border-b border-white/[0.02]">
                                            <td className="px-8 py-5 text-center text-[11px] font-black text-slate-600 group-hover:text-blue-400">{idx + 1}</td>
                                            <td className="px-5 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 flex items-center justify-center text-blue-400 font-black text-sm border border-blue-500/20 shadow-inner">{(e.name || "?")[0]}</div>
                                                    <div className="flex flex-col"><span className="text-sm font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">{e.name}</span><span className="text-[10px] text-slate-500 uppercase tracking-widest">{e.companyName || 'Individual Account'}</span></div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-5 text-[11px] text-slate-400 font-bold">{e.mobileNumber || e.email || '—'}</td>
                                            <td className="px-5 py-5 text-center text-[12px] font-black text-blue-300">{e.count}</td>
                                            <td className={`px-8 py-5 text-right text-[15px] font-black bg-white/[0.01] group-hover:bg-blue-600/10 transition-all ${e.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatAmt(Math.abs(e.balance))} <span className="text-[10px] ml-1 opacity-50">{e.balance >= 0 ? 'Dr' : 'Cr'}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : viewMode === 'detailed' ? (
                            <table className="w-full text-left border-collapse table-fixed">
                                <thead className="sticky top-0 z-20">
                                    {isSalesPurchaseRegister ? (
                                        <tr className="bg-[#dceaff] text-[#2b5797] text-[10px] font-black uppercase tracking-widest border-b border-blue-300 shadow-sm">
                                            <th className="px-4 py-3 w-12 text-center">#</th>
                                            <th className="px-5 py-3 w-28">Date</th>
                                            <th className="px-5 py-3 w-32 text-center border-l border-blue-200">Ref No.</th>
                                            <th className="px-5 py-3 text-left">Particulars</th>
                                            <th className="px-5 py-3 w-36 text-right border-l border-blue-200">Qty</th>
                                            <th className="px-5 py-3 w-36 text-right border-l border-blue-200">Rate</th>
                                            <th className="px-8 py-3 w-44 text-right bg-blue-50/50 border-l border-blue-200">Amount</th>
                                        </tr>
                                    ) : (
                                        <tr className="bg-[#dceaff] text-[#2b5797] text-[10px] font-black uppercase tracking-widest border-b border-blue-300 shadow-sm">
                                            <th className="px-4 py-3 w-12 text-center">#</th>
                                            <th className="px-5 py-3 w-28">Date</th>
                                            <th className="px-5 py-3 w-36">Voucher Type</th>
                                            <th className="px-5 py-3 flex-1 text-left">Particulars</th>
                                            <th className="px-5 py-3 w-32 text-center border-l border-blue-200">Ref No.</th>
                                            <th className="px-5 py-3 w-40 text-right border-l border-blue-200">Debit</th>
                                            <th className="px-5 py-3 w-40 text-right border-l border-blue-200">Credit</th>
                                            <th className="px-8 py-3 w-48 text-right bg-blue-50/50 border-l border-blue-200">Running Bal</th>
                                        </tr>
                                    )}
                                </thead>
                                <tbody className="divide-y divide-white/[0.03]">
                                    {processedData.map((t, idx) => (
                                        <React.Fragment key={t.id}>
                                            {isSalesPurchaseRegister ? (
                                                <tr onClick={() => t.id !== 'OP_BAL' && onViewTransaction?.(t.id, t.vType)} className={`group transition-all select-none border-b border-slate-100 ${t.isOpening ? 'bg-blue-50/30' : 'hover:bg-blue-50/50 cursor-pointer'}`}>
                                                    <td className="px-4 py-2 text-center text-[11px] font-bold text-slate-400">{idx + 1}</td>
                                                    <td className="px-5 py-2 text-[12px] font-bold text-slate-700">{formatDate(t.date)}</td>
                                                    <td className="px-5 py-2 text-[12px] font-mono text-slate-600 text-center">{t.ref}</td>
                                                    <td className="px-5 py-2 text-[13px] font-bold text-slate-900 uppercase tracking-tight">{t.particulars}</td>
                                                    <td className="px-5 py-2 text-right text-[13px] font-bold text-slate-800">{Number(t.qty || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                                                    <td className="px-5 py-2 text-right text-[13px] font-bold text-slate-700">{formatAmt(t.rate)}</td>
                                                    <td className="px-8 py-2 text-right text-[13px] font-black text-[#2b5797] bg-blue-50/20 tabular-nums">{formatAmt(t.amount)}</td>
                                                </tr>
                                            ) : (
                                                <tr onClick={() => t.id !== 'OP_BAL' && onViewTransaction?.(t.id, t.vType)} className={`group transition-all select-none border-b border-slate-100 ${t.isOpening ? 'bg-blue-50/30' : 'hover:bg-blue-50/50 cursor-pointer'}`}>
                                                    <td className="px-4 py-2 text-center text-[11px] font-bold text-slate-400">{t.isOpening ? '—' : idx + 1}</td>
                                                    <td className="px-5 py-2 text-[12px] font-bold text-slate-700">{formatDate(t.date)}</td>
                                                    <td className="px-5 py-2">
                                                        <span className="text-[9.5px] font-black uppercase tracking-tight text-[#2b5797]">{t.vchType}</span>
                                                    </td>
                                                    <td className="px-5 py-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-[13px] font-bold text-slate-900 uppercase tracking-tight">{t.drName} / {t.crName}</span>
                                                            {!expandDetails && t.narration && <span className="text-[10px] text-slate-500 italic mt-0.5 truncate max-w-[400px]">"{t.narration}"</span>}
                                                            
                                                            {expandDetails && t.details && (
                                                                <div className="mt-1 pl-4 border-l border-blue-200 text-[10px] text-slate-500 animate-in slide-in-from-left-1">
                                                                    {t.details.map((d, i) => (
                                                                        <div key={i} className="flex justify-between gap-4 py-0.5 border-b border-slate-50 last:border-0">
                                                                            <span>{d.label}</span>
                                                                            <span className="font-bold opacity-80">{d.value}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-2 text-[12px] font-mono text-slate-600 text-center">{t.ref}</td>
                                                    <td className="px-5 py-2 text-right text-[13px] font-bold text-emerald-700">{t.amountIn > 0 ? formatAmt(t.amountIn) : ''}</td>
                                                    <td className="px-5 py-2 text-right text-[13px] font-bold text-rose-700">{t.amountOut > 0 ? formatAmt(t.amountOut) : ''}</td>
                                                    <td className="px-8 py-2 text-right text-[13px] font-black text-[#2b5797] bg-blue-50/20 tabular-nums">
                                                        {formatAmt(Math.abs(t.runningBal))} 
                                                        <span className="text-[10px] ml-1 opacity-50 font-bold">{t.runningBal >= 0 ? 'Dr' : 'Cr'}</span>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        ) : viewMode === 'monthly' ? (
                            <div className="p-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                                {monthlySummary.map(m => (
                                    <div key={m.m} className="bg-white/5 border border-white/10 rounded-[2rem] p-8 hover:border-blue-500/50 hover:bg-white/[0.08] transition-all group hover:scale-[1.03] shadow-xl">
                                        <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
                                            <div className="text-[11px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-3">
                                                <CalendarDays size={20} className="text-blue-500 group-hover:animate-bounce" />
                                                {new Date(m.m + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}
                                            </div>
                                            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all"><ArrowRight size={16} /></div>
                                        </div>
                                        <div className="space-y-5">
                                            <div className="flex justify-between items-center"><span className="text-[10px] uppercase font-bold text-slate-500">Inwards</span><span className="text-sm font-black text-emerald-400 tabular-nums">+{formatAmt(m.in)}</span></div>
                                            <div className="flex justify-between items-center"><span className="text-[10px] uppercase font-bold text-slate-500">Outwards</span><span className="text-sm font-black text-rose-400 tabular-nums">-{formatAmt(m.out)}</span></div>
                                            <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                                                <span className="text-[10px] uppercase font-black text-blue-500 tracking-widest">Growth</span>
                                                <span className={`text-lg font-black tabular-nums drop-shadow-lg ${m.in - m.out >= 0 ? 'text-white' : 'text-rose-500'}`}>{formatAmt(m.in - m.out)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center gap-10 opacity-30 animate-pulse">
                                <div className="p-16 bg-blue-600/10 rounded-full ring-12 ring-blue-600/5"><BarChart3 size={96} className="text-blue-500" /></div>
                                <div className="text-center space-y-4">
                                    <h3 className="text-4xl font-black tracking-tighter text-white uppercase italic">Advanced Oracle Intelligence</h3>
                                    <p className="text-xs font-black uppercase tracking-[0.5em] text-blue-500">Processing Big-Data Financial Vectors...</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Infinite Footer Row */}
            {/* ── TALLY-STYLE SYSTEM FOOTER ── */}
            <div className="bg-[#2b5797] px-4 py-1 flex items-center justify-between text-[10px] font-black text-white select-none z-50">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="bg-white/20 px-1.5 py-0.5 rounded text-[9px]">ESC</span>
                        <span className="uppercase tracking-widest opacity-90">Close Report</span>
                    </div>
                    <div className="flex items-center gap-2 border-l border-white/20 pl-6">
                        <span className="bg-white/20 px-1.5 py-0.5 rounded text-[9px]">ALT + D</span>
                        <span className="uppercase tracking-widest opacity-90">{expandDetails ? 'Condensed' : 'Detailed'}</span>
                    </div>
                    <div className="flex items-center gap-2 border-l border-white/20 pl-6">
                        <span className="bg-white/20 px-1.5 py-0.5 rounded text-[9px]">F2</span>
                        <span className="uppercase tracking-widest opacity-90">Change Period</span>
                    </div>
                </div>
                <div className="flex items-center gap-3 opacity-60">
                    <span className="uppercase tracking-[0.2em]">{effectiveName || 'Admin'}</span>
                    <span className="bg-white/20 h-4 w-[1px]"></span>
                    <span>v 2.5.3</span>
                </div>
            </div>
            </div>
        </div>
    </div>,
    document.body
);

{showDateOptionsMenu && createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowDateOptionsMenu(false)}>
        <div className="bg-white border-2 border-blue-900 shadow-2xl rounded-sm overflow-hidden w-[280px]" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-900 text-white p-2.5 px-4 flex items-center justify-between font-black uppercase text-[10px] tracking-widest">
                Duration Control
                <button onClick={() => setShowDateOptionsMenu(false)}><X size={14} /></button>
            </div>
            <div className="p-1.5 grid grid-cols-2 gap-1 bg-slate-100">
                {[
                    { label: 'Daywise', type: 'daywise' },
                    { label: 'Weekly', type: 'weekly' },
                    { label: 'Monthly', type: 'monthly' },
                    { label: 'Quarterly', type: 'quarterly' },
                    { label: 'Annually', type: 'annually' },
                    { label: 'All Time', type: 'all' }
                ].map(opt => (
                    <button
                        key={opt.type}
                        onClick={() => { handleDurationChange(opt.type); setShowDateOptionsMenu(false); }}
                        className={`px-3 py-2 text-[9px] font-black rounded-sm border transition-all ${durationType === opt.type ? 'bg-blue-700 text-white border-blue-800 shadow-inner' : 'bg-white text-blue-900 border-blue-100 hover:bg-blue-50'}`}
                    >
                        {opt.label.toUpperCase()}
                    </button>
                ))}
            </div>
            <div className="p-3 bg-white border-t border-slate-100 space-y-1.5">
                <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 pl-1">Configuration</div>
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-100">
                        <span className="text-[9px] font-bold text-slate-600">START DATE</span>
                        <input type="date" className="bg-transparent text-[10px] font-black outline-none border-none p-0 text-right" value={filter.startDate} onChange={e => { const d = e.target.value; setFilter(prev => ({ ...prev, startDate: d })); generateReport({ ...filter, startDate: d }); }} />
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-100">
                        <span className="text-[9px] font-bold text-slate-600">END DATE</span>
                        <input type="date" className="bg-transparent text-[10px] font-black outline-none border-none p-0 text-right" value={filter.endDate} onChange={e => { const d = e.target.value; setFilter(prev => ({ ...prev, endDate: d })); generateReport({ ...filter, endDate: d }); }} />
                    </div>
                </div>
            </div>
        </div>
    </div>,
    document.body
)}
};

export default ReportsV2;
