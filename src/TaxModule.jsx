import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

// Force dark text inside TaxModule (overrides ManagementDashboard's white text)
const inputClass = "w-full px-3 py-2 border border-slate-300 rounded-lg text-xs outline-none focus:border-[#1e3264] focus:ring-1 focus:ring-[#1e3264]/20 text-gray-900 bg-white";

const TABS = [
  { id: 'purchase', label: '📥 Purchase / GD Import' },
  { id: 'registered', label: '🧾 Registered Sales' },
  { id: 'unregistered', label: '📄 Unregistered Sales' }
];

export default function TaxModule({ onClose, parties = [], products = [], taxRates = [], user, dataOwnerId }) {
  const [activeTab, setActiveTab] = useState('purchase');
  const [entries, setEntries] = useState({ purchase: [], registered: [], unregistered: [] });
  const [loading, setLoading] = useState(true);
  const uid = dataOwnerId || user?.uid || '';

  // Load existing tax entries
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const collections = ['tax_purchase', 'tax_sales_registered', 'tax_sales_unregistered'];
        const keys = ['purchase', 'registered', 'unregistered'];
        const results = await Promise.all(
          collections.map(c => getDocs(query(collection(db, c), orderBy('date', 'desc'))))
        );
        const data = {};
        keys.forEach((k, i) => {
          data[k] = results[i].docs.map(d => ({ id: d.id, ...d.data() }));
        });
        setEntries(data);
      } catch (e) { console.error('Tax load error:', e); }
      setLoading(false);
    };
    load();
  }, []);

  return (<>
    <style>{`.tax-input input,.tax-input select,.tax-input textarea{color:#1e293b!important;background:#fff!important}.tax-input select option{color:#1e293b!important;background:#fff!important}.tax-input input::placeholder{color:#94a3b8!important}`}</style>
    <div className="tax-input fixed inset-0 z-[10000] bg-white flex flex-col">
      {/* Header */}
      <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-black">TX</div>
          <span className="text-sm font-bold">ACCPRO TAX</span>
          <span className="text-[9px] text-blue-200/60 ml-2">Connected to ACCPRO DB</span>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-5 py-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === tab.id ? 'bg-[#1e3264] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'purchase' && (
          <PurchaseTab parties={parties} products={products} taxRates={taxRates} uid={uid}
            entries={entries.purchase} setEntries={setEntries} keys={['purchase','registered','unregistered']} />
        )}
        {activeTab === 'registered' && (
          <RegisteredTab parties={parties} products={products} taxRates={taxRates} uid={uid}
            entries={entries.registered} setEntries={setEntries} keys={['purchase','registered','unregistered']} />
        )}
        {activeTab === 'unregistered' && (
          <UnregisteredTab parties={parties} products={products} taxRates={taxRates} uid={uid}
            entries={entries.unregistered} setEntries={setEntries} keys={['purchase','registered','unregistered']} />
        )}
      </div>
    </div>
    </>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────
const formatNum = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });

