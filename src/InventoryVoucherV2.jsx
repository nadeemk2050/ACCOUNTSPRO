/**
 * InventoryVoucherV2.jsx — Premium TallyPrime-inspired Purchase/Sales Voucher UI
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Save, Plus, Trash2, Search, Info,
    Package, FileText, DollarSign, Percent, Zap, Building2,
    CheckCircle2, Loader2, ChevronsUpDown, User, Receipt,
    Printer, Download, Eye, Layers, Truck, Box, AlertCircle, Calendar,
    CreditCard
} from 'lucide-react';
import DocumentGeneratorV2 from './DocumentGeneratorV2';
import {
    collection, serverTimestamp, query, where,
    doc, runTransaction, onSnapshot, getDocs, limit, deleteField
} from 'firebase/firestore';
import { db } from './firebase';

// ── Minimal Searchable Dropdown ──
const V2Select = ({ options = [], value, onChange, placeholder = 'Search...', onCreateNew, compact }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef(null);
    const inputRef = useRef(null);

    const selected = options.find(o => o.value === value);
    const filtered = useMemo(() => {
        if (!q) return options.slice(0, 80);
        const lq = q.toLowerCase();
        return options.filter(o => o.text?.toLowerCase().includes(lq)).slice(0, 80);
    }, [options, q]);

    useEffect(() => {
        const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

    return (
        <div ref={ref} className="relative w-full">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-1 border rounded px-3 text-left text-slate-800 bg-white hover:border-blue-400 focus:ring-2 focus:ring-blue-50/50 focus:outline-none transition-all h-[36px] text-xs border-slate-300 shadow-sm`}
            >
                <span className={selected ? 'font-bold text-slate-800' : 'text-slate-400'}>
                    {selected ? selected.text : placeholder}
                </span>
                <ChevronsUpDown size={14} className="text-slate-400 flex-shrink-0" />
            </button>
            {open && (
                <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-blue-300 rounded-lg shadow-xl z-[200] overflow-hidden min-w-[220px]">
                    <div className="p-1 border-b border-slate-100">
                        <div className="flex items-center gap-1 bg-slate-50 rounded px-2 py-1">
                            <Search size={11} className="text-slate-400" />
                            <input
                                ref={inputRef}
                                className="flex-1 text-xs outline-none bg-transparent text-slate-700"
                                placeholder="Search..."
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') setOpen(false);
                                    if (e.key === 'Enter' && filtered.length > 0) {
                                        onChange(filtered[0].value);
                                        setOpen(false);
                                        setQ('');
                                    }
                                }}
                            />
                        </div>
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                        {filtered.map(o => (
                            <button
                                key={o.value}
                                type="button"
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 transition-colors ${o.value === value ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700'}`}
                                onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                            >
                                {o.text}
                            </button>
                        ))}
                    </div>
                    {onCreateNew && (
                        <div className="border-t border-slate-100">
                            <button
                                type="button"
                                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 transition-colors font-semibold"
                                onClick={() => { onCreateNew(); setOpen(false); }}
                            >
                                <Plus size={11} /> Create New
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const FieldLabel = ({ children, required, className = '' }) => (
    <div className={`text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5 ${className}`}>
        {children}
        {required && <span className="text-red-500 font-bold">*</span>}
    </div>
);

const NumInput = ({ value, onChange, placeholder, className = '', right = false, disabled = false }) => (
    <input
        type="number"
        step="0.001"
        min="0"
        value={value}
        disabled={disabled}
        onChange={e => {
            let v = e.target.value;
            if (v.includes('.')) {
                const parts = v.split('.');
                if (parts[1]?.length > 3) v = `${parts[0]}.${parts[1].substring(0, 3)}`;
            }
            onChange(v);
        }}
        placeholder={placeholder}
        className={`w-full border border-slate-300 rounded px-3 py-2 text-xs h-[36px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50/50 transition-all bg-white shadow-sm ${right ? 'text-right font-mono font-bold' : ''} ${disabled ? 'bg-slate-100 text-slate-400' : ''} ${className}`}
    />
);

// --- JUMBO BAG ALLOCATION MODAL (For Purchase) ---
const JumboBagAllocationModal = ({ isOpen, onClose, producedItems, onSave, producedQtyMap, showToast, lastBagNoSeed, initialBags, user, dataOwnerId, mode = 'purchase' }) => {
    const [bags, setBags] = useState([]);
    const [nextBagNo, setNextBagNo] = useState('');
    const [selectedItem, setSelectedItem] = useState('');
    const [qty, setQty] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        if (initialBags && initialBags.length > 0) {
            setBags(initialBags);
            const maxNumericBagNo = initialBags.reduce((max, b) => {
                let num = parseInt(b.bagNo);
                return (!isNaN(num) && Number.isInteger(num) && num > max) ? num : max;
            }, 0);
            const realSeed = maxNumericBagNo > 0 ? maxNumericBagNo : (parseInt(lastBagNoSeed) || 0);
            setNextBagNo((realSeed + 1).toString());
        } else {
            setBags([]);
            setNextBagNo('');
            if (producedItems.length > 0) setSelectedItem(producedItems[0].productId);
        }
    }, [isOpen]);

    const allocatedMap = useMemo(() => {
        const m = {};
        bags.forEach(b => { m[b.productId] = (m[b.productId] || 0) + Number(b.qty); });
        return m;
    }, [bags]);

    const handleAddBag = async () => {
        if (!selectedItem) return;
        const q = Number(qty);
        if (!q || q <= 0) return;
        const allocated = allocatedMap[selectedItem] || 0;
        const totalProduced = producedQtyMap[selectedItem] || 0;
        if (allocated + q > totalProduced) return;
        if (bags.some(b => b.bagNo === nextBagNo)) return;

        setBags([...bags, { id: Date.now() + Math.random(), bagNo: nextBagNo, productId: selectedItem, qty: q }]);
        setNextBagNo('');
        setQty('');
    };

    const handleFinish = () => {
        for (const item of producedItems) {
            const allocated = allocatedMap[item.productId] || 0;
            const total = producedQtyMap[item.productId] || 0;
            if (Math.abs(allocated - total) > 0.001) return alert(`Item ${item.productName} not fully allocated.`);
        }
        onSave(bags);
    };

    if (!isOpen) return null;
    const currentRemaining = (producedQtyMap[selectedItem] || 0) - (allocatedMap[selectedItem] || 0);

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0"><h2 className="font-bold text-lg flex items-center gap-2"><Box size={20} /> Jumbo Bag Allocation</h2><button onClick={onClose}><X size={20} /></button></div>
                <div className="p-4 bg-slate-50 border-b shrink-0 space-y-4">
                    <div className="flex gap-2 items-end">
                        <div className="w-32"><FieldLabel>Bag Number</FieldLabel><input type="text" className="w-full p-2 border rounded font-mono font-bold text-center" value={nextBagNo} onChange={e => setNextBagNo(e.target.value)} /></div>
                        <div className="flex-1"><FieldLabel>Item</FieldLabel><select className="w-full p-2 border rounded text-xs" value={selectedItem} onChange={e => setSelectedItem(e.target.value)}>{producedItems.map(p => <option key={p.productId} value={p.productId}>{p.productName}</option>)}</select></div>
                        <div className="w-32"><FieldLabel>Qty (Rem: {currentRemaining})</FieldLabel><input type="number" className="w-full p-2 border rounded font-bold text-center" value={qty} onChange={e => setQty(e.target.value)} /></div>
                        <button onClick={handleAddBag} className="bg-blue-600 text-white px-4 h-10 rounded font-bold">ADD</button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-100 sticky top-0"><tr><th className="p-2">#</th><th className="p-2">Bag No</th><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2"></th></tr></thead>
                        <tbody className="divide-y">{bags.map((b, i) => (
                            <tr key={b.id}><td className="p-2">{i + 1}</td><td className="p-2 font-mono font-bold">{b.bagNo}</td><td className="p-2">{producedItems.find(p => p.productId === b.productId)?.productName}</td><td className="p-2 text-right">{b.qty}</td><td className="p-2 text-center text-red-400" onClick={() => setBags(bags.filter(x => x.id !== b.id))}><X size={14} /></td></tr>
                        ))}</tbody>
                    </table>
                </div>
                <div className="p-4 border-t bg-slate-50 flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 font-bold text-slate-500">Cancel</button><button onClick={handleFinish} className="px-6 py-2 bg-green-600 text-white rounded font-bold">Confirm Allocation</button></div>
            </div>
        </div>
    );
};

// --- JUMBO BAG SELECTION MODAL (For Sales) ---
const JumboBagSelectionModal = ({ isOpen, onClose, availableBags, onSave, products, initialSelectedIds, targetProductId }) => {
    const [selectedIds, setSelectedIds] = useState(new Set(initialSelectedIds || []));
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => { if (isOpen) setSelectedIds(new Set(initialSelectedIds || [])); }, [isOpen, initialSelectedIds]);

    if (!isOpen) return null;

    let filtered = availableBags;
    if (targetProductId) filtered = filtered.filter(b => b.productId === targetProductId);
    filtered = filtered.filter(b => b.bagNo?.toLowerCase().includes(searchTerm.toLowerCase()) || products.find(p => p.id === b.productId)?.name?.toLowerCase().includes(searchTerm.toLowerCase()));

    const toggleBag = (id) => {
        const n = new Set(selectedIds);
        if (n.has(id)) n.delete(id); else n.add(id);
        setSelectedIds(n);
    };

    const totalSelectedQty = availableBags.filter(b => selectedIds.has(b.id)).reduce((s, b) => s + Number(b.qty), 0);

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="p-4 bg-slate-800 text-white flex justify-between items-center">
                    <div><h2 className="text-xl font-black uppercase tracking-tight">Select Bags</h2><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Only 'In Stock' bags are shown</p></div>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <div className="p-4 bg-slate-100 flex gap-4 items-center">
                    <div className="flex-1 relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="text" placeholder="Search available bags..." className="w-full pl-10 pr-4 py-2 border rounded-lg font-bold" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
                    <div className="flex items-center gap-4">
                        <div className="bg-white px-4 py-1.5 rounded-lg border text-center"><span className="text-[8px] font-bold text-slate-400 block uppercase">Weight</span><span className="text-sm font-black text-blue-600">{totalSelectedQty.toLocaleString()} kg</span></div>
                        <button onClick={() => onSave(availableBags.filter(b => selectedIds.has(b.id)))} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-blue-200">CONFIRM & FILL</button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 sticky top-0"><tr className="text-[9px] uppercase font-black text-slate-500 border-b shadow-sm"><th className="p-3 w-10"></th><th className="p-3">Bag No.</th><th className="p-3">Product</th><th className="p-3 text-right">Quantity</th></tr></thead>
                        <tbody className="divide-y">{filtered.map(bag => (
                            <tr key={bag.id} onClick={() => toggleBag(bag.id)} className={`cursor-pointer ${selectedIds.has(bag.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                                <td className="p-3"><input type="checkbox" checked={selectedIds.has(bag.id)} readOnly className="w-4 h-4 rounded" /></td>
                                <td className="p-3 font-mono font-bold text-lg">{bag.bagNo}</td>
                                <td className="p-3 text-xs font-semibold">{products.find(p => p.id === bag.productId)?.name}</td>
                                <td className="p-3 text-right font-black text-lg">{bag.qty} kg</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const InventoryVoucherV2 = ({
    isOpen, onClose, user, subUser, dataOwnerId,
    parties, products, locations, expenses, accounts, assetAccounts,
    lots, taxRates, initialData, lastDate, setLastDate,
    currencySymbol, setToast, onDeleteTransaction, onQuickCreate, onSwitchVoucher, onUpdateDate, showToast,
    zIndex = 200, vehicles = [], liveStockBalances = {}, companyProfile = {},
    type = 'purchase'
}) => {
    const isSale = type === 'sales';
    const docTitle = isSale ? 'Sales' : 'Purchase';
    const docKbd = isSale ? 'F8' : 'F9';
    const partyLabel = isSale ? 'Customer / Party A/c' : 'Supplier / Party A/c';
    const refLabel = 'Ref No.';
    const dateInputRef = useRef(null);
    const subRefLabel = isSale ? 'Buyer PO Ref' : 'Supp. Inv No.';
    const iconColor = isSale ? 'text-blue-300' : 'text-emerald-300';
    const headerGrad = isSale ? 'from-[#0a1628] via-[#112040] to-[#0d1e38]' : 'from-[#0a1628] via-[#102a28] to-[#0a1628]';
    
    // Define effectiveName here so it's in scope for all functions
    const effectiveName = subUser?.username || user?.displayName || user?.email || 'System';

    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState({});
    const [items, setItems] = useState([{ productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '' }]);
    const [invExpenses, setInvExpenses] = useState([]);
    const [addlExpenses, setAddlExpenses] = useState([]);
    const [addlExpCreditId, setAddlExpCreditId] = useState('');
    const [enableTax, setEnableTax] = useState(false);
    const [selectedTaxId, setSelectedTaxId] = useState('');
    const [taxPercent, setTaxPercent] = useState('');
    const [currencies, setCurrencies] = useState([]);
    const [bankAccounts, setBankAccounts] = useState([]);
    const [activeTab, setActiveTab] = useState('items');
    const [showGenModal, setShowGenModal] = useState(false);
    const [paymentTerms, setPaymentTerms] = useState('today'); // 'today' | 'date:<ISO>'
    const [paymentTermsDate, setPaymentTermsDate] = useState('');
    const [showPaymentTermsPicker, setShowPaymentTermsPicker] = useState(false);

    // Jumbo Bags State
    const [jumboEnabled, setJumboEnabled] = useState(false);
    const [jumboBags, setJumboBags] = useState([]);
    const [showJumboEntry, setShowJumboEntry] = useState(false);
    const [showJumboSelection, setShowJumboSelection] = useState(false);
    const [activeBagRowIndex, setActiveBagRowIndex] = useState(null);
    const [activeBagProduct, setActiveBagProduct] = useState(null);
    const [availableBags, setAvailableBags] = useState([]);
    const [lastBagNoSeed, setLastBagNoSeed] = useState('0');
    const [productsBagMap, setProductsBagMap] = useState({});

    const refNoRef = useRef(null);
    const initialBagsRef = useRef([]); // To track old bags for cleanup on edit

    const addItem = React.useCallback(() => {
        setItems(p => [...p, { productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '', selectedBags: [] }]);
    }, [setItems]);

    const removeItem = React.useCallback(idx => {
        setItems(p => { const n = p.filter((_, i) => i !== idx); return n.length ? n : [{ productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '', selectedBags: [] }]; });
    }, [setItems]);

    const updateItem = React.useCallback((idx, field, value) => {
        setItems(prev => {
            const arr = [...prev];
            let val = value;
            if (['quantity', 'rate', 'pieces', 'total'].includes(field) && val?.toString().includes('.')) {
                const p = val.toString().split('.');
                if (p[1]?.length > 3) val = `${p[0]}.${p[1].substring(0, 3)}`;
            }
            arr[idx] = { ...arr[idx], [field]: val };
            const q = Number(arr[idx].quantity) || 0;
            const r = Number(arr[idx].rate) || 0;
            if (field === 'total') {
                const t = Number(val) || 0;
                if (q !== 0) arr[idx].rate = Number((t / q).toFixed(3));
            } else if (['quantity', 'rate'].includes(field)) {
                if (q && r) arr[idx].total = Number((q * r).toFixed(3));
            }
            return arr;
        });
    }, [setItems]);

    const totals = useMemo(() => {
        let itemsTotal = 0, totalQty = 0, totalPieces = 0;
        items.forEach(i => { itemsTotal += Number(i.total) || 0; totalQty += Number(i.quantity) || 0; totalPieces += Number(i.pieces) || 0; });
        const expTotal = invExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const addlExpTotal = addlExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        let taxAmount = 0;
        if (enableTax && selectedTaxId) taxAmount = (itemsTotal * (Number(taxPercent) || 0)) / 100;
        const grandTotalForeign = itemsTotal + expTotal + taxAmount + addlExpTotal;
        const grandTotalBase = grandTotalForeign * (Number(formData.exchangeRate) || 1);
        return { itemsTotal, expTotal, addlExpTotal, taxAmount, grandTotalForeign, grandTotalBase, totalQty, totalPieces };
    }, [items, invExpenses, addlExpenses, enableTax, selectedTaxId, taxPercent, formData.exchangeRate]);

    const handleSave = React.useCallback(async () => {
        if (!formData.refNo?.trim()) return alert('⚠ Reference Number is required!');
        // Payment Terms validation
        if (!paymentTerms) return alert('⚠ Payment Terms is required!');
        if (paymentTerms === 'date' && !paymentTermsDate) return alert('⚠ Please select a Payment Due Date!');
        if (!formData.partyId) return alert(`⚠ Please select a ${isSale ? 'Customer' : 'Supplier'}!`);
        if (!formData.locationId) return alert('⚠ Please select a Location!');
        const cleanItems = items.filter(i => i.productId && Number(i.quantity) > 0).map(i => ({
            productId: i.productId, quantity: Number(i.quantity), rate: Number(i.rate),
            pieces: Number(i.pieces || 0), lotId: i.lotId || null, originalRate: i.rate
        }));
        if (cleanItems.length === 0) return alert('⚠ Please add at least one item!');

        setSaving(true);
        try {
            await runTransaction(db, async (transaction) => {
                const targetUid = dataOwnerId || user.uid;
                const invoiceRef = (initialData?.id) ? doc(db, 'invoices', initialData.id) : doc(collection(db, 'invoices'));
                
                // JUMBO COUNTS
                const finalBagCount = isSale 
                    ? items.reduce((s, i) => s + (i.selectedBags?.length || 0), 0)
                    : (jumboEnabled ? jumboBags.length : 0);

                const payload = {
                    type, docType: type, version: 'v2', status: 'active',
                    partyId: formData.partyId,
                    partyName: parties.find(p => p.id === formData.partyId)?.name || 'Unknown',
                    date: formData.date,
                    refNo: formData.refNo || '',
                    paymentTerms: paymentTerms === 'today' ? formData.date : paymentTermsDate,
                    supplierInvoiceNo: formData.supplierInvoiceNo || '',
                    locationId: formData.locationId,
                    locationName: locations.find(l => l.id === formData.locationId)?.name || 'Unknown',
                    ...formData,
                    companyBank: formData.bankDetails || (formData.companyBankId ? companyProfile.banks.find(b => (b.accNumber || b.iban || `bank-${companyProfile.banks.indexOf(b)}`) === formData.companyBankId) : null),
                    jumboEnabled,
                    jumboBags: jumboBags || [],
                    bagCount: finalBagCount,
                    items: cleanItems.map((item, idx) => {
                        const original = items.find((_, i) => i === idx);
                        return { ...item, selectedBags: original?.selectedBags || [] };
                    }),
                    expenses: invExpenses.filter(e => e.expenseId && e.amount > 0),
                    addlExpenses: addlExpenses.filter(e => e.expenseId && e.amount > 0),
                    addlExpCreditId: addlExpCreditId || null,
                    addlExpTotal: totals.addlExpTotal,
                    totalAmount: totals.grandTotalBase,
                    taxId: enableTax ? selectedTaxId : null,
                    taxName: enableTax && selectedTaxId ? taxRates.find(t => t.id === selectedTaxId)?.name : null,
                    taxPercent: enableTax ? taxPercent : 0,
                    taxAmount: totals.taxAmount,
                    userId: targetUid,
                    lastModifiedBy: user.uid,
                    lastModifiedByName: effectiveName,
                    lastModifiedAt: serverTimestamp(),
                    ...(!initialData ? {
                        createdBy: (subUser?.username || subUser?.id || user.uid),
                        createdByName: effectiveName,
                        createdAt: serverTimestamp()
                    } : {})
                };

                if (initialData?.id) transaction.update(invoiceRef, payload);
                else transaction.set(invoiceRef, payload);

                // 💾 UPDATE JUMBO BAGS INVENTORY
                if (!isSale && jumboEnabled) {
                    if (initialData) {
                        initialBagsRef.current.forEach(b => transaction.delete(doc(db, 'jumbo_bags', b.id)));
                    }
                    if (jumboBags.length > 0) {
                        jumboBags.forEach(b => {
                            const bRef = doc(collection(db, 'jumbo_bags'));
                            transaction.set(bRef, {
                                bagNo: b.bagNo,
                                productId: b.productId,
                                qty: Number(b.qty),
                                purchaseId: invoiceRef.id,
                                date: formData.date,
                                status: 'in_stock',
                                userId: targetUid,
                                createdAt: serverTimestamp()
                            });
                        });
                    }
                } else if (isSale) {
                    if (initialData) {
                        initialBagsRef.current.forEach(b => {
                            transaction.update(doc(db, 'jumbo_bags', b.id), {
                                status: 'in_stock',
                                salesId: deleteField(),
                                soldDate: deleteField()
                            });
                        });
                    }
                    const allSelectedBags = items.flatMap(i => i.selectedBags || []);
                    if (allSelectedBags.length > 0) {
                        allSelectedBags.forEach(b => {
                            transaction.update(doc(db, 'jumbo_bags', b.id), {
                                status: 'sold',
                                salesId: invoiceRef.id,
                                soldDate: formData.date
                            });
                        });
                    }
                }

                const logRef = doc(collection(db, 'audit_logs'));
                transaction.set(logRef, {
                    date: serverTimestamp(), ownerId: targetUid, userId: user.uid, userName: effectiveName,
                    action: initialData ? 'UPDATED' : 'CREATED',
                    docType: `${docTitle} Invoice (V2)`,
                    refNo: formData.refNo || 'N/A', amount: totals.grandTotalBase, voucherDate: formData.date,
                    description: `${isSale ? 'Customer' : 'Supplier'}: ${parties.find(p => p.id === formData.partyId)?.name || 'Unknown'}`,
                    docId: invoiceRef.id
                });
            });

            if (onUpdateDate) onUpdateDate(formData.date);
            if (showToast) showToast({ type: 'success', title: 'Saved', message: `${docTitle} voucher recorded.` });
            if (initialData) onClose();
            else {
                setFormData(p => ({ ...p, refNo: '', supplierInvoiceNo: '', narration: '', containerNo: '', sealNo: '' }));
                setPaymentTerms('today'); setPaymentTermsDate('');
                setItems([{ productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '' }]);
                setInvExpenses([]); setAddlExpenses([]); setAddlExpCreditId('');
                if (refNoRef.current) refNoRef.current.focus();
            }
        } catch (err) { console.error(err); alert('Error: ' + err.message); }
        finally { setSaving(false); }
    }, [formData, items, invExpenses, addlExpenses, enableTax, selectedTaxId, taxPercent, totals, dataOwnerId, user, initialData, isSale, type, jumboEnabled, jumboBags, parties, locations, companyProfile, subUser, effectiveName, docTitle, onUpdateDate, showToast, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const targetUid = dataOwnerId || user?.uid;
        if (!targetUid) return;

        const unsubCur = onSnapshot(query(collection(db, 'currencies'), where('userId', '==', targetUid)), snap => {
            setCurrencies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const unsubBank = onSnapshot(query(collection(db, 'accounts'), where('userId', '==', targetUid), where('type', 'in', ['bank', 'cash', 'cashier', 'account'])), snap => {
            setBankAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => { unsubCur(); unsubBank(); };
    }, [isOpen, dataOwnerId, user]);

    // Keyboard Shortcuts (F2 for Date, Alt+A for Add Row, etc.)
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'F2') {
                e.preventDefault();
                dateInputRef.current?.focus();
            }
            if (e.altKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                addItem();
            }
            if (e.altKey && (e.key.toLowerCase() === 's' || e.key === 'F10')) {
                e.preventDefault();
                handleSave();
            }
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, addItem, handleSave, onClose]);

    // Fetch In-Stock Bags Count when Sales Voucher is open
    useEffect(() => {
        if (isOpen && isSale) {
            const targetUid = dataOwnerId || user?.uid;
            if (!targetUid) return;
            const q = query(collection(db, 'jumbo_bags'), where('userId', '==', targetUid), where('status', '==', 'in_stock'));
            const unsub = onSnapshot(q, (snap) => {
                const map = {};
                snap.forEach(d => {
                    const pid = d.data().productId;
                    if (pid) map[pid] = (map[pid] || 0) + 1;
                });
                setProductsBagMap(map);
            });
            return () => unsub();
        } else {
            setProductsBagMap({});
        }
    }, [isOpen, isSale, dataOwnerId, user]);

    // Fetch Available Bags for Selection when Modal is Open
    useEffect(() => {
        if (isOpen && showJumboSelection) {
            const targetUid = dataOwnerId || user?.uid;
            if (!targetUid) return;
            const q = query(collection(db, 'jumbo_bags'), where('userId', '==', targetUid), where('status', '==', 'in_stock'));
            getDocs(q).then(snap => {
                setAvailableBags(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            });
        }
    }, [isOpen, showJumboSelection, dataOwnerId, user]);

    useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            setFormData({
                partyId: initialData.partyId || '',
                date: initialData.date || new Date().toISOString().split('T')[0],
                refNo: initialData.refNo || '',
                supplierInvoiceNo: initialData.supplierInvoiceNo || '',
                locationId: initialData.locationId || '',
                narration: initialData.narration || '',
                currencyId: initialData.currencyId || 'BASE',
                exchangeRate: initialData.exchangeRate || 1,
                containerNo: initialData.containerNo || '',
                sealNo: initialData.sealNo || '',
                otherRef: initialData.otherRef || '',
                packingType: initialData.packingType || 'loose',
                portOfLoading: initialData.portOfLoading || '',
                portOfDischarge: initialData.portOfDischarge || '',
                vesselName: initialData.vesselName || '',
                voyageNo: initialData.voyageNo || '',
                countryOfOrigin: initialData.countryOfOrigin || 'UNITED ARAB EMIRATES',
                finalDestination: initialData.finalDestination || '',
                vehicleNo: initialData.vehicleNo || '',
                buyerName: initialData.buyerName || '',
                buyerAddress: initialData.buyerAddress || '',
                consigneeName: initialData.consigneeName || '',
                consigneeAddress: initialData.consigneeAddress || '',
                boeTenor: initialData.boeTenor || '90 DAYS D/A',
                boeBank: initialData.boeBank || '',
                hsCode: initialData.hsCode || '',
                overrideItemDescription: initialData.overrideItemDescription || '',
                companyBankId: initialData.companyBankId || '',
                bankDetails: initialData.companyBank || null,
            });
            setItems(initialData.items?.map(i => ({
                ...i,
                pieces: i.pieces || '', quantity: i.quantity || '', rate: i.originalRate || i.rate || '',
                total: ((Number(i.quantity) || 0) * (Number(i.originalRate || i.rate) || 0)) || '',
                lotId: i.lotId || ''
            })) || [{ productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '' }]);
            setInvExpenses(initialData.expenses || []);
            // Restore payment terms
            if (initialData.paymentTerms) {
                const today = initialData.date || new Date().toISOString().split('T')[0];
                if (initialData.paymentTerms === today) { setPaymentTerms('today'); setPaymentTermsDate(''); }
                else { setPaymentTerms('date'); setPaymentTermsDate(initialData.paymentTerms); }
            } else { setPaymentTerms('today'); setPaymentTermsDate(''); }
            if (initialData.taxId) { setSelectedTaxId(initialData.taxId); setEnableTax(true); setTaxPercent(Number(initialData.taxPercent) || ''); }
            if (initialData.addlExpenses) { setAddlExpenses(initialData.addlExpenses); setAddlExpCreditId(initialData.addlExpCreditId || ''); }
            
            // Jumbo Load
            if (initialData.jumboEnabled || initialData.packingType === 'bags') {
                setJumboEnabled(true);
                const qBags = query(collection(db, 'jumbo_bags'), where(isSale ? 'salesId' : 'purchaseId', '==', initialData.id));
                getDocs(qBags).then(snap => {
                    const fetchedBags = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setJumboBags(fetchedBags);
                    initialBagsRef.current = fetchedBags;
                });
            } else {
                setJumboEnabled(false);
                setJumboBags([]);
            }
        } else {
            setFormData({
                partyId: '', date: lastDate || new Date().toISOString().split('T')[0], refNo: '', supplierInvoiceNo: '',
                locationId: locations.length === 1 ? locations[0].id : (localStorage.getItem('accnad_last_loc') || ''),
                narration: '', currencyId: 'BASE', exchangeRate: 1, containerNo: '', sealNo: '', otherRef: '',
                packingType: 'loose', portOfLoading: '', portOfDischarge: '', vesselName: '', voyageNo: '',
                countryOfOrigin: 'UNITED ARAB EMIRATES', finalDestination: '', vehicleNo: '',
                buyerName: '', buyerAddress: '', consigneeName: '', consigneeAddress: '',
                boeTenor: '90 DAYS D/A', boeBank: '', hsCode: '', overrideItemDescription: '', companyBankId: '',
            });
            setItems([{ productId: '', quantity: '', rate: '', pieces: '', total: '', lotId: '', selectedBags: [] }]);
            setPaymentTerms('today'); setPaymentTermsDate('');
            setInvExpenses([]); setAddlExpenses([]); setAddlExpCreditId(''); setEnableTax(false); setSelectedTaxId(''); setTaxPercent('');
            setJumboEnabled(false); setJumboBags([]);
        }
    }, [isOpen, initialData]);

    const handleJumboFinish = (bags) => {
        setJumboBags(bags);
        setShowJumboEntry(false);
        if (bags.length > 0) {
            setLastBagNoSeed(bags[bags.length - 1].bagNo);
        }
    };

    const currentSym = formData.currencyId === 'BASE' ? currencySymbol : (currencies.find(c => c.id === formData.currencyId)?.symbol || '?');
    const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

    if (!isOpen) return null;

    return createPortal(
        <>
            <div className="fixed inset-0 bg-[#f8fafc] flex flex-col overflow-hidden animate-in fade-in duration-200" style={{ zIndex }}>
                {/* === GATEWAY BLUE TOP BAR === */}
                <div className="flex-shrink-0 bg-gradient-to-r from-[#005ea8] to-[#00457c] border-b-2 border-[#003a68] px-5 py-2.5 flex items-center justify-between select-none shadow-xl z-20">
                    <div className="flex items-center gap-6">
                        {/* 1. Identity & Mode */}
                        <div className="flex flex-col shrink-0 min-w-[140px]">
                            <span className="text-[9px] font-black text-blue-100 uppercase tracking-widest leading-none mb-1 opacity-70">Inventory Voucher</span>
                            <div className="relative group flex items-center bg-white/10 px-2.5 py-1 rounded-lg border border-white/20 cursor-pointer w-fit hover:bg-white/20 transition-all shadow-sm">
                                <select
                                    className="bg-transparent text-white font-extrabold text-sm outline-none cursor-pointer appearance-none pr-6 transition-colors uppercase leading-none"
                                    value={type}
                                    onChange={(e) => onSwitchVoucher && onSwitchVoucher(e.target.value)}
                                    disabled={!!initialData}
                                >
                                    <option value="purchase" className="text-slate-900">PURCHASE (F9)</option>
                                    <option value="sales" className="text-slate-900">SALES (F8)</option>
                                    <option className="text-slate-300" disabled>──────────</option>
                                    <option value="receipt" className="text-slate-900">RECEIPT (IN)</option>
                                    <option value="payment" className="text-slate-900">PAYMENT (OUT)</option>
                                    <option value="contra" className="text-slate-900">CONTRA / TRANSFER</option>
                                    <option value="journal" className="text-slate-900">JOURNAL (F7)</option>
                                </select>
                                <div className="absolute right-1.5 pointer-events-none text-blue-200 group-hover:text-white transition-colors"><ChevronsUpDown size={12} strokeWidth={3} /></div>
                            </div>
                        </div>

                        {/* 2. Location */}
                        <div className="flex flex-col min-w-[160px]">
                            <span className="text-[9px] font-black text-blue-100 uppercase tracking-tighter mb-0.5 opacity-60">Location</span>
                            <div className="flex items-center bg-black/20 px-2 py-1 rounded-lg border border-white/10 shadow-inner backdrop-blur-sm h-[32px]">
                                <Truck size={12} className="text-blue-300 mr-2" />
                                <select 
                                    className="bg-transparent text-white font-bold text-[11px] outline-none cursor-pointer w-full appearance-none"
                                    value={formData.locationId || ''} 
                                    onChange={e => setFormData(p => ({ ...p, locationId: e.target.value }))}
                                >
                                    <option value="" className="text-slate-900">Select...</option>
                                    {locations.map(l => <option key={l.id} value={l.id} className="text-slate-900">{l.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="w-px h-8 bg-white/10 self-end mb-1"></div>

                        {/* 3. Toggles */}
                        <div className="flex items-center gap-2 pt-3">
                            <label className="flex items-center gap-2 cursor-pointer group bg-black/20 px-3 h-[32px] rounded-lg border border-white/10 shadow-inner hover:bg-white/10 transition-all">
                                <input type="checkbox" checked={enableTax} onChange={e => setEnableTax(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 border-white/20 bg-white/10" />
                                <span className="text-[9px] font-black text-blue-100 group-hover:text-white transition-colors uppercase tracking-widest">TAX</span>
                            </label>

                             <button type="button" onClick={() => setFormData({ ...formData, packingType: formData.packingType === 'loose' ? 'bags' : 'loose' })} className={`px-4 h-[32px] rounded-lg border flex items-center gap-2 transition-all font-black text-[9px] uppercase tracking-widest shadow-sm ${formData.packingType === 'bags' ? 'bg-orange-500 border-orange-600 text-white' : 'bg-white/10 border-white/20 text-blue-100 hover:text-white'}`}>
                                <Package size={12} />
                                {formData.packingType}
                            </button>
                        </div>
                    </div>

                    {/* Right Side: Date, Currency, Actions */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-3 bg-black/20 p-1 px-3 rounded-lg border border-white/10 shadow-inner backdrop-blur-sm h-[40px]">
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-blue-100 uppercase tracking-tighter opacity-60">Voucher Date</span>
                                <input
                                    ref={dateInputRef}
                                    type="date"
                                    className="text-[11px] font-bold text-white bg-transparent border-none focus:ring-0 p-0 w-28 cursor-pointer [color-scheme:dark]"
                                    value={formData.date || ''}
                                    onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                                />
                            </div>
                            <div className="w-px h-6 bg-white/10"></div>
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-blue-100 uppercase tracking-tighter opacity-60">Currency</span>
                                <select
                                    className="text-[11px] font-bold text-cyan-300 bg-transparent border-none focus:ring-0 p-0 cursor-pointer"
                                    value={formData.currencyId || 'BASE'}
                                    onChange={e => setFormData(p => ({ ...p, currencyId: e.target.value }))}
                                >
                                    <option value="BASE" className="text-slate-900">{currencySymbol}</option>
                                    {currencies.map(c => <option key={c.id} value={c.id} className="text-slate-900">{c.symbol}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="bg-white/10 p-1 rounded-lg border border-white/10 h-[40px] flex items-center">
                            <button type="button" onClick={() => setShowGenModal(true)} className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white transition-all" title="Print Document"><Printer size={16} /></button>
                        </div>

                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-white text-[#00457c] hover:bg-blue-50 h-[40px] px-6 rounded-lg font-black text-xs transition-all shadow-lg shadow-black/20 active:scale-95 flex items-center gap-2 uppercase tracking-widest"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Saving...' : 'Save Voucher'}
                        </button>
                    </div>
                </div>

                {/* Main Header Fields */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-8 py-6">
                    <div className="flex flex-nowrap items-end gap-10">
                        <div className="w-52 flex flex-col gap-1">
                            <input ref={refNoRef} type="text" placeholder="Ref No." className="w-full border-2 border-blue-500/20 rounded-xl px-4 h-[46px] text-lg font-mono font-bold text-blue-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 bg-blue-50/20 shadow-sm transition-all text-center tracking-widest" value={formData.refNo || ''} onChange={e => setFormData(p => ({ ...p, refNo: e.target.value }))} />
                        </div>

                        {/* ── Payment Terms ── */}
                        <div className="flex flex-col gap-1">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1"><CreditCard size={10} /> Payment Terms <span className="text-red-500">*</span></div>
                            <div className="flex items-center gap-1 h-[46px]">
                                <button
                                    type="button"
                                    onClick={() => { setPaymentTerms('today'); setPaymentTermsDate(''); setShowPaymentTermsPicker(false); }}
                                    className={`flex items-center gap-1.5 px-3 h-full rounded-xl border-2 text-xs font-bold transition-all ${
                                        paymentTerms === 'today'
                                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-md'
                                            : 'bg-white border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-700'
                                    }`}
                                >
                                    <CreditCard size={13} />
                                    TODAY
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setPaymentTerms('date'); setShowPaymentTermsPicker(true); }}
                                    className={`flex items-center gap-1.5 px-3 h-full rounded-xl border-2 text-xs font-bold transition-all ${
                                        paymentTerms === 'date'
                                            ? 'bg-orange-500 border-orange-500 text-white shadow-md'
                                            : 'bg-white border-slate-300 text-slate-600 hover:border-orange-400 hover:text-orange-700'
                                    }`}
                                >
                                    <Calendar size={13} />
                                    {paymentTerms === 'date' && paymentTermsDate
                                        ? new Date(paymentTermsDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                        : 'PICK DATE'}
                                </button>
                                {paymentTerms === 'date' && showPaymentTermsPicker && (
                                    <input
                                        type="date"
                                        autoFocus
                                        value={paymentTermsDate}
                                        min={formData.date || ''}
                                        onChange={e => { setPaymentTermsDate(e.target.value); if (e.target.value) setShowPaymentTermsPicker(false); }}
                                        onBlur={() => setShowPaymentTermsPicker(false)}
                                        className="h-full border-2 border-orange-400 rounded-xl px-2 text-xs font-bold text-orange-700 outline-none focus:ring-2 focus:ring-orange-100 bg-orange-50 cursor-pointer"
                                    />
                                )}
                            </div>
                        </div>

                        <div className="w-52 flex flex-col gap-1">
                            <input type="text" placeholder={subRefLabel} className="w-full border border-slate-300 rounded-xl px-4 h-[46px] text-sm font-mono text-slate-700 bg-white focus:border-blue-400 focus:ring-4 focus:ring-blue-50 outline-none transition-all shadow-sm" value={formData.supplierInvoiceNo || ''} onChange={e => setFormData(p => ({ ...p, supplierInvoiceNo: e.target.value }))} />
                        </div>
                        <div className="flex-1 min-w-[350px] flex flex-col gap-1">
                            <V2Select options={parties.map(p => ({ value: p.id, text: p.name }))} value={formData.partyId} onChange={v => setFormData(p => ({ ...p, partyId: v }))} placeholder={isSale ? "Select Customer..." : "Select Supplier..."} onCreateNew={() => onQuickCreate?.('parties')} compact={false} />
                        </div>
                        
                        {/* JUMBO ALLOCATION BUTTON FOR PURCHASE */}
                        {!isSale && jumboEnabled && (
                            <div className="flex flex-col gap-1">
                                <FieldLabel>Allocation</FieldLabel>
                                <button type="button" onClick={() => setShowJumboEntry(true)} className="flex items-center justify-center gap-2 px-8 bg-orange-600 text-white h-[46px] rounded-xl border border-orange-700 font-bold text-sm shadow-lg shadow-orange-100 hover:bg-orange-700 active:scale-95 transition-all">
                                    <Box size={18} />
                                    <span>FILL JUMBO BAGS</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Content Tabs */}
                <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-2 border-b border-slate-100 bg-white">
                            {[ { id: 'items', label: 'Items', icon: Package }, { id: 'expenses', label: 'Inv Exp', icon: DollarSign }, { id: 'addl', label: 'Cost Exp', icon: Layers }, { id: 'tax', label: 'Tax', icon: Percent }, { id: 'shipment', label: 'Shipment', icon: Truck }, { id: 'consignee', label: 'Party Details', icon: User }, { id: 'banking', label: 'Banking', icon: Building2 }, { id: 'narration', label: 'Narration', icon: FileText } ].map(tab => (
                                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1 px-3 py-2 text-[10px] font-bold border-b-2 transition-all ${activeTab === tab.id ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-400 hover:bg-slate-50'}`}><tab.icon size={10} /> {tab.label}</button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {activeTab === 'items' && (
                                <table className="w-full text-left border-collapse">
                                    <thead className="sticky top-0 z-10">
                                        <tr className="bg-slate-800 text-white text-[11px] font-bold uppercase tracking-wider">
                                            <th className="px-6 py-4 w-12 text-center border-r border-slate-700/50">
                                                <button 
                                                    onClick={addItem}
                                                    type="button"
                                                    title="Add New Row (Alt+A)"
                                                    className="w-6 h-6 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded shadow-lg transition-all mx-auto active:scale-90"
                                                >
                                                    <Plus size={14} strokeWidth={3} />
                                                </button>
                                            </th>
                                            <th className="px-6 py-4">Name of Item</th>
                                            <th className="px-6 py-4 w-40">Batch / Lot</th>
                                            <th className="px-6 py-4 w-24 text-center">Pcs</th>
                                            <th className="px-6 py-4 w-28 text-center">Qty</th>
                                            <th className="px-6 py-4 w-32 text-right">Rate</th>
                                            <th className="px-6 py-4 w-36 text-right">Amount</th>
                                            <th className="px-6 py-4 w-12 text-center"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 bg-white">
                                        {items.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-blue-50/20 group transition-colors odd:bg-white even:bg-slate-50/30">
                                                <td className="px-6 py-4 text-center text-xs font-bold text-slate-400 border-r border-slate-100/50">{idx+1}</td>
                                                <td className="px-4 py-4 min-w-[320px]">
                                                    <V2Select options={products.map(p => {
                                                        const bagCount = productsBagMap[p.id] || 0;
                                                        const bagLabel = (isSale && formData.packingType === 'bags') ? ` [${bagCount} BAGS]` : '';
                                                        return { value: p.id, text: `${p.name}${bagLabel}` };
                                                    })} value={item.productId} onChange={v => updateItem(idx, 'productId', v)} placeholder="Select Item..." compact />
                                                    
                                                    {/* BAG SELECTION FOR SALES */}
                                                    {(item.productId && isSale && formData.packingType === 'bags') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setActiveBagRowIndex(idx);
                                                                setActiveBagProduct(products.find(p => p.id === item.productId));
                                                                setShowJumboSelection(true);
                                                            }}
                                                            className="mt-2.5 flex items-center gap-2 text-[10px] font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-200 hover:bg-orange-100 transition-all w-fit shadow-sm uppercase tracking-wider"
                                                        >
                                                            <Box size={12} />
                                                            {(item.selectedBags || []).length > 0
                                                                ? `${item.selectedBags.length} Bags Selected`
                                                                : 'Link Bags'}
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="px-2 py-4"><V2Select options={lots.filter(l => !item.productId || l.productId === item.productId).map(l => ({ value: l.id, text: l.name }))} value={item.lotId} onChange={v => updateItem(idx, 'lotId', v)} placeholder="No Batch" compact /></td>
                                                <td className="px-2 py-4 text-center"><NumInput value={item.pieces} onChange={v => updateItem(idx, 'pieces', v)} right /></td>
                                                <td className="px-2 py-4 text-center"><NumInput value={item.quantity} onChange={v => updateItem(idx, 'quantity', v)} right /></td>
                                                <td className="px-2 py-4 text-right"><NumInput value={item.rate} onChange={v => updateItem(idx, 'rate', v)} right /></td>
                                                <td className="px-2 py-4 text-right"><NumInput value={item.total} onChange={v => updateItem(idx, 'total', v)} right /></td>
                                                <td className="px-2 py-4 text-center">
                                                    <button type="button" onClick={() => removeItem(idx)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-all p-2.5 hover:bg-red-50 rounded-xl" title="Delete Row">
                                                        <Trash2 size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}</tbody>
                                </table>
                            )}
                            {activeTab === 'expenses' && (
                                <div className="p-8 space-y-4 max-w-3xl">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><DollarSign size={14} /> Indirect Expenses</h3>
                                        <button onClick={() => setInvExpenses(p => [...p, { expenseId: '', amount: '' }])} className="text-[10px] font-black text-blue-600 hover:text-blue-700 transition-all uppercase tracking-widest border border-blue-200 px-3 py-1.5 rounded-lg bg-blue-50">+ Add Detail</button>
                                    </div>
                                    <div className="space-y-2">
                                        {invExpenses.map((exp, i) => (
                                            <div key={i} className="flex gap-3 items-center bg-white p-2 rounded-xl border border-slate-100 shadow-sm animate-in fade-in duration-300">
                                                <div className="flex-1"><V2Select options={expenses.map(e => ({ value: e.id, text: e.name }))} value={exp.expenseId} onChange={v => setInvExpenses(p => { const n = [...p]; n[i] = { ...n[i], expenseId: v }; return n; })} placeholder="Select Expense Ledger..." compact /></div>
                                                <div className="w-32 flex-shrink-0"><NumInput value={exp.amount} onChange={v => setInvExpenses(p => { const n = [...p]; n[i] = { ...n[i], amount: v }; return n; })} right placeholder="0.000" /></div>
                                                <button type="button" onClick={() => setInvExpenses(p => p.filter((_, j) => j !== i))} className="text-red-300 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {activeTab === 'tax' && (
                                <div className="p-8 space-y-6 max-w-xl bg-white m-6 rounded-2xl border border-slate-200 shadow-sm">
                                    <label className="flex items-center gap-3 cursor-pointer group p-2 hover:bg-slate-50 rounded-xl transition-all">
                                        <input type="checkbox" checked={enableTax} onChange={e => setEnableTax(e.target.checked)} className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-700 group-hover:text-blue-600 transition-colors">VAT / Tax Applicability</span>
                                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Enable to apply standard taxation</span>
                                        </div>
                                    </label>
                                    {enableTax && (
                                        <div className="grid grid-cols-3 gap-6 animate-in slide-in-from-top-4 duration-300 p-4 bg-blue-50/30 rounded-xl border border-blue-100">
                                            <div className="col-span-2">
                                                <FieldLabel>Tax Category / Ledger</FieldLabel>
                                                <select className="w-full border border-slate-300 rounded-lg px-3 h-[38px] text-xs font-bold bg-white focus:border-blue-400 outline-none shadow-sm capitalize" value={selectedTaxId} onChange={e => { const t = taxRates.find(r => r.id === e.target.value); setSelectedTaxId(e.target.value); if (t) setTaxPercent(t.percent); }}>
                                                    <option value="">Select Class...</option>
                                                    {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.percent}%)</option>)}
                                                </select>
                                            </div>
                                            <div className="col-span-1">
                                                <FieldLabel>Tax %</FieldLabel>
                                                <NumInput value={taxPercent} onChange={setTaxPercent} right />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {activeTab === 'shipment' && (
                                <div className="p-8 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8 max-w-6xl bg-white m-6 rounded-3xl border border-slate-200 shadow-sm">
                                    <div className="md:col-span-2 lg:col-span-2"><FieldLabel>Vehicle Selection</FieldLabel><V2Select options={vehicles.map(v => ({ value: v.id || v.number, text: `${v.number} (${v.type || 'N/A'})` }))} value={formData.vehicleNo} onChange={v => setFormData(p => ({ ...p, vehicleNo: v }))} placeholder="Search Vehicle Registry..." onCreateNew={() => onQuickCreate?.('vehicles')} /></div>
                                    <div className="col-span-1"><FieldLabel>Manual Vehicle entry</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold focus:border-blue-400 outline-none shadow-sm" placeholder="OR Type No..." value={formData.vehicleNo || ''} onChange={e => setFormData(p => ({ ...p, vehicleNo: e.target.value }))} /></div>
                                    <div className="col-span-1"><FieldLabel>Container No.</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold focus:border-blue-400 outline-none shadow-sm uppercase font-mono" placeholder="ABCD1234567" value={formData.containerNo || ''} onChange={e => setFormData(p => ({ ...p, containerNo: e.target.value }))} /></div>
                                    <div className="col-span-1"><FieldLabel>Port of Loading</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold border-emerald-100 bg-emerald-50/20" value={formData.portOfLoading || ''} onChange={e => setFormData(p => ({ ...p, portOfLoading: e.target.value }))} /></div>
                                    <div className="col-span-1"><FieldLabel>Port of Discharge</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold border-red-100 bg-red-50/20" value={formData.portOfDischarge || ''} onChange={e => setFormData(p => ({ ...p, portOfDischarge: e.target.value }))} /></div>
                                    <div className="col-span-1"><FieldLabel>Vessel Name</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold" value={formData.vesselName || ''} onChange={e => setFormData(p => ({ ...p, vesselName: e.target.value }))} /></div>
                                    <div className="col-span-1"><FieldLabel>Voyage No.</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-lg px-4 h-[38px] text-xs font-bold uppercase" value={formData.voyageNo || ''} onChange={e => setFormData(p => ({ ...p, voyageNo: e.target.value }))} /></div>
                                </div>
                            )}
                            {activeTab === 'consignee' && (
                                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-12 max-w-5xl">
                                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4">
                                        <div className="flex items-center gap-2 pb-2 border-b border-blue-50">
                                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><User size={16} /></div>
                                            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Buyer Details</span>
                                        </div>
                                        <div><FieldLabel>Company Name</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-xl px-4 h-[38px] text-xs font-bold" placeholder="Legal Entity Name" value={formData.buyerName || ''} onChange={e => setFormData(p => ({ ...p, buyerName: e.target.value }))} /></div>
                                        <div><FieldLabel>Full Billing Address</FieldLabel><textarea className="w-full border border-slate-300 rounded-xl p-4 text-xs font-medium bg-slate-50/30 focus:bg-white transition-all outline-none" rows={4} placeholder="P.O. Box, Street, City, Country..." value={formData.buyerAddress || ''} onChange={e => setFormData(p => ({ ...p, buyerAddress: e.target.value }))}></textarea></div>
                                    </div>
                                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4">
                                        <div className="flex items-center gap-2 pb-2 border-b border-emerald-50">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><Truck size={16} /></div>
                                            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Consignee Details</span>
                                        </div>
                                        <div><FieldLabel>Delivery Party</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-xl px-4 h-[38px] text-xs font-bold" placeholder="Consignee Name (if different)" value={formData.consigneeName || ''} onChange={e => setFormData(p => ({ ...p, consigneeName: e.target.value }))} /></div>
                                        <div><FieldLabel>Final Delivery Location</FieldLabel><textarea className="w-full border border-slate-300 rounded-xl p-4 text-xs font-medium bg-slate-50/30 focus:bg-white transition-all outline-none" rows={4} placeholder="Warehouse address, Port details etc..." value={formData.consigneeAddress || ''} onChange={e => setFormData(p => ({ ...p, consigneeAddress: e.target.value }))}></textarea></div>
                                    </div>
                                </div>
                            )}
                            {activeTab === 'banking' && (
                                <div className="p-8 space-y-8 max-w-3xl bg-white m-6 rounded-3xl border border-slate-200 shadow-sm">
                                    <div className="grid grid-cols-2 gap-8">
                                        <div><FieldLabel>Negotiating Bank (BOE)</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-xl px-4 h-[38px] text-xs font-bold focus:border-blue-400 outline-none shadow-inner" placeholder="E.g. Emirates NBD..." value={formData.boeBank || ''} onChange={e => setFormData(p => ({ ...p, boeBank: e.target.value }))} /></div>
                                        <div><FieldLabel>Credit Tenor / Terms</FieldLabel><input type="text" className="w-full border border-slate-300 rounded-xl px-4 h-[38px] text-xs font-bold focus:border-blue-400 outline-none shadow-inner" placeholder="E.g. 60 Days D/A" value={formData.boeTenor || ''} onChange={e => setFormData(p => ({ ...p, boeTenor: e.target.value }))} /></div>
                                    </div>
                                    <div className="p-1 rounded-2xl bg-slate-50 border border-slate-100">
                                        <div className="p-4"><FieldLabel>Company Bank A/c (For Printed Docs)</FieldLabel><V2Select options={(companyProfile?.banks || []).map((b, i) => ({ value: b.accNumber || b.iban || `bank-${i}`, text: `${b.bankName} (${b.accTitle})` }))} value={formData.companyBankId} onChange={v => { const b = (companyProfile?.banks || []).find(bank => (bank.accNumber || bank.iban || `bank-${companyProfile.banks.indexOf(bank)}`) === v); setFormData(p => ({ ...p, companyBankId: v, bankDetails: b })); }} compact={false} /></div>
                                        <div className="px-4 pb-4 flex items-start gap-3"><Info size={16} className="text-blue-500 mt-0.5" /><p className="text-[11px] text-slate-500 font-medium">The selected account details (IBAN, Swift, etc.) will be automatically embedded in the generated PDF invoices and bank applications.</p></div>
                                    </div>
                                </div>
                            )}
                            {activeTab === 'narration' && (
                                <div className="p-8">
                                    <FieldLabel className="mb-3">Internal Voucher Notes / Narration</FieldLabel>
                                    <textarea rows={8} className="w-full border border-slate-200 rounded-3xl p-6 text-sm font-medium outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all shadow-inner bg-slate-50/30" value={formData.narration || ''} onChange={e => setFormData(p => ({ ...p, narration: e.target.value }))} placeholder="Provide a detailed narration for this transaction..." />
                                </div>
                            )}
                        </div>
                        {/* === GATEWAY BLUE ACTION BAR === */}
                        <div className="flex-shrink-0 bg-gradient-to-r from-[#005ea8] to-[#00457c] border-t-2 border-[#003a68] px-6 h-11 flex items-center justify-between shadow-[0_-8px_30px_rgba(0,0,0,0.2)] relative z-20 text-white">
                            <div className="flex items-center gap-4">
                                <div className="flex flex-col justify-center">
                                    <span className="text-[7px] font-black uppercase text-blue-100 opacity-40 leading-none mb-0.5 tracking-[0.2em]">Transaction Registry</span>
                                    <div className="text-[10px] font-black text-white leading-none tracking-tighter flex items-center gap-1.5 pt-0.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                                        <span>ACTIVE | SECURE POSTING</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-6">
                                <div className="hidden lg:flex items-center gap-4 text-[7px] font-black uppercase tracking-tighter text-blue-100/30 border-l border-white/10 pl-6 h-6">
                                    <span>Alt + A: Add Row</span>
                                    <span>Alt + S: Save (F10)</span>
                                    <span>Esc: Close Modal</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="bg-white text-[#00457c] hover:bg-blue-50 h-8 px-6 rounded font-black text-[10px] transition-all active:scale-95 uppercase tracking-widest"
                                >
                                    Accept {docTitle}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Summary Sidebar - Premium Dark Sidebar */}
                    <div className="w-72 flex-shrink-0 flex flex-col bg-[#0f172a] text-slate-300 shadow-2xl border-l border-slate-800">
                        <div className="flex-1 px-6 py-8 space-y-8 overflow-y-auto custom-scrollbar">
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <div className="text-[10px] font-black text-blue-400 uppercase mb-5 tracking-[0.25em] border-b border-white/5 pb-2">Voucher Summary</div>
                                <div className="space-y-4">
                                    {[ 
                                        { label: 'Sub-Total', value: totals.itemsTotal, color: 'text-slate-100' }, 
                                        ...(totals.expTotal > 0 ? [{ label: 'Voucher Exp', value: totals.expTotal, color: 'text-emerald-400' }] : []), 
                                        ...(totals.taxAmount > 0 ? [{ label: `VAT (${taxPercent}%)`, value: totals.taxAmount, color: 'text-blue-400' }] : []), 
                                        ...(totals.addlExpTotal > 0 ? [{ label: 'Landing Cost', value: totals.addlExpTotal, color: 'text-purple-400' }] : []) 
                                    ].map((row, i) => (
                                        <div key={i} className="flex justify-between items-center group">
                                            <span className="text-[11px] font-bold text-slate-500 group-hover:text-slate-400 transition-colors">{row.label}</span>
                                            <span className={`text-[12px] font-mono font-black ${row.color}`}>{currentSym} {fmt(row.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-8 border-t border-white/10 space-y-4 animate-in fade-in duration-700 delay-150">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Items count</span>
                                    <span className="text-xs font-black text-slate-200 bg-slate-800 px-2 py-0.5 rounded-md min-w-[24px] text-center">{items.filter(i => i.productId).length}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Quantity</span>
                                    <span className="text-sm font-black text-emerald-400">{fmt(totals.totalQty)}</span>
                                </div>
                                {(totals.totalPieces > 0 || jumboBags.length > 0) && (
                                    <div className="flex flex-col gap-2 bg-blue-900/10 p-4 rounded-2xl border border-blue-400/10 mt-2 shadow-inner">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] font-black text-orange-400 uppercase tracking-[0.2em]">Live Bag Count</span>
                                            <div className="flex items-center gap-1.5 font-black text-orange-200">
                                                <Box size={14} />
                                                <span className="text-lg">{isSale ? totals.totalPieces : (jumboEnabled ? jumboBags.length : totals.totalPieces)}</span>
                                            </div>
                                        </div>
                                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider text-center">{formData.packingType === 'bags' ? 'Bags linked to inventory' : 'Loose pieces counted'}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="p-8 bg-blue-600/10 border-t border-white/10 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 blur-3xl rounded-full -mr-12 -mt-12 group-hover:bg-blue-500/20 transition-all duration-700"></div>
                            <div className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-2 drop-shadow-sm">Total Payable</div>
                            <div className="text-3xl font-black tracking-tight text-white flex items-baseline gap-2">
                                <span className="text-lg font-bold text-blue-400">{currentSym}</span>
                                <span className="drop-shadow-xl">{fmt(totals.grandTotalForeign)}</span>
                            </div>
                            {formData.currencyId !== 'BASE' && (
                                <div className="mt-3 flex items-center gap-2 text-[10px] font-black text-slate-500 bg-black/30 p-2 rounded-lg border border-white/5 italic">
                                    <Zap size={10} className="text-yellow-500" />
                                    <span>≈ {currencySymbol} {fmt(totals.grandTotalBase)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <DocumentGeneratorV2
                isOpen={showGenModal}
                onClose={() => setShowGenModal(false)}
                data={{
                    ...formData, items: items.filter(i => i.productId && Number(i.quantity) > 0),
                    grandTotalForeign: totals.grandTotalForeign, grandTotalBase: totals.grandTotalBase,
                    taxAmount: totals.taxAmount, taxPercent: taxPercent, itemsTotal: totals.itemsTotal,
                    type: type, currencySymbol: currentSym
                }}
                type={type} parties={parties} products={products} companyProfile={companyProfile} dataOwnerId={dataOwnerId} user={user} zIndex={zIndex + 10}
            />

            <JumboBagAllocationModal
                isOpen={showJumboEntry}
                onClose={() => setShowJumboEntry(false)}
                producedItems={items.filter(i => i.productId && Number(i.quantity) > 0).map(i => ({ productId: i.productId, productName: products.find(p => p.id === i.productId)?.name || 'Unknown', quantity: Number(i.quantity) }))}
                producedQtyMap={items.reduce((acc, i) => { if (i.productId) acc[i.productId] = (acc[i.productId] || 0) + Number(i.quantity); return acc; }, {})}
                onSave={handleJumboFinish}
                lastBagNoSeed={lastBagNoSeed}
                initialBags={jumboBags}
                user={user}
                dataOwnerId={dataOwnerId}
                showToast={showToast}
                mode="purchase"
            />

            <JumboBagSelectionModal
                isOpen={showJumboSelection}
                onClose={() => setShowJumboSelection(false)}
                availableBags={availableBags}
                onSave={(selectedBags) => {
                    if (activeBagRowIndex !== null) {
                        const newItems = [...items];
                        const row = newItems[activeBagRowIndex];
                        row.selectedBags = selectedBags;
                        const totalWeight = selectedBags.reduce((sum, b) => sum + Number(b.qty), 0);
                        row.quantity = totalWeight;
                        row.pieces = selectedBags.length;
                        const rate = Number(row.rate) || 0;
                        row.total = totalWeight * rate;
                        setItems(newItems);
                    }
                    setShowJumboSelection(false);
                    setActiveBagRowIndex(null);
                    setActiveBagProduct(null);
                }}
                products={products}
                initialSelectedIds={items[activeBagRowIndex]?.selectedBags?.map(b => b.id) || []}
                targetProductId={activeBagProduct?.id}
            />
        </>,
        document.body
    );
};

export default InventoryVoucherV2;