// ─── Purchase Tab ───────────────────────────────────────────────────────────────
function PurchaseTab({ parties, products, taxRates, uid, entries, setEntries, keys }) {
  const [showForm, setShowForm] = useState(false);
  const [gdNo, setGdNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedTax, setSelectedTax] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [total, setTotal] = useState(0);
  const [supSearch, setSupSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [showSup, setShowSup] = useState(false);
  const [showProd, setShowProd] = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);

  // Track which field user is editing: 'rate' or 'amount'
  let lastEdited = 'rate';

  const onRateChange = (v) => {
    setRate(v);
    const q = Number(qty) || 0; const r = Number(v) || 0;
    if (q > 0) setAmount(String(q * r));
    calcTotal(q, r, Number(amount) || 0);
  };

  const onAmountChange = (v) => {
    setAmount(v);
    const q = Number(qty) || 0; const a = Number(v) || 0;
    if (q > 0) setRate(String(a / q));
    calcTotal(q, Number(rate) || 0, a);
  };

  const onQtyChange = (v) => {
    setQty(v);
    const q = Number(v) || 0; const r = Number(rate) || 0; const a = Number(amount) || 0;
    if (r > 0) setAmount(String(q * r));
    else if (a > 0) setRate(String(a / (q || 1)));
    calcTotal(q, r, a);
  };

  const calcTotal = (q, r, a) => {
    const val = a > 0 ? a : (q * r);
    const tax = taxRates.find(t => t.id === selectedTax);
    const rPct = tax ? Number(tax.rate) || 0 : 0;
    setTaxRate(rPct);
    setTotal(val + (val * rPct / 100));
  };

  const filteredSuppliers = useMemo(() =>
    supSearch ? parties.filter(s => (s.name||'').toLowerCase().includes(supSearch.toLowerCase())) : parties,
    [parties, supSearch]
  );

  const filteredProducts = useMemo(() =>
    prodSearch ? products.filter(p => (p.name||'').toLowerCase().includes(prodSearch.toLowerCase())) : products,
    [products, prodSearch]
  );

  const save = async () => {
    if (!selectedSupplier || !selectedProduct || !qty || (!rate && !amount)) { alert('Fill: Supplier, Product, Qty, and Rate or Amount'); return; }
    const tax = taxRates.find(t => t.id === selectedTax);
    const finalAmount = Number(amount||0) || (Number(qty||0) * Number(rate||0));
    const finalRate = Number(rate||0) || (finalAmount / (Number(qty||0) || 1));
    
    // Save to ACCPRO TAX collection
    const taxDocRef = await addDoc(collection(db, 'tax_purchase'), {
      gdNo, date, supplierName: selectedSupplier, productName: selectedProduct,
      qty: Number(qty), rate: finalRate, taxableValue: finalAmount,
      taxId: selectedTax||null, taxName: tax?.name||null, taxRate, total,
      userId: uid, createdAt: serverTimestamp()
    });
    
    // Also save to ACCPRO's main invoices collection so it appears in ledgers
    try {
      const party = parties.find(p => p.name === selectedSupplier);
      const item = products.find(p => p.name === selectedProduct);
      await addDoc(collection(db, 'invoices'), {
        type: 'purchase_apt',
        date,
        refNo: gdNo || `TAX-${Date.now()}`,
        userId: uid,
        partyId: party?.id || null,
        partyName: selectedSupplier,
        taxVoucherId: taxDocRef.id,
        items: [{
          productId: item?.id || null,
          productName: selectedProduct,
          qty: Number(qty),
          rate: finalRate,
          amount: finalAmount
        }],
        taxableValue: finalAmount,
        taxId: selectedTax||null,
        taxName: tax?.name||null,
        taxRate: Number(taxRate),
        taxAmount: finalAmount * Number(taxRate) / 100,
        total: Number(total),
        totalAmount: Number(total),
        amount: Number(total),
        narration: `GD Import: ${gdNo || 'N/A'}`,
        createdAt: serverTimestamp()
      });
      console.log('[TAX] Also saved to ACCPRO invoices collection for ledger integration');
    } catch(e) {
      console.warn('[TAX] Could not save to ACCPRO invoices:', e.message);
    }
    
    setShowForm(false); resetForm();
    const snap = await getDocs(query(collection(db, 'tax_purchase'), orderBy('date','desc')));
    const newEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setEntries(prev => ({ ...prev, purchase: newEntries }));
  };

  const resetForm = () => { setGdNo(''); setDate(new Date().toISOString().split('T')[0]); setSelectedSupplier(''); setSelectedProduct(''); setSupSearch(''); setProdSearch(''); setQty(''); setRate(''); setAmount(''); setSelectedTax(''); setTaxRate(0); setTotal(0); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Purchase / Import / GD</h3>
        <button onClick={() => { setShowForm(!showForm); if(!showForm) resetForm(); }}
          className="px-4 py-2 bg-[#1e3264] text-white text-xs font-bold rounded-lg hover:bg-[#2b5797]">
          {showForm ? '✕ Cancel' : '+ New Entry'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">GD No.(Ref)</label><input value={gdNo} onChange={e => setGdNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1e3264]"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1e3264] text-slate-800"/></div>
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Supplier <span className="text-red-400">*</span></label>
            <input value={supSearch} onFocus={() => setShowSup(true)} onBlur={() => setTimeout(() => setShowSup(false), 200)} onChange={e => setSupSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1e3264]"/>
            {showSup && filteredSuppliers.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredSuppliers.slice(0, 30).map(s => (
                  <div key={s.id} onMouseDown={() => { setSelectedSupplier(s.name); setSupSearch(s.name); setShowSup(false); }} className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{s.name}</div>
                ))}
              </div>
            )}
            {selectedSupplier && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedSupplier}</div>}
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item <span className="text-red-400">*</span></label>
            <input value={prodSearch} onFocus={() => setShowProd(true)} onBlur={() => setTimeout(() => setShowProd(false), 200)} onChange={e => setProdSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-[#1e3264] text-slate-800"/>
            {showProd && filteredProducts.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredProducts.slice(0, 30).map(p => (
                  <div key={p.id} onMouseDown={() => { setSelectedProduct(p.name); setProdSearch(p.name); setShowProd(false); }} className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-600">({p.group})</span>}</div>
                ))}
              </div>
            )}
            {selectedProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedProduct}</div>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><input type="number" value={qty} onChange={e => onQtyChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><input type="number" value={rate} onChange={e => onRateChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount/Assessed Value</label><input type="number" value={amount} onChange={e => onAmountChange(e.target.value)} placeholder="Auto from Rate×Qty" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div>
              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax Rate</label>
              <select value={selectedTax} onChange={e => { setSelectedTax(e.target.value); setTimeout(() => calcTotal(Number(qty)||0, Number(rate)||0, Number(amount)||0), 0); }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
                <option value="">No Tax</option>
                {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>)}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(Number(amount||0))}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax @ {taxRate}%</div><div className="text-sm font-black font-mono text-blue-700">{formatNum(Number(amount||0) * taxRate / 100)}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(total)}</div></div>
          </div>

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Entry</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 && <div className="text-center py-12 text-xs text-slate-400">No entries yet.</div>}
        {entries.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr>
              <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">GD</th>
              <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Supplier</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Product</th>
              <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Qty</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
              <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
            </tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                  <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.gdNo}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{e.supplierName}</td><td className="px-3 py-2.5 text-slate-800">{e.productName}</td>
                  <td className="px-3 py-2.5 text-right text-slate-800">{e.qty}</td>
                  <td className="px-3 py-2.5 text-right text-slate-800">₹{formatNum(e.taxableValue)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-800">{e.taxName ? <span className="text-blue-600">{e.taxName}</span> : '-'}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-slate-800">₹{formatNum(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {viewingEntry && (
        <EntryViewerModal entry={viewingEntry} collectionName="tax_purchase"
          parties={parties} products={products} taxRates={taxRates} uid={uid}
          onClose={() => setViewingEntry(null)}
          onUpdated={() => {
            getDocs(query(collection(db, 'tax_purchase'), orderBy('date','desc'))).then(snap => {
              setEntries(prev => ({ ...prev, purchase: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
            });
          }} />
      )}
    </div>
  );
}

// ─── Entry Viewer/Editor Modal (shared across all tabs) ─────────────────────
function EntryViewerModal({ entry, collectionName, parties, products, taxRates, uid, onClose, onUpdated }) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [eRef, setERef] = useState('');
  const [eDate, setEDate] = useState('');
  const [eParty, setEParty] = useState('');
  const [eProduct, setEProduct] = useState('');
  const [eQty, setEQty] = useState('');
  const [eRate, setERate] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eTaxId, setETaxId] = useState('');
  const [eTotal, setETotal] = useState(0);
  const [partySearch, setPartySearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [showParty, setShowParty] = useState(false);
  const [showProd, setShowProd] = useState(false);

  const isPurchase = collectionName === 'tax_purchase';
  const refLabel = isPurchase ? 'GD No.' : 'Ref No.';
  const partyLabel = isPurchase ? 'Supplier' : 'Customer';
  const refField = isPurchase ? 'gdNo' : 'refNo';
  const partyField = isPurchase ? 'supplierName' : 'customer';

  useEffect(() => {
    if (entry) {
      setERef(entry[refField] || entry.refNo || '');
      setEDate(entry.date || '');
      setEParty(entry[partyField] || entry.supplierName || entry.customer || '');
      setEProduct(entry.productName || '');
      setEQty(String(entry.qty || ''));
      setERate(String(entry.rate || ''));
      setEAmount(String(entry.taxableValue || ''));
      setETaxId(entry.taxId || '');
      setETotal(entry.total || 0);
    }
  }, [entry, refField, partyField]);

  useEffect(() => {
    const q = Number(eQty) || 0;
    const r = Number(eRate) || 0;
    const a = Number(eAmount) || 0;
    const val = a > 0 ? a : (q * r);
    const tax = taxRates.find(t => t.id === eTaxId);
    const rPct = tax ? Number(tax.rate) || 0 : 0;
    setETotal(val + (val * rPct / 100));
  }, [eQty, eRate, eAmount, eTaxId, taxRates]);

  const onQtyChange = (v) => {
    setEQty(v);
    const q = Number(v) || 0; const r = Number(eRate) || 0; const a = Number(eAmount) || 0;
    if (r > 0) setEAmount(String(q * r));
    else if (a > 0) setERate(String(a / (q || 1)));
  };
  const onRateChange = (v) => {
    setERate(v);
    const q = Number(eQty) || 0; const r = Number(v) || 0;
    if (q > 0) setEAmount(String(q * r));
  };
  const onAmountChange = (v) => {
    setEAmount(v);
    const q = Number(eQty) || 0; const a = Number(v) || 0;
    if (q > 0) setERate(String(a / q));
  };

  const filteredParties = parties.filter(s => partySearch ? (s.name||'').toLowerCase().includes(partySearch.toLowerCase()) : true);
  const filteredProducts = products.filter(p => prodSearch ? (p.name||'').toLowerCase().includes(prodSearch.toLowerCase()) : true);

  const handleSave = async () => {
    if (!eParty || !eProduct || !eQty || (!eRate && !eAmount)) {
      alert('Fill: ' + partyLabel + ', Product, Qty, Rate/Amount');
      return;
    }
    setSaving(true);
    try {
      const q = Number(eQty) || 0;
      const r = Number(eRate) || 0;
      const a = Number(eAmount) || 0;
      const finalAmount = a > 0 ? a : (q * r);
      const finalRate = r > 0 ? r : (finalAmount / (q || 1));
      const tax = taxRates.find(t => t.id === eTaxId);
      const rPct = tax ? Number(tax.rate) || 0 : 0;
      const taxAmt = finalAmount * rPct / 100;
      const finalTotal = finalAmount + taxAmt;

      const updateData = { date: eDate, productName: eProduct, qty: q, rate: finalRate, taxableValue: finalAmount, taxId: eTaxId || null, taxName: tax?.name || null, taxRate: rPct, total: finalTotal, updatedAt: serverTimestamp() };
      updateData[refField] = eRef;
      updateData[partyField] = eParty;
      await updateDoc(doc(db, collectionName, entry.id), updateData);

      // Also update linked invoice
      const invoiceType = isPurchase ? 'purchase_apt' : (collectionName === 'tax_sales_registered' ? 'sales_reg_apt' : 'sales_unreg_apt');
      const qInv = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(qInv);
      const linked = snap.docs.find(d => { const dd = d.data(); return dd.taxVoucherId === entry.id && dd.type === invoiceType; });
      if (linked) {
        await updateDoc(doc(db, 'invoices', linked.id), {
          date: eDate, refNo: eRef || `TAX-${Date.now()}`, partyName: eParty,
          items: [{ productName: eProduct, qty: q, rate: finalRate, amount: finalAmount }],
          taxableValue: finalAmount, taxId: eTaxId || null, taxName: tax?.name || null, taxRate: rPct, taxAmount: taxAmt,
          total: finalTotal, totalAmount: finalTotal, amount: finalTotal, updatedAt: serverTimestamp()
        });
      }
      if (onUpdated) onUpdated();
      setIsEditing(false);
      alert('✅ Updated successfully!');
    } catch (e) { console.error('EntryViewerModal save error:', e); alert('Save failed: ' + e.message); }
    setSaving(false);
  };

  const taxOpt = taxRates.find(t => t.id === eTaxId);
  const rawAmt = Number(eAmount||0) || (Number(eQty||0) * Number(eRate||0));
  const taxPct = taxOpt ? Number(taxOpt.rate||0) : 0;

  return (
    <div className="fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center p-4 overflow-auto">
      <style>{`.evm input,.evm select{color:#1e293b!important;background:#fff!important}.evm select option{color:#1e293b!important}`}</style>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-auto overflow-hidden">
        <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-[10px] font-black">TX</div>
            <span className="text-sm font-bold">{isPurchase ? 'APT PUR' : (collectionName === 'tax_sales_registered' ? 'REG APT' : 'UNREG APT')} — {eRef || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 bg-white/15 text-white text-[10px] font-bold rounded-lg hover:bg-white/25">✏️ Edit</button>}
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>
        <div className="p-5 evm">
          {!isEditing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{refLabel}</label><div className="text-sm font-mono font-bold text-slate-800">{eRef || '—'}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label><div className="text-sm text-slate-800">{eDate || '—'}</div></div>
              </div>
              <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{partyLabel}</label><div className="text-sm font-medium text-slate-800">{eParty || '—'}</div></div>
              <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product</label><div className="text-sm text-slate-800">{eProduct || '—'}</div></div>
              <div className="grid grid-cols-4 gap-4">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><div className="text-sm font-mono text-slate-800">{eQty || 0}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><div className="text-sm font-mono text-slate-800">₹{formatNum(Number(eRate))}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label><div className="text-sm font-mono font-medium text-slate-800">₹{formatNum(Number(eAmount))}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax</label><div className="text-sm text-blue-700">{taxOpt?.name || 'No Tax'}</div></div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-base font-black font-mono text-slate-700">₹{formatNum(rawAmt)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax</div><div className="text-base font-black font-mono text-blue-700">₹{formatNum(rawAmt * taxPct / 100)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">₹{formatNum(eTotal)}</div></div>
              </div>
              {entry.gstin && <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">GSTIN</label><div className="text-sm font-mono text-slate-800">{entry.gstin}</div></div>}
              <div className="text-[9px] text-slate-400 text-right">ID: {entry.id}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{refLabel}</label>
                  <input value={eRef} onChange={e => setERef(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" /></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label>
                  <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" /></div>
              </div>
              <div className="relative">
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{partyLabel}</label>
                <input value={partySearch || eParty} onFocus={() => setShowParty(true)} onBlur={() => setTimeout(() => setShowParty(false), 200)} onChange={e => { setPartySearch(e.target.value); setEParty(''); }} placeholder={"Search " + partyLabel.toLowerCase() + "..."} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                {showParty && filteredParties.length > 0 && (<div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">{filteredParties.slice(0, 30).map(s => (<div key={s.id} onMouseDown={() => { setEParty(s.name); setPartySearch(''); setShowParty(false); }} className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{s.name}</div>))}</div>)}
                {eParty && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {eParty}</div>}
              </div>
              <div className="relative">
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product</label>
                <input value={prodSearch || eProduct} onFocus={() => setShowProd(true)} onBlur={() => setTimeout(() => setShowProd(false), 200)} onChange={e => { setProdSearch(e.target.value); setEProduct(''); }} placeholder="Search product..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                {showProd && filteredProducts.length > 0 && (<div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">{filteredProducts.slice(0, 30).map(p => (<div key={p.id} onMouseDown={() => { setEProduct(p.name); setProdSearch(''); setShowProd(false); }} className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name}</div>))}</div>)}
                {eProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {eProduct}</div>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><input type="number" value={eQty} onChange={e => onQtyChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" /></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><input type="number" value={eRate} onChange={e => onRateChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" /></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label><input type="number" value={eAmount} onChange={e => onAmountChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" /></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax</label>
                  <select value={eTaxId} onChange={e => setETaxId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
                    <option value="">No Tax</option>
                    {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>)}
                  </select></div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">₹{formatNum(rawAmt)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax</div><div className="text-sm font-black font-mono text-blue-700">₹{formatNum(eTotal - rawAmt)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-base font-black font-mono text-green-700">₹{formatNum(eTotal)}</div></div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg disabled:opacity-50">{saving ? '💾 Saving...' : '💾 Save Changes'}</button>
                <button onClick={() => setIsEditing(false)} className="px-6 py-3 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-300">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function RegisteredTab({ parties, products, taxRates, uid, entries, setEntries, keys }) {
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [gstin, setGstin] = useState('');
  const [refNo, setRefNo] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedTax, setSelectedTax] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [total, setTotal] = useState(0);
  const [custSearch, setCustSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [showCust, setShowCust] = useState(false);
  const [showProd, setShowProd] = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);

  const onRateChange = (v) => {
    setRate(v);
    const q = Number(qty) || 0; const r = Number(v) || 0;
    if (q > 0) setAmount(String(q * r));
    calcTotal(q, r, Number(amount) || 0);
  };

  const onAmountChange = (v) => {
    setAmount(v);
    const q = Number(qty) || 0; const a = Number(v) || 0;
    if (q > 0) setRate(String(a / q));
    calcTotal(q, Number(rate) || 0, a);
  };

  const onQtyChange = (v) => {
    setQty(v);
    const q = Number(v) || 0; const r = Number(rate) || 0; const a = Number(amount) || 0;
    if (r > 0) setAmount(String(q * r));
    else if (a > 0) setRate(String(a / (q || 1)));
    calcTotal(q, r, a);
  };

  const calcTotal = (q, r, a) => {
    const val = a > 0 ? a : (q * r);
    const tax = taxRates.find(t => t.id === selectedTax);
    const rPct = tax ? Number(tax.rate) || 0 : 0;
    setTaxRate(rPct);
    setTotal(val + (val * rPct / 100));
  };

  const filteredCustomers = useMemo(() =>
    custSearch ? parties.filter(p => (p.name||'').toLowerCase().includes(custSearch.toLowerCase())) : parties,
    [parties, custSearch]
  );

  const filteredProducts = useMemo(() =>
    prodSearch ? products.filter(p => (p.name||'').toLowerCase().includes(prodSearch.toLowerCase())) : products,
    [products, prodSearch]
  );

  const save = async () => {
    if (!selectedCustomer || !selectedProduct || !qty || (!rate && !amount)) {
      alert('Fill: Customer, Product, Qty, and Rate or Amount');
      return;
    }
    const tax = taxRates.find(t => t.id === selectedTax);
    const finalAmount = Number(amount||0) || (Number(qty||0) * Number(rate||0));
    const finalRate = Number(rate||0) || (finalAmount / (Number(qty||0) || 1));
    const taxAmt = finalAmount * (tax ? (Number(tax.rate)||0) : 0) / 100;
    const finalTotal = finalAmount + taxAmt;

    // Save to ACCPRO TAX collection
    const taxDocRef = await addDoc(collection(db, 'tax_sales_registered'), {
      date, customer: selectedCustomer, productName: selectedProduct, gstin, refNo,
      qty: Number(qty), rate: finalRate, taxableValue: finalAmount,
      taxId: selectedTax||null, taxName: tax?.name||null, taxRate: tax ? Number(tax.rate)||0 : 0, total: finalTotal,
      userId: uid, createdAt: serverTimestamp()
    });

    // Also save to ACCPRO's main invoices collection
    try {
      const party = parties.find(p => p.name === selectedCustomer);
      const item = products.find(p => p.name === selectedProduct);
      await addDoc(collection(db, 'invoices'), {
        type: 'sales_reg_apt',
        date,
        refNo: refNo || `REG-${Date.now()}`,
        userId: uid,
        partyId: party?.id || null,
        partyName: selectedCustomer,
        taxVoucherId: taxDocRef.id,
        items: [{
          productId: item?.id || null,
          productName: selectedProduct,
          qty: Number(qty),
          rate: finalRate,
          amount: finalAmount
        }],
        taxableValue: finalAmount,
        taxId: selectedTax||null,
        taxName: tax?.name||null,
        taxRate: tax ? Number(tax.rate)||0 : 0,
        taxAmount: taxAmt,
        total: finalTotal,
        totalAmount: finalTotal,
        amount: finalTotal,
        narration: `Reg Sale: ${refNo || 'N/A'} - ${selectedCustomer}`,
        createdAt: serverTimestamp()
      });
    } catch(e) {
      console.warn('[TAX] Could not save to ACCPRO invoices:', e.message);
    }

    setShowForm(false);
    const snap = await getDocs(query(collection(db, 'tax_sales_registered'), orderBy('date','desc')));
    setEntries(prev => ({ ...prev, registered: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setSelectedCustomer(''); setSelectedProduct(''); setGstin(''); setRefNo('');
    setCustSearch(''); setProdSearch(''); setQty(''); setRate(''); setAmount('');
    setSelectedTax(''); setTaxRate(0); setTotal(0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Registered Users Sales</h3>
        <button onClick={() => { setShowForm(!showForm); if(!showForm) resetForm(); }}
          className="px-4 py-2 bg-[#1e3264] text-white text-xs font-bold rounded-lg hover:bg-[#2b5797]">
          {showForm ? '✕ Cancel' : '+ New Sale'}
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Ref No.</label><input value={refNo} onChange={e => setRefNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">GSTIN</label><input value={gstin} onChange={e => setGstin(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Customer <span className="text-red-400">*</span></label>
            <input value={custSearch} onFocus={() => setShowCust(true)} onBlur={() => setTimeout(() => setShowCust(false), 200)}
              onChange={e => setCustSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/>
            {showCust && filteredCustomers.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredCustomers.slice(0, 30).map(p => (
                  <div key={p.id} onMouseDown={() => { setSelectedCustomer(p.name); setCustSearch(p.name); setShowCust(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name}</div>
                ))}
              </div>
            )}
            {selectedCustomer && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedCustomer}</div>}
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product <span className="text-red-400">*</span></label>
            <input value={prodSearch} onFocus={() => setShowProd(true)} onBlur={() => setTimeout(() => setShowProd(false), 200)}
              onChange={e => setProdSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/>
            {showProd && filteredProducts.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredProducts.slice(0, 30).map(p => (
                  <div key={p.id} onMouseDown={() => { setSelectedProduct(p.name); setProdSearch(p.name); setShowProd(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-600">({p.group})</span>}</div>
                ))}
              </div>
            )}
            {selectedProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedProduct}</div>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><input type="number" value={qty} onChange={e => onQtyChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><input type="number" value={rate} onChange={e => onRateChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label><input type="number" value={amount} onChange={e => onAmountChange(e.target.value)} placeholder="Auto from Rate×Qty" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div>
              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax Rate</label>
              <select value={selectedTax} onChange={e => { setSelectedTax(e.target.value); setTimeout(() => calcTotal(Number(qty)||0, Number(rate)||0, Number(amount)||0), 0); }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
                <option value="">No Tax</option>
                {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>)}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">₹{formatNum(Number(amount||0) || (Number(qty||0)*Number(rate||0)))}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax @ {taxRate}%</div><div className="text-sm font-black font-mono text-blue-700">₹{formatNum((Number(amount||0) || (Number(qty||0)*Number(rate||0))) * taxRate / 100)}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">₹{formatNum(total)}</div></div>
          </div>

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Registered Sale</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 ? <div className="text-center py-8 text-xs text-slate-400">No entries.</div> : (
          <table className="w-full text-xs"><thead className="bg-slate-50"><tr>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Ref</th>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Customer</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Product</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Qty</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
          </tr></thead><tbody>
            {entries.map(e => (
              <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.refNo}</td>
                <td className="px-3 py-2.5 font-medium text-slate-800">{e.customer}</td><td className="px-3 py-2.5 text-slate-800">{e.productName}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.qty}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">₹{formatNum(e.taxableValue)}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.taxName ? <span className="text-blue-600">{e.taxName}</span> : '-'}</td>
                <td className="px-3 py-2.5 text-right font-bold text-slate-800">₹{formatNum(e.total)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {viewingEntry && (
        <EntryViewerModal entry={viewingEntry} collectionName="tax_sales_registered"
          parties={parties} products={products} taxRates={taxRates} uid={uid}
          onClose={() => setViewingEntry(null)}
          onUpdated={() => {
            getDocs(query(collection(db, 'tax_sales_registered'), orderBy('date','desc'))).then(snap => {
              setEntries(prev => ({ ...prev, registered: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
            });
          }} />
      )}
    </div>
  );
}

// ─── Unregistered Sales Tab ──────────────────────────────────────────────────────
function UnregisteredTab({ parties, products, taxRates, uid, entries, setEntries, keys }) {
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [refNo, setRefNo] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedTax, setSelectedTax] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [total, setTotal] = useState(0);
  const [custSearch, setCustSearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [showCust, setShowCust] = useState(false);
  const [showProd, setShowProd] = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);

  const onRateChange = (v) => {
    setRate(v);
    const q = Number(qty) || 0; const r = Number(v) || 0;
    if (q > 0) setAmount(String(q * r));
    calcTotal(q, r, Number(amount) || 0);
  };

  const onAmountChange = (v) => {
    setAmount(v);
    const q = Number(qty) || 0; const a = Number(v) || 0;
    if (q > 0) setRate(String(a / q));
    calcTotal(q, Number(rate) || 0, a);
  };

  const onQtyChange = (v) => {
    setQty(v);
    const q = Number(v) || 0; const r = Number(rate) || 0; const a = Number(amount) || 0;
    if (r > 0) setAmount(String(q * r));
    else if (a > 0) setRate(String(a / (q || 1)));
    calcTotal(q, r, a);
  };

  const calcTotal = (q, r, a) => {
    const val = a > 0 ? a : (q * r);
    const tax = taxRates.find(t => t.id === selectedTax);
    const rPct = tax ? Number(tax.rate) || 0 : 0;
    setTaxRate(rPct);
    setTotal(val + (val * rPct / 100));
  };

  const filteredCustomers = useMemo(() =>
    custSearch ? parties.filter(p => (p.name||'').toLowerCase().includes(custSearch.toLowerCase())) : parties,
    [parties, custSearch]
  );

  const filteredProducts = useMemo(() =>
    prodSearch ? products.filter(p => (p.name||'').toLowerCase().includes(prodSearch.toLowerCase())) : products,
    [products, prodSearch]
  );

  const save = async () => {
    if (!selectedCustomer || !selectedProduct || !qty || (!rate && !amount)) {
      alert('Fill: Customer, Product, Qty, and Rate or Amount');
      return;
    }
    const tax = taxRates.find(t => t.id === selectedTax);
    const finalAmount = Number(amount||0) || (Number(qty||0) * Number(rate||0));
    const finalRate = Number(rate||0) || (finalAmount / (Number(qty||0) || 1));
    const taxAmt = finalAmount * (tax ? (Number(tax.rate)||0) : 0) / 100;
    const finalTotal = finalAmount + taxAmt;

    // Save to ACCPRO TAX collection
    const taxDocRef = await addDoc(collection(db, 'tax_sales_unregistered'), {
      date, customer: selectedCustomer, productName: selectedProduct, refNo,
      qty: Number(qty), rate: finalRate, taxableValue: finalAmount,
      taxId: selectedTax||null, taxName: tax?.name||null, taxRate: tax ? Number(tax.rate)||0 : 0, total: finalTotal,
      userId: uid, createdAt: serverTimestamp()
    });

    // Also save to ACCPRO's main invoices collection
    try {
      const party = parties.find(p => p.name === selectedCustomer);
      const item = products.find(p => p.name === selectedProduct);
      await addDoc(collection(db, 'invoices'), {
        type: 'sales_unreg_apt',
        date,
        refNo: refNo || `UNREG-${Date.now()}`,
        userId: uid,
        partyId: party?.id || null,
        partyName: selectedCustomer,
        taxVoucherId: taxDocRef.id,
        items: [{
          productId: item?.id || null,
          productName: selectedProduct,
          qty: Number(qty),
          rate: finalRate,
          amount: finalAmount
        }],
        taxableValue: finalAmount,
        taxId: selectedTax||null,
        taxName: tax?.name||null,
        taxRate: tax ? Number(tax.rate)||0 : 0,
        taxAmount: taxAmt,
        total: finalTotal,
        totalAmount: finalTotal,
        amount: finalTotal,
        narration: `Unreg Sale: ${refNo || 'N/A'} - ${selectedCustomer}`,
        createdAt: serverTimestamp()
      });
    } catch(e) {
      console.warn('[TAX] Could not save to ACCPRO invoices:', e.message);
    }

    setShowForm(false);
    const snap = await getDocs(query(collection(db, 'tax_sales_unregistered'), orderBy('date','desc')));
    setEntries(prev => ({ ...prev, unregistered: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setSelectedCustomer(''); setSelectedProduct(''); setRefNo('');
    setCustSearch(''); setProdSearch(''); setQty(''); setRate(''); setAmount('');
    setSelectedTax(''); setTaxRate(0); setTotal(0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Unregistered Users Sales</h3>
        <button onClick={() => { setShowForm(!showForm); if(!showForm) resetForm(); }}
          className="px-4 py-2 bg-[#1e3264] text-white text-xs font-bold rounded-lg hover:bg-[#2b5797]">
          {showForm ? '✕ Cancel' : '+ New Sale'}
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Ref No.</label><input value={refNo} onChange={e => setRefNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Customer <span className="text-red-400">*</span></label>
            <input value={custSearch} onFocus={() => setShowCust(true)} onBlur={() => setTimeout(() => setShowCust(false), 200)}
              onChange={e => setCustSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/>
            {showCust && filteredCustomers.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredCustomers.slice(0, 30).map(p => (
                  <div key={p.id} onMouseDown={() => { setSelectedCustomer(p.name); setCustSearch(p.name); setShowCust(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name}</div>
                ))}
              </div>
            )}
            {selectedCustomer && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedCustomer}</div>}
          </div>

          <div className="relative">
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product <span className="text-red-400">*</span></label>
            <input value={prodSearch} onFocus={() => setShowProd(true)} onBlur={() => setTimeout(() => setShowProd(false), 200)}
              onChange={e => setProdSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/>
            {showProd && filteredProducts.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredProducts.slice(0, 30).map(p => (
                  <div key={p.id} onMouseDown={() => { setSelectedProduct(p.name); setProdSearch(p.name); setShowProd(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-600">({p.group})</span>}</div>
                ))}
              </div>
            )}
            {selectedProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedProduct}</div>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><input type="number" value={qty} onChange={e => onQtyChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><input type="number" value={rate} onChange={e => onRateChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label><input type="number" value={amount} onChange={e => onAmountChange(e.target.value)} placeholder="Auto from Rate×Qty" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div>
              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax Rate</label>
              <select value={selectedTax} onChange={e => { setSelectedTax(e.target.value); setTimeout(() => calcTotal(Number(qty)||0, Number(rate)||0, Number(amount)||0), 0); }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
                <option value="">No Tax</option>
                {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>)}
              </select>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">₹{formatNum(Number(amount||0) || (Number(qty||0)*Number(rate||0)))}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax @ {taxRate}%</div><div className="text-sm font-black font-mono text-blue-700">₹{formatNum((Number(amount||0) || (Number(qty||0)*Number(rate||0))) * taxRate / 100)}</div></div>
            <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">₹{formatNum(total)}</div></div>
          </div>

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Unregistered Sale</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 ? <div className="text-center py-8 text-xs text-slate-400">No entries.</div> : (
          <table className="w-full text-xs"><thead className="bg-slate-50"><tr>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Ref</th>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Customer</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Product</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Qty</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
          </tr></thead><tbody>
            {entries.map(e => (
              <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.refNo}</td>
                <td className="px-3 py-2.5 font-medium text-slate-800">{e.customer}</td><td className="px-3 py-2.5 text-slate-800">{e.productName}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.qty}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">₹{formatNum(e.taxableValue)}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.taxName ? <span className="text-blue-600">{e.taxName}</span> : '-'}</td>
                <td className="px-3 py-2.5 text-right font-bold text-slate-800">₹{formatNum(e.total)}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {viewingEntry && (
        <EntryViewerModal entry={viewingEntry} collectionName="tax_sales_unregistered"
          parties={parties} products={products} taxRates={taxRates} uid={uid}
          onClose={() => setViewingEntry(null)}
          onUpdated={() => {
            getDocs(query(collection(db, 'tax_sales_unregistered'), orderBy('date','desc'))).then(snap => {
              setEntries(prev => ({ ...prev, unregistered: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
            });
          }} />
      )}
    </div>
  );
}


