import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, updateDoc, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import HscodeRules from './HscodeRules';
import TaxCalcRules from './TaxCalcRules';
import AllAptDaybook from './AllAptDaybook';

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
  const [showMenu, setShowMenu] = useState(false);
  const [showHscodeRules, setShowHscodeRules] = useState(false);
  const [showTaxCalcRules, setShowTaxCalcRules] = useState(false);
  const [showAptDaybook, setShowAptDaybook] = useState(false);
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
        <div className="flex items-center gap-2 relative">
          <button onClick={() => setShowMenu(!showMenu)} className="text-white/70 hover:text-white text-lg leading-none px-1">☰</button>
          {showMenu && (
            <div className="absolute top-8 right-0 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 min-w-[180px] z-[10005]">
              <button onClick={() => { setShowHscodeRules(true); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2">
                <span className="text-emerald-600">📋</span> HSCODE RULES
              </button>
              <button onClick={() => { setShowTaxCalcRules(true); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2">
                <span className="text-purple-600">🧮</span> TAX CALCULATION RULES
              </button>
              <button onClick={() => { setShowAptDaybook(true); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-700 flex items-center gap-2">
                <span className="text-amber-600">📊</span> ALL TAX TRANSACTIONS
              </button>
            </div>
          )}
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
        </div>
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
      {showMenu && <div className="fixed inset-0 z-[10004]" onClick={() => setShowMenu(false)} />}
    </div>
    {showHscodeRules && (
      <HscodeRules onClose={() => setShowHscodeRules(false)} products={products} taxRates={taxRates} uid={uid} />
    )}
    {showTaxCalcRules && (
      <TaxCalcRules onClose={() => setShowTaxCalcRules(false)} taxRates={taxRates} uid={uid} />
    )}
    {showAptDaybook && (
      <AllAptDaybook onClose={() => setShowAptDaybook(false)} products={products} taxRates={taxRates} />
    )}
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
  const [supSearch, setSupSearch] = useState('');
  const [showSup, setShowSup] = useState(false);
  const [viewingEntry, setViewingEntry] = useState(null);
  const [hsRules, setHsRules] = useState([]);
  const [taxCreditTo, setTaxCreditTo] = useState({ id: '', name: '' });
  const [creditSearch, setCreditSearch] = useState('');
  const [showCredit, setShowCredit] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    getDocs(query(collection(db, 'hs_code_rules'), orderBy('createdAt', 'desc'))).then(snap => {
      setHsRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  const calcItemTaxes = (item, hsRulesList) => {
    const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
    if (!item.hscode || rawVal <= 0) return { hsImpositions: [], itemTaxTotal: 0 };
    const rule = (hsRulesList || hsRules).find(r => r.hsCode === item.hscode && (r.category === 'Import' || r.category === 'Local Purchase' || r.category === 'Both'));
    if (!rule || !rule.impositions || rule.impositions.length === 0) return { hsImpositions: [], itemTaxTotal: 0 };
    const results = [];
    const taxAmountMap = {};
    rule.impositions.forEach((imp, idx) => {
      let taxAmt;
      if (imp.baseOn === 'assessed_value') { taxAmt = rawVal * imp.percentage / 100; }
      else if (imp.baseOn === 'assessed_value_plus') {
        const refTaxIds = imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : []);
        let parentTotal = 0;
        refTaxIds.forEach(ptId => { parentTotal += (taxAmountMap[ptId] || 0); });
        taxAmt = (rawVal + parentTotal) * imp.percentage / 100;
      } else { taxAmt = 0; }
      taxAmountMap[imp.taxId] = taxAmt;
      results.push({ ...imp, calculatedAmount: taxAmt, index: idx });
    });
    return { hsImpositions: results, itemTaxTotal: results.reduce((s, r) => s + r.calculatedAmount, 0) };
  };

  const addItem = () => {
    setItems(prev => [...prev, { id: Date.now() + Math.random(), productName: '', hscode: '', qty: '', rate: '', amount: '', prodSearch: '', showProd: false, hsImpositions: [], itemTaxTotal: 0 }]);
  };

  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id));

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      let updated = { ...item, [field]: value };
      if (field === 'qty' || field === 'rate') {
        const q = Number(field === 'qty' ? value : item.qty) || 0;
        const r = Number(field === 'rate' ? value : item.rate) || 0;
        if (q > 0 && r > 0) updated.amount = String(q * r);
      }
      const taxes = calcItemTaxes(updated, hsRules);
      updated.hsImpositions = taxes.hsImpositions;
      updated.itemTaxTotal = taxes.itemTaxTotal;
      return updated;
    }));
  };

  const totals = useMemo(() => {
    let totalItemValue = 0, totalTaxes = 0;
    const taxBreakdown = {};
    items.forEach(item => {
      const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
      totalItemValue += rawVal;
      totalTaxes += Number(item.itemTaxTotal || 0);
      (item.hsImpositions || []).forEach(imp => {
        const key = imp.taxId || imp.taxName;
        if (!taxBreakdown[key]) taxBreakdown[key] = { taxName: imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax', percentage: imp.percentage, totalAmount: 0 };
        taxBreakdown[key].totalAmount += Number(imp.calculatedAmount || 0);
      });
    });
    return { totalItemValue, totalTaxes, grandTotal: totalItemValue + totalTaxes, taxBreakdown };
  }, [items, taxRates]);

  const allAppliedTaxes = useMemo(() => {
    const map = {};
    items.forEach(item => (item.hsImpositions || []).forEach(imp => {
      const key = imp.taxId || imp.taxName;
      if (!map[key]) map[key] = { ...imp, calculatedAmount: 0 };
      map[key].calculatedAmount += Number(imp.calculatedAmount || 0);
    }));
    return Object.values(map);
  }, [items]);

  const hasAnyHsTaxes = items.some(i => (i.hsImpositions || []).length > 0);

  const save = async () => {
    if (!selectedSupplier || items.length === 0) { alert('Fill: Supplier and at least one item'); return; }
    for (let i = 0; i < items.length; i++) {
      if (!items[i].productName || !items[i].qty || (!items[i].rate && !items[i].amount)) {
        alert('Item #' + (i+1) + ': Fill Product, Qty, and Rate or Amount'); return;
      }
    }
    const saveItems = items.map(item => {
      const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
      return {
        productName: item.productName, hscode: item.hscode || '',
        qty: Number(item.qty) || 0, rate: Number(item.rate) || 0, amount: rawVal,
        hsImpositions: item.hsImpositions || [], itemTaxTotal: Number(item.itemTaxTotal || 0), itemValue: rawVal, itemGrandTotal: rawVal + Number(item.itemTaxTotal || 0)
      };
    });
    const taxDocRef = await addDoc(collection(db, 'tax_purchase'), {
      gdNo, date, supplierName: selectedSupplier,
      items: saveItems, appliedTaxes: allAppliedTaxes, taxBreakdown: totals.taxBreakdown,
      taxAmountTotal: totals.totalTaxes, itemValueTotal: totals.totalItemValue, grandTotal: totals.grandTotal,
      taxCreditTo: hasAnyHsTaxes ? taxCreditTo : null, userId: uid, createdAt: serverTimestamp()
    });
    try {
      const party = parties.find(p => p.name === selectedSupplier);
      await addDoc(collection(db, 'invoices'), {
        type: 'purchase_apt', date, refNo: gdNo || 'TAX-' + Date.now(), userId: uid,
        partyId: party?.id || null, partyName: selectedSupplier,
        items: saveItems, appliedTaxes: allAppliedTaxes, taxBreakdown: totals.taxBreakdown,
        taxAmountTotal: totals.totalTaxes, itemValueTotal: totals.totalItemValue, grandTotal: totals.grandTotal,
        taxCreditTo: hasAnyHsTaxes ? taxCreditTo : null, taxVoucherId: taxDocRef.id,
        taxableValue: totals.totalItemValue, total: totals.grandTotal, totalAmount: totals.grandTotal, amount: totals.grandTotal,
        narration: 'GD Import: ' + (gdNo || 'N/A'), createdAt: serverTimestamp()
      });
    } catch(e) { console.warn('[TAX] Could not save to ACCPRO invoices:', e.message); }
    setShowForm(false); resetForm();
    const snap = await getDocs(query(collection(db, 'tax_purchase'), orderBy('date','desc')));
    setEntries(prev => ({ ...prev, purchase: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
  };

  const resetForm = () => {
    setGdNo(''); setDate(new Date().toISOString().split('T')[0]);
    setSelectedSupplier(''); setSupSearch(''); setItems([]);
    setTaxCreditTo({ id: '', name: '' }); setCreditSearch('');
  };

  const filteredSuppliers = useMemo(() =>
    supSearch ? parties.filter(s => (s.name||'').toLowerCase().includes(supSearch.toLowerCase())) : parties, [parties, supSearch]
  );

  const filteredProducts = useMemo(() =>
    products, [products]
  );

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
          {/* Header */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">GD No.(Ref)</label><input value={gdNo} onChange={e => setGdNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/></div>
            <div className="relative">
              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Supplier <span className="text-red-400">*</span></label>
              <input value={supSearch} onFocus={() => setShowSup(true)} onBlur={() => setTimeout(() => setShowSup(false), 200)} onChange={e => setSupSearch(e.target.value)} placeholder="Type to search..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800"/>
              {showSup && filteredSuppliers.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {filteredSuppliers.slice(0, 30).map(s => (
                    <div key={s.id} onMouseDown={() => { setSelectedSupplier(s.name); setSupSearch(s.name); setShowSup(false); }} className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{s.name}</div>
                  ))}
                </div>
              )}
              {selectedSupplier && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedSupplier}</div>}
            </div>
          </div>

          {/* Multi-Item Section */}
          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold text-slate-400 uppercase">Items ({items.length})</span>
              <button onClick={addItem} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-200">+ Add Item</button>
            </div>
            {items.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">No items added. Click <b>"+ Add Item"</b> to add products.</div>
            )}
            {items.map((item, idx) => {
              const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
              const itemGrandTotal = rawVal + Number(item.itemTaxTotal || 0);
              const filteredProds = products.filter(p => item.prodSearch ? (p.name||'').toLowerCase().includes(item.prodSearch.toLowerCase()) : true);
              return (
                <div key={item.id} className="bg-slate-50 rounded-xl border border-slate-200 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-500">Item #{idx + 1}</span>
                    <button onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700 text-[10px] font-bold">✕ Remove</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                    <div className="relative">
                      <label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Product</label>
                      <input value={item.prodSearch || item.productName} onFocus={() => updateItem(item.id, 'showProd', true)} onBlur={() => setTimeout(() => updateItem(item.id, 'showProd', false), 200)}
                        onChange={e => { updateItem(item.id, 'prodSearch', e.target.value); if (!e.target.value) updateItem(item.id, 'productName', ''); }}
                        placeholder="Search product..." className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" />
                      {item.showProd && filteredProds.length > 0 && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                          {filteredProds.slice(0, 20).map(p => (
                            <div key={p.id} onMouseDown={() => {
                              const updatedItem = { ...item, productName: p.name, prodSearch: '', showProd: false, hscode: p.hscode || '' };
                              const taxes = calcItemTaxes(updatedItem, hsRules);
                              updatedItem.hsImpositions = taxes.hsImpositions; updatedItem.itemTaxTotal = taxes.itemTaxTotal;
                              setItems(prev => prev.map(i => i.id === item.id ? updatedItem : i));
                            }} className="px-2 py-1.5 text-[10px] hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-400">({p.group})</span>}</div>
                          ))}
                        </div>
                      )}
                      {item.productName && <div className="text-[8px] text-green-600 font-medium mt-0.5">✓ {item.productName}</div>}
                    </div>
                    <div>
                      <label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">HS Code</label>
                      <div className="text-xs font-mono font-bold text-slate-700 px-2 py-1.5 bg-white rounded border border-slate-200">{item.hscode || '— Auto from product —'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Qty</label><input type="number" value={item.qty} onChange={e => updateItem(item.id, 'qty', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                    <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Rate</label><input type="number" value={item.rate} onChange={e => updateItem(item.id, 'rate', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                    <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Assessed Value</label><input type="number" value={item.amount} onChange={e => updateItem(item.id, 'amount', e.target.value)} placeholder="Auto" className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                  </div>
                  {item.hsImpositions.length > 0 && (
                    <div className="bg-blue-50/50 rounded-lg border border-blue-100 p-2 space-y-0.5">
                      <div className="text-[8px] font-bold text-blue-600 uppercase">Taxes for this item</div>
                      {item.hsImpositions.map((imp, i) => (
                        <div key={i} className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-600">{imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax'} ({imp.percentage}%)</span>
                          <span className="font-mono font-bold text-blue-700">{formatNum(imp.calculatedAmount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center text-[10px] border-t border-blue-100 pt-0.5 mt-0.5">
                        <span className="font-bold text-slate-600">Item Total</span>
                        <span className="font-mono font-bold text-slate-700">{formatNum(itemGrandTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tax credited to */}
          {hasAnyHsTaxes && (
            <div className="relative">
              <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">🏦 Taxes & Duties credited to <span className="text-red-400">*</span></label>
              <input value={creditSearch || taxCreditTo.name}
                onFocus={() => setShowCredit(true)} onBlur={() => setTimeout(() => setShowCredit(false), 200)}
                onChange={e => { setCreditSearch(e.target.value); setTaxCreditTo({ id: '', name: '' }); }}
                placeholder="Search party, bank, or cash account..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
              {showCredit && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {parties.filter(p => creditSearch ? (p.name||'').toLowerCase().includes(creditSearch.toLowerCase()) : true).slice(0, 30).map(p => (
                    <div key={p.id} onMouseDown={() => { setTaxCreditTo({ id: p.id, name: p.name }); setCreditSearch(''); setShowCredit(false); }}
                      className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name}</div>
                  ))}
                </div>
              )}
              {taxCreditTo.name && <div className="mt-1 text-[10px] text-green-600 font-medium">✓ Credited to {taxCreditTo.name}</div>}
            </div>
          )}

          {/* Totals */}
          <div className="bg-slate-50 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-500">📦 Total Items Value:</span>
              <span className="font-mono font-bold text-slate-700">{formatNum(totals.totalItemValue)}</span>
            </div>
            {Object.keys(totals.taxBreakdown).length > 0 && (
              <div className="border-t border-slate-200 pt-1 space-y-1">
                <div className="text-[8px] font-bold text-slate-400 uppercase">🧾 Tax Breakup (Total of each tax type)</div>
                {Object.entries(totals.taxBreakdown).map(([key, tb]) => (
                  <div key={key} className="flex justify-between items-center text-[10px] pl-2">
                    <span className="text-slate-600">{tb.taxName} <span className="text-slate-400">({tb.percentage}%)</span></span>
                    <span className="font-mono font-bold text-blue-700">{formatNum(tb.totalAmount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center text-xs border-t border-slate-200 pt-1">
              <span className="font-bold text-slate-500">🧾 Total Taxes & Duties:</span>
              <span className="font-mono font-bold text-blue-700">{formatNum(totals.totalTaxes)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-t-2 border-slate-300 pt-1">
              <span className="font-bold text-slate-700">💰 Grand Total:</span>
              <span className="font-mono font-black text-green-700">{formatNum(totals.grandTotal)}</span>
            </div>
          </div>

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Entry ({items.length} item{items.length !== 1 ? 's' : ''})</button>
        </div>
      )}

      {/* Entries Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 && <div className="text-center py-12 text-xs text-slate-400">No entries yet.</div>}
        {entries.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr>
              <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">GD</th>
              <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Supplier</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Items</th>
              <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
              <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
            </tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                  <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.gdNo}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{e.supplierName}</td>
                  <td className="px-3 py-2.5 text-slate-800">{(e.items || []).length > 0 ? e.items.length + ' item(s)' : (e.productName || '-')}</td>
                  <td className="px-3 py-2.5 text-right text-slate-800">{formatNum(e.itemValueTotal || e.taxableValue || 0)}</td>
                  <td className="px-3 py-2.5 text-right text-blue-700 font-bold">{formatNum(e.taxAmountTotal || 0)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-slate-800">{formatNum(e.grandTotal || e.total || 0)}</td>
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
  const [showPwdPrompt, setShowPwdPrompt] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [eCreditTo, setECreditTo] = useState({ id: '', name: '' });
  const [eCreditSearch, setECreditSearch] = useState('');
  const [eShowCredit, setEShowCredit] = useState(false);
  // Multi-item state
  const [eItems, setEItems] = useState([]);
  const [hsRules, setHsRules] = useState([]);

  const isPurchase = collectionName === 'tax_purchase';
  const isMultiItem = isPurchase && entry?.items && Array.isArray(entry.items) && entry.items.length > 0;
  const refLabel = isPurchase ? 'GD No.' : 'Ref No.';
  const partyLabel = isPurchase ? 'Supplier' : 'Customer';
  const refField = isPurchase ? 'gdNo' : 'refNo';
  const partyField = isPurchase ? 'supplierName' : 'customer';

  // Load HS Code rules for multi-item tax recalculation
  useEffect(() => {
    getDocs(query(collection(db, 'hs_code_rules'), orderBy('createdAt', 'desc'))).then(snap => {
      setHsRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  // Calculate per-item taxes using HS Code rules
  const calcItemTaxes = (item, rules) => {
    const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
    if (!item.hscode || rawVal <= 0) return { hsImpositions: [], itemTaxTotal: 0 };
    const rule = (rules || hsRules).find(r => r.hsCode === item.hscode && (r.category === 'Import' || r.category === 'Local Purchase' || r.category === 'Both'));
    if (!rule || !rule.impositions || rule.impositions.length === 0) return { hsImpositions: [], itemTaxTotal: 0 };
    const results = [];
    const taxAmountMap = {};
    rule.impositions.forEach((imp, idx) => {
      let taxAmt;
      if (imp.baseOn === 'assessed_value') { taxAmt = rawVal * imp.percentage / 100; }
      else if (imp.baseOn === 'assessed_value_plus') {
        const refTaxIds = imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : []);
        let parentTotal = 0;
        refTaxIds.forEach(ptId => { parentTotal += (taxAmountMap[ptId] || 0); });
        taxAmt = (rawVal + parentTotal) * imp.percentage / 100;
      } else { taxAmt = 0; }
      taxAmountMap[imp.taxId] = taxAmt;
      results.push({ ...imp, calculatedAmount: taxAmt, index: idx });
    });
    return { hsImpositions: results, itemTaxTotal: results.reduce((s, r) => s + r.calculatedAmount, 0) };
  };

  useEffect(() => {
    if (entry) {
      setERef(entry[refField] || entry.refNo || '');
      setEDate(entry.date || '');
      setEParty(entry[partyField] || entry.supplierName || entry.customer || '');
      setEProduct(entry.productName || (entry.items?.[0]?.productName) || '');
      setEQty(String(entry.qty || (entry.items?.[0]?.qty) || ''));
      setERate(String(entry.rate || (entry.items?.[0]?.rate) || ''));
      setEAmount(String(entry.taxableValue || entry.itemValueTotal || ''));
      setETaxId(entry.taxId || '');
      setETotal(entry.total || entry.grandTotal || 0);
      setECreditTo(entry.taxCreditTo || { id: '', name: '' });
      setECreditSearch(entry.taxCreditTo?.name || '');
      // Load multi-item data
      if (isMultiItem) {
        setEItems(entry.items.map(item => ({ ...item, prodSearch: '', showProd: false })));
      } else {
        setEItems([]);
      }
    }
  }, [entry, refField, partyField, isMultiItem]);

  // For multi-item: compute totals
  const eTotals = isMultiItem ? (() => {
    let totalVal = 0, totalTax = 0;
    const breakdown = {};
    eItems.forEach(item => {
      const v = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
      totalVal += v;
      const t = Number(item.itemTaxTotal || 0);
      totalTax += t;
      (item.hsImpositions || []).forEach(imp => {
        const key = imp.taxId || imp.taxName;
        if (!breakdown[key]) breakdown[key] = { taxName: imp.taxName || taxRates.find(tx => tx.id === imp.taxId)?.name || 'Tax', percentage: imp.percentage, totalAmount: 0 };
        breakdown[key].totalAmount += Number(imp.calculatedAmount || 0);
      });
    });
    return { totalVal, totalTax, grandTotal: totalVal + totalTax, breakdown };
  })() : null;

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
    if (isMultiItem) {
      // Multi-item save
      if (!eParty || eItems.length === 0) { alert('Fill: ' + partyLabel + ' and at least one item'); return; }
      for (let i = 0; i < eItems.length; i++) {
        if (!eItems[i].productName || !eItems[i].qty || (!eItems[i].rate && !eItems[i].amount)) {
          alert('Item #' + (i+1) + ': Fill Product, Qty, and Rate or Amount'); return;
        }
      }
      setSaving(true);
      try {
        const saveItems = eItems.map(item => {
          const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
          const taxes = calcItemTaxes(item, hsRules);
          return {
            productName: item.productName, hscode: item.hscode || '',
            qty: Number(item.qty) || 0, rate: Number(item.rate) || 0, amount: rawVal,
            hsImpositions: taxes.hsImpositions, itemTaxTotal: taxes.itemTaxTotal,
            itemValue: rawVal, itemGrandTotal: rawVal + taxes.itemTaxTotal
          };
        });
        // Aggregate taxes
        const aggMap = {};
        saveItems.forEach(item => (item.hsImpositions || []).forEach(imp => {
          const key = imp.taxId || imp.taxName;
          if (!aggMap[key]) aggMap[key] = { ...imp, calculatedAmount: 0 };
          aggMap[key].calculatedAmount += Number(imp.calculatedAmount || 0);
        }));
        const allApplied = Object.values(aggMap);
        const totalVal = saveItems.reduce((s, i) => s + i.itemValue, 0);
        const totalTax = saveItems.reduce((s, i) => s + i.itemTaxTotal, 0);
        const bundle = {
          date: eDate, supplierName: eParty, items: saveItems,
          appliedTaxes: allApplied, taxAmountTotal: totalTax, itemValueTotal: totalVal, grandTotal: totalVal + totalTax,
          taxCreditTo: eCreditTo.name ? eCreditTo : null,
          gdNo: eRef, updatedAt: serverTimestamp()
        };
        bundle[refField] = eRef;
        await updateDoc(doc(db, collectionName, entry.id), bundle);
        // Update linked invoice
        const qInv = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(qInv);
        const linked = snap.docs.find(d => { const dd = d.data(); return dd.taxVoucherId === entry.id && dd.type === 'purchase_apt'; });
        if (linked) {
          await updateDoc(doc(db, 'invoices', linked.id), {
            date: eDate, refNo: eRef || 'TAX-' + Date.now(), partyName: eParty,
            items: saveItems, appliedTaxes: allApplied, taxAmountTotal: totalTax, itemValueTotal: totalVal, grandTotal: totalVal + totalTax,
            taxCreditTo: eCreditTo.name ? eCreditTo : null, taxableValue: totalVal, total: totalVal + totalTax, totalAmount: totalVal + totalTax, amount: totalVal + totalTax, updatedAt: serverTimestamp()
          });
        }
        if (onUpdated) onUpdated();
        setIsEditing(false);
        alert('✅ Updated successfully!');
      } catch (e) { console.error('EntryViewerModal save error:', e); alert('Save failed: ' + e.message); }
      setSaving(false);
      return;
    }

    // Original single-item save
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
      if (isPurchase && eCreditTo.name) updateData.taxCreditTo = eCreditTo;

      // If the entry had appliedTaxes from HS Code rules, recalculate them
      if (entry.appliedTaxes && entry.appliedTaxes.length > 0) {
        const recalculatedTaxes = [];
        const taxAmountMap = {};
        entry.appliedTaxes.forEach((imp) => {
          let taxAmtCalc;
          if (imp.baseOn === 'assessed_value') {
            taxAmtCalc = finalAmount * imp.percentage / 100;
          } else if (imp.baseOn === 'assessed_value_plus') {
            const refTaxIds = imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : []);
            let parentTotal = 0;
            refTaxIds.forEach(ptId => { parentTotal += (taxAmountMap[ptId] || 0); });
            taxAmtCalc = (finalAmount + parentTotal) * imp.percentage / 100;
          } else {
            taxAmtCalc = 0;
          }
          taxAmountMap[imp.taxId] = taxAmtCalc;
          recalculatedTaxes.push({ ...imp, calculatedAmount: taxAmtCalc });
        });
        const taxTotal = recalculatedTaxes.reduce((s, t) => s + t.calculatedAmount, 0);
        updateData.appliedTaxes = recalculatedTaxes;
        updateData.taxAmountTotal = taxTotal;
        updateData.grandTotal = finalAmount + taxTotal;
        updateData.total = finalAmount + taxTotal;
      }

      await updateDoc(doc(db, collectionName, entry.id), updateData);

      // Also update linked invoice
      const invoiceType = isPurchase ? 'purchase_apt' : (collectionName === 'tax_sales_registered' ? 'sales_reg_apt' : 'sales_unreg_apt');
      const qInv = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(qInv);
      const linked = snap.docs.find(d => { const dd = d.data(); return dd.taxVoucherId === entry.id && dd.type === invoiceType; });
      if (linked) {
        const invoiceUpdate = {
          date: eDate, refNo: eRef || `TAX-${Date.now()}`, partyName: eParty,
          items: [{ productName: eProduct, qty: q, rate: finalRate, amount: finalAmount }],
          taxableValue: finalAmount, taxId: eTaxId || null, taxName: tax?.name || null, taxRate: rPct, taxAmount: finalTotal - finalAmount,
          total: finalTotal, totalAmount: finalTotal, amount: finalTotal, updatedAt: serverTimestamp()
        };
        if (isPurchase && eCreditTo.name) invoiceUpdate.taxCreditTo = eCreditTo;
        if (updateData.appliedTaxes) {
          invoiceUpdate.appliedTaxes = updateData.appliedTaxes;
          invoiceUpdate.taxAmountTotal = updateData.taxAmountTotal;
          invoiceUpdate.grandTotal = updateData.grandTotal;
          invoiceUpdate.taxAmount = updateData.taxAmountTotal;
          invoiceUpdate.total = updateData.grandTotal;
          invoiceUpdate.totalAmount = updateData.grandTotal;
          invoiceUpdate.amount = updateData.grandTotal;
        }
        await updateDoc(doc(db, 'invoices', linked.id), invoiceUpdate);
      }
      if (onUpdated) onUpdated();
      setIsEditing(false);
      alert('✅ Updated successfully!');
    } catch (e) { console.error('EntryViewerModal save error:', e); alert('Save failed: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = () => {
    setShowPwdPrompt(true);
    setPwdInput('');
  };

  const confirmDelete = async () => {
    if (pwdInput.toLowerCase() !== 'abcd') {
      alert('❌ Incorrect Password. Access Denied.');
      setShowPwdPrompt(false);
      setPwdInput('');
      return;
    }
    setShowPwdPrompt(false);
    if (!window.confirm('⚠️ Are you sure?\n\nThis will permanently delete this voucher from ALL ledgers and inventory.')) return;

    try {
      const invoiceType = isPurchase ? 'purchase_apt' : (collectionName === 'tax_sales_registered' ? 'sales_reg_apt' : 'sales_unreg_apt');

      // 1. Delete from tax collection
      await deleteDoc(doc(db, collectionName, entry.id));

      // 2. Find and delete linked invoice
      const qInv = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(qInv);
      const linked = snap.docs.find(d => {
        const dd = d.data();
        return dd.taxVoucherId === entry.id && dd.type === invoiceType;
      });
      if (linked) {
        await deleteDoc(doc(db, 'invoices', linked.id));
      }

      if (onUpdated) onUpdated();
      onClose();
      alert('✅ Deleted successfully!');
    } catch (e) {
      console.error('EntryViewerModal delete error:', e);
      alert('Delete failed: ' + e.message);
    }
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
            {!isEditing && <button onClick={handleDelete} className="px-3 py-1.5 bg-red-500/80 text-white text-[10px] font-bold rounded-lg hover:bg-red-600">🗑️ Delete</button>}
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

              {isMultiItem ? (
                /* ═══ MULTI-ITEM VIEW ═══ */
                <div className="space-y-3">
                  <div className="text-[9px] font-bold text-slate-400 uppercase">Items ({eItems.length})</div>
                  {eItems.map((item, idx) => {
                    const rawVal = Number(item.amount||0) || (Number(item.qty||0) * Number(item.rate||0));
                    const imps = item.hsImpositions || [];
                    return (
                      <div key={idx} className="bg-slate-50 rounded-xl border border-slate-200 p-3">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-slate-500">Item #{idx + 1}</span>
                          <span className="text-[10px] font-mono text-slate-500">{item.hscode || '—'}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-800">{item.productName}</div>
                        <div className="grid grid-cols-3 gap-2 mt-1 text-[10px]">
                          <div>Qty: <span className="font-mono">{item.qty || 0}</span></div>
                          <div>Rate: <span className="font-mono">{formatNum(Number(item.rate||0))}</span></div>
                          <div>Value: <span className="font-mono font-bold">{formatNum(rawVal)}</span></div>
                        </div>
                        {imps.length > 0 && (
                          <div className="mt-2 bg-blue-50/50 rounded-lg p-2 space-y-0.5">
                            {imps.map((imp, i) => (
                              <div key={i} className="flex justify-between text-[10px]">
                                <span className="text-slate-600">{imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax'} ({imp.percentage}%)</span>
                                <span className="font-mono font-bold text-blue-700">{formatNum(imp.calculatedAmount)}</span>
                              </div>
                            ))}
                            <div className="flex justify-between text-[10px] border-t border-blue-100 pt-0.5 mt-0.5 font-bold">
                              <span className="text-slate-600">Item Total</span>
                              <span className="font-mono text-slate-700">{formatNum(rawVal + Number(item.itemTaxTotal||0))}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Summary */}
                  {eTotals && (
                    <div className="bg-slate-50 rounded-xl p-4 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-bold text-slate-500">📦 Total Items Value</span>
                        <span className="font-mono font-bold text-slate-700">{formatNum(eTotals.totalVal)}</span>
                      </div>
                      {Object.keys(eTotals.breakdown).length > 0 && (
                        <div className="border-t border-slate-200 pt-1 space-y-0.5">
                          <div className="text-[8px] font-bold text-slate-400 uppercase">🧾 Tax Breakup</div>
                          {Object.entries(eTotals.breakdown).map(([key, tb]) => (
                            <div key={key} className="flex justify-between text-[10px] pl-2">
                              <span className="text-slate-600">{tb.taxName} ({tb.percentage}%)</span>
                              <span className="font-mono font-bold text-blue-700">{formatNum(tb.totalAmount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between text-xs border-t border-slate-200 pt-1">
                        <span className="font-bold text-slate-500">🧾 Total Taxes</span>
                        <span className="font-mono font-bold text-blue-700">{formatNum(eTotals.totalTax)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t-2 border-slate-300 pt-1">
                        <span className="font-bold text-slate-700">💰 Grand Total</span>
                        <span className="font-mono font-black text-green-700">{formatNum(eTotals.grandTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ═══ SINGLE-ITEM VIEW (original) ═══ */
                <><div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product</label><div className="text-sm text-slate-800">{eProduct || '—'}</div></div>
              {entry.hscode && <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">HS Code</label><div className="text-sm font-mono text-slate-800">{entry.hscode}</div></div>}
              {isPurchase && eCreditTo.name && <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax Credit To</label><div className="text-sm font-medium text-green-700">✓ {eCreditTo.name}</div></div>}
              <div className="grid grid-cols-4 gap-4">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label><div className="text-sm font-mono text-slate-800">{eQty || 0}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label><div className="text-sm font-mono text-slate-800">{formatNum(Number(eRate))}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label><div className="text-sm font-mono font-medium text-slate-800">{formatNum(Number(eAmount))}</div></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax</label><div className="text-sm text-blue-700">{taxOpt?.name || 'No Tax'}</div></div>
              </div>

              {/* Applied taxes from HS Code rules */}
              {entry.appliedTaxes && entry.appliedTaxes.length > 0 && (
                <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-3 space-y-1.5">
                  <div className="text-[9px] font-bold text-blue-600 uppercase">📋 Applied Taxes & Duties</div>
                  {entry.appliedTaxes.map((imp, i) => (
                    <div key={i} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5 border border-blue-50">
                      <span className="text-xs text-slate-700">{imp.taxName || imp.taxId} <span className="text-[10px] text-slate-400">@ {imp.percentage}%</span></span>
                      <span className="text-sm font-black font-mono text-blue-700">{formatNum(imp.calculatedAmount || 0)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">📦 Items Value</div><div className="text-base font-black font-mono text-slate-700">{formatNum(rawAmt)}</div></div>
                <div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">🧾 Total Taxes</div>
                  <div className="text-base font-black font-mono text-blue-700">
                    {formatNum(entry.taxAmountTotal || (rawAmt * taxPct / 100) || 0)}
                  </div>
                  {(entry.appliedTaxes?.length || 0) > 0 && <div className="text-[8px] text-blue-400">{entry.appliedTaxes.length} tax(es)</div>}
                </div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">💰 Grand Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(entry.grandTotal || eTotal || 0)}</div></div>
              </div></>
              )}
              {entry.gstin && <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">GSTIN</label><div className="text-sm font-mono text-slate-800">{entry.gstin}</div></div>}
              <div className="text-[9px] text-slate-400 text-right">ID: {entry.id}</div>
            </div>
          ) : isMultiItem ? (
            /* ═══ MULTI-ITEM EDIT MODE ═══ */
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

              <div className="border-t border-slate-200 pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Items ({eItems.length})</span>
                  <button onClick={() => setEItems(prev => [...prev, { id: Date.now() + Math.random(), productName: '', hscode: '', qty: '', rate: '', amount: '', prodSearch: '', showProd: false, hsImpositions: [], itemTaxTotal: 0 }])}
                    className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-200">+ Add Item</button>
                </div>
                {eItems.map((item, idx) => {
                  const filteredProds = products.filter(p => item.prodSearch ? (p.name||'').toLowerCase().includes(item.prodSearch.toLowerCase()) : true);
                  return (
                    <div key={item.id || idx} className="bg-slate-50 rounded-xl border border-slate-200 p-3 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-slate-500">Item #{idx + 1}</span>
                        <button onClick={() => setEItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700 text-[10px] font-bold">✕ Remove</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                        <div className="relative">
                          <label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Product</label>
                          <input value={item.prodSearch || item.productName} onFocus={() => setEItems(prev => prev.map((it, i) => i === idx ? { ...it, showProd: true } : it))} onBlur={() => setTimeout(() => setEItems(prev => prev.map((it, i) => i === idx ? { ...it, showProd: false } : it)), 200)}
                            onChange={e => setEItems(prev => prev.map((it, i) => i === idx ? { ...it, prodSearch: e.target.value, productName: '' } : it))}
                            placeholder="Search product..." className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" />
                          {item.showProd && filteredProds.length > 0 && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                              {filteredProds.slice(0, 20).map(p => (
                                <div key={p.id} onMouseDown={() => {
                                  const updated = { ...item, productName: p.name, prodSearch: '', showProd: false, hscode: p.hscode || '' };
                                  const taxes = calcItemTaxes(updated, hsRules);
                                  updated.hsImpositions = taxes.hsImpositions; updated.itemTaxTotal = taxes.itemTaxTotal;
                                  setEItems(prev => prev.map((it, i) => i === idx ? updated : it));
                                }} className="px-2 py-1.5 text-[10px] hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-400">({p.group})</span>}</div>
                              ))}
                            </div>
                          )}
                          {item.productName && <div className="text-[8px] text-green-600 font-medium mt-0.5">✓ {item.productName}</div>}
                        </div>
                        <div>
                          <label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">HS Code</label>
                          <div className="text-xs font-mono font-bold text-slate-700 px-2 py-1.5 bg-white rounded border border-slate-200">{item.hscode || '—'}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Qty</label><input type="number" value={item.qty} onChange={e => {
                          const v = e.target.value;
                          setEItems(prev => prev.map((it, i) => {
                            if (i !== idx) return it;
                            const u = { ...it, qty: v };
                            const q = Number(v)||0; const r = Number(it.rate)||0;
                            if (q > 0 && r > 0) u.amount = String(q * r);
                            const taxes = calcItemTaxes(u, hsRules);
                            u.hsImpositions = taxes.hsImpositions; u.itemTaxTotal = taxes.itemTaxTotal;
                            return u;
                          }));
                        }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                        <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Rate</label><input type="number" value={item.rate} onChange={e => {
                          const v = e.target.value;
                          setEItems(prev => prev.map((it, i) => {
                            if (i !== idx) return it;
                            const u = { ...it, rate: v };
                            const r = Number(v)||0; const q = Number(it.qty)||0;
                            if (q > 0 && r > 0) u.amount = String(q * r);
                            const taxes = calcItemTaxes(u, hsRules);
                            u.hsImpositions = taxes.hsImpositions; u.itemTaxTotal = taxes.itemTaxTotal;
                            return u;
                          }));
                        }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                        <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-0.5">Assessed Value</label><input type="number" value={item.amount} onChange={e => {
                          const v = e.target.value;
                          setEItems(prev => prev.map((it, i) => {
                            if (i !== idx) return it;
                            const u = { ...it, amount: v };
                            const taxes = calcItemTaxes(u, hsRules);
                            u.hsImpositions = taxes.hsImpositions; u.itemTaxTotal = taxes.itemTaxTotal;
                            return u;
                          }));
                        }} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs outline-none text-slate-800" /></div>
                      </div>
                      {(item.hsImpositions || []).length > 0 && (
                        <div className="bg-blue-50/50 rounded-lg border border-blue-100 p-2 space-y-0.5">
                          <div className="text-[8px] font-bold text-blue-600 uppercase">Taxes for this item</div>
                          {item.hsImpositions.map((imp, i) => (
                            <div key={i} className="flex justify-between text-[10px]">
                              <span className="text-slate-600">{imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax'} ({imp.percentage}%)</span>
                              <span className="font-mono font-bold text-blue-700">{formatNum(imp.calculatedAmount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Multi-item totals in edit */}
              {eItems.length > 0 && (() => {
                let tv = 0, tt = 0; const bd = {};
                eItems.forEach(it => {
                  const v = Number(it.amount||0) || (Number(it.qty||0) * Number(it.rate||0));
                  tv += v; tt += Number(it.itemTaxTotal||0);
                  (it.hsImpositions||[]).forEach(imp => {
                    const k = imp.taxId || imp.taxName;
                    if (!bd[k]) bd[k] = { taxName: imp.taxName || taxRates.find(tx => tx.id === imp.taxId)?.name || 'Tax', percentage: imp.percentage, totalAmount: 0 };
                    bd[k].totalAmount += Number(imp.calculatedAmount||0);
                  });
                });
                return (
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                    <div className="flex justify-between text-xs"><span className="font-bold text-slate-500">📦 Items Value</span><span className="font-mono font-bold text-slate-700">{formatNum(tv)}</span></div>
                    {Object.keys(bd).length > 0 && <div className="border-t border-slate-200 pt-1 space-y-0.5">
                      <div className="text-[8px] font-bold text-slate-400 uppercase">🧾 Tax Breakup</div>
                      {Object.entries(bd).map(([k, tb]) => (
                        <div key={k} className="flex justify-between text-[10px] pl-2"><span className="text-slate-600">{tb.taxName} ({tb.percentage}%)</span><span className="font-mono font-bold text-blue-700">{formatNum(tb.totalAmount)}</span></div>
                      ))}
                    </div>}
                    <div className="flex justify-between text-xs border-t border-slate-200 pt-1"><span className="font-bold text-slate-500">🧾 Total Taxes</span><span className="font-mono font-bold text-blue-700">{formatNum(tt)}</span></div>
                    <div className="flex justify-between text-sm border-t-2 border-slate-300 pt-1"><span className="font-bold text-slate-700">💰 Grand Total</span><span className="font-mono font-black text-green-700">{formatNum(tv + tt)}</span></div>
                  </div>
                );
              })()}

              {isPurchase && (
                <div className="relative">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">🏦 Taxes credited to</label>
                  <input value={eCreditSearch} onFocus={() => setEShowCredit(true)} onBlur={() => setTimeout(() => setEShowCredit(false), 200)}
                    onChange={e => { setECreditSearch(e.target.value); setECreditTo({ id: '', name: '' }); }}
                    placeholder="Search party..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                  {eShowCredit && parties.filter(p => (p.name||'').toLowerCase().includes(eCreditSearch.toLowerCase())).slice(0, 20).map(p => (
                    <div key={p.id} onMouseDown={() => { setECreditTo({ id: p.id, name: p.name }); setECreditSearch(p.name); setEShowCredit(false); }}
                      className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800 bg-white">{p.name}</div>
                  ))}
                  {eCreditTo.name && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ Credit to: {eCreditTo.name}</div>}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg disabled:opacity-50">{saving ? '💾 Saving...' : '💾 Save Changes'}</button>
                <button onClick={() => { setIsEditing(false); }} className="px-6 py-3 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-300">Cancel</button>
              </div>
            </div>
          ) : (
            /* ═══ SINGLE-ITEM EDIT MODE (original) ═══ */
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
              {entry.hscode && <div className="text-[10px] text-slate-500 -mt-2 ml-1">HS Code: <span className="font-mono font-bold text-slate-700">{entry.hscode}</span></div>}
              {isPurchase && (
                <div className="relative">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax Credit To (Party)</label>
                  <input value={eCreditSearch} onFocus={() => setEShowCredit(true)} onBlur={() => setTimeout(() => setEShowCredit(false), 200)}
                    onChange={e => { setECreditSearch(e.target.value); setECreditTo({ id: '', name: '' }); }}
                    placeholder="Search party..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                  {eShowCredit && parties.filter(p => (p.name||'').toLowerCase().includes(eCreditSearch.toLowerCase())).slice(0, 20).map(p => (
                    <div key={p.id} onMouseDown={() => { setECreditTo({ id: p.id, name: p.name }); setECreditSearch(p.name); setEShowCredit(false); }}
                      className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800 bg-white">{p.name}</div>
                  ))}
                  {eCreditTo.name && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ Credit to: {eCreditTo.name}</div>}
                </div>
              )}
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
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(rawAmt)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax</div><div className="text-sm font-black font-mono text-blue-700">{formatNum(eTotal - rawAmt)}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-base font-black font-mono text-green-700">{formatNum(eTotal)}</div></div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg disabled:opacity-50">{saving ? '💾 Saving...' : '💾 Save Changes'}</button>
                <button onClick={() => setIsEditing(false)} className="px-6 py-3 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-300">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Password prompt overlay */}
      {showPwdPrompt && (
        <div className="fixed inset-0 z-[10010] bg-black/30 flex items-center justify-center" onClick={() => { setShowPwdPrompt(false); setPwdInput(''); }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 max-w-xs w-full mx-4 border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-3">
              <div className="text-lg mb-1">🔒</div>
              <div className="text-xs font-bold text-slate-700">Enter Admin Password</div>
              <div className="text-[9px] text-slate-400">Required to delete this voucher</div>
            </div>
            <input type="password" value={pwdInput} onChange={e => setPwdInput(e.target.value)}
              autoFocus placeholder="Enter password..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-center mb-3"
              onKeyDown={e => { if (e.key === 'Enter') confirmDelete(); if (e.key === 'Escape') { setShowPwdPrompt(false); setPwdInput(''); } }} />
            <div className="flex gap-2">
              <button onClick={confirmDelete} className="flex-1 py-2.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700">Confirm</button>
              <button onClick={() => { setShowPwdPrompt(false); setPwdInput(''); }} className="px-4 py-2.5 bg-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function RegisteredTab({ parties, products, taxRates, uid, entries, setEntries, keys }) {
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [hscode, setHscode] = useState('');
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
  const [hsRules, setHsRules] = useState([]);
  const [hsImpositions, setHsImpositions] = useState([]);
  const [taxesTotal, setTaxesTotal] = useState(0);
  const [taxCreditTo, setTaxCreditTo] = useState({ id: '', name: '' });
  const [creditSearch, setCreditSearch] = useState('');
  const [showCredit, setShowCredit] = useState(false);

  // Load HS Code rules on mount
  useEffect(() => {
    getDocs(query(collection(db, 'hs_code_rules'), orderBy('createdAt', 'desc'))).then(snap => {
      setHsRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  // Compute raw amount for HS Code tax calculation
  const rawAmtReg = (() => { const a = Number(amount||0); const q = Number(qty||0); const r = Number(rate||0); return a > 0 ? a : (q * r); })();

  // When hscode or amount changes, look up matching HS Code rule
  useEffect(() => {
    if (!hscode) { setHsImpositions([]); setTaxesTotal(0); return; }
    const rule = hsRules.find(r => r.hsCode === hscode && (r.category === 'Export' || r.category === 'Local Registered Sales' || r.category === 'Both'));
    if (!rule || !rule.impositions || rule.impositions.length === 0) {
      setHsImpositions([]); setTaxesTotal(0);
      return;
    }
    const imps = rule.impositions;
    const results = [];
    const taxAmountMap = {};
    imps.forEach((imp, idx) => {
      let taxAmt;
      if (imp.baseOn === 'assessed_value') {
        taxAmt = rawAmtReg * imp.percentage / 100;
      } else if (imp.baseOn === 'assessed_value_plus') {
        const refTaxIds = imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : []);
        let parentTotal = 0;
        refTaxIds.forEach(ptId => { parentTotal += (taxAmountMap[ptId] || 0); });
        taxAmt = (rawAmtReg + parentTotal) * imp.percentage / 100;
      } else { taxAmt = 0; }
      taxAmountMap[imp.taxId] = taxAmt;
      results.push({ ...imp, calculatedAmount: taxAmt, index: idx });
    });
    setHsImpositions(results);
    setTaxesTotal(results.reduce((sum, r) => sum + r.calculatedAmount, 0));
  }, [hscode, rawAmtReg, hsRules]);

  const regItemValue = rawAmtReg;
  const regGrandTotal = regItemValue + taxesTotal;

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
    const hasHsTaxes = hsImpositions.length > 0;
    const saveTaxes = hasHsTaxes ? hsImpositions : [];
    const saveTaxTotal = hasHsTaxes ? taxesTotal : (finalAmount * (tax ? Number(tax.rate)||0 : 0) / 100);
    const saveGrandTotal = hasHsTaxes ? regGrandTotal : (finalAmount + saveTaxTotal);

    // Save to ACCPRO TAX collection
    const taxDocRef = await addDoc(collection(db, 'tax_sales_registered'), {
      date, customer: selectedCustomer, productName: selectedProduct, hscode, gstin, refNo,
      qty: Number(qty), rate: finalRate, taxableValue: finalAmount,
      appliedTaxes: saveTaxes,
      taxAmountTotal: saveTaxTotal,
      grandTotal: saveGrandTotal,
      taxCreditTo: hasHsTaxes ? taxCreditTo : null,
      taxId: selectedTax||null, taxName: tax?.name||null, taxRate: hasHsTaxes ? 0 : Number(taxRate), total: saveGrandTotal,
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
        hscode,
        appliedTaxes: saveTaxes,
        taxAmountTotal: saveTaxTotal,
        grandTotal: saveGrandTotal,
        taxCreditTo: hasHsTaxes ? taxCreditTo : null,
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
        taxRate: hasHsTaxes ? 0 : Number(taxRate),
        taxAmount: saveTaxTotal,
        total: saveGrandTotal,
        totalAmount: saveGrandTotal,
        amount: saveGrandTotal,
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
    setSelectedCustomer(''); setSelectedProduct(''); setHscode(''); setGstin(''); setRefNo('');
    setCustSearch(''); setProdSearch(''); setQty(''); setRate(''); setAmount('');
    setSelectedTax(''); setTaxRate(0); setTotal(0);
    setHsImpositions([]); setTaxesTotal(0); setTaxCreditTo({ id: '', name: '' }); setCreditSearch('');
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
                  <div key={p.id} onMouseDown={() => { setSelectedProduct(p.name); setProdSearch(p.name); setHscode(p.hscode || ''); setShowProd(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-600">({p.group})</span>}</div>
                ))}
              </div>
            )}
            {selectedProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedProduct}</div>}
          </div>

          {hscode && <div className="text-[10px] text-slate-500 -mt-2 ml-1">HS Code: <span className="font-mono font-bold text-slate-700">{hscode}</span></div>}

          {/* HS Code cascading taxes */}
          {hsImpositions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              <div className="text-[9px] font-bold text-amber-700 uppercase mb-1">📋 Applied Taxes (HS Code Rule)</div>
              {hsImpositions.map((imp, i) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <span className="text-slate-700">{imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax'} <span className="text-slate-400">({imp.percentage}%)</span></span>
                  <span className="font-mono font-bold text-amber-700">{formatNum(imp.calculatedAmount)}</span>
                </div>
              ))}
            </div>
          )}

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

          {hsImpositions.length > 0 ? (
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">📦 Items Value</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(regItemValue)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">🧾 Total Taxes & Duties</div><div className="text-sm font-black font-mono text-blue-700">{formatNum(taxesTotal)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">💰 Grand Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(regGrandTotal)}</div></div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(Number(amount||0) || (Number(qty||0)*Number(rate||0)))}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax @ {taxRate}%</div><div className="text-sm font-black font-mono text-blue-700">{formatNum((Number(amount||0) || (Number(qty||0)*Number(rate||0))) * taxRate / 100)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(total)}</div></div>
            </div>
          )}

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Registered Sale</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 ? <div className="text-center py-8 text-xs text-slate-400">No entries.</div> : (
          <table className="w-full text-xs"><thead className="bg-slate-50"><tr>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Ref</th>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Customer</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Product</th>
            <th className="text-center px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">HS Code</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Qty</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
          </tr></thead><tbody>
            {entries.map(e => (
              <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.refNo}</td>
                <td className="px-3 py-2.5 font-medium text-slate-800">{e.customer}</td><td className="px-3 py-2.5 text-slate-800">{e.productName}</td>
                <td className="px-3 py-2.5 text-center font-mono text-[10px] text-slate-500">{e.hscode || '-'}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.qty}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{formatNum(e.taxableValue)}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.taxName ? <span className="text-blue-600">{e.taxName}</span> : '-'}</td>
                <td className="px-3 py-2.5 text-right font-bold text-slate-800">{formatNum(e.total)}</td>
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
  const [hscode, setHscode] = useState('');
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
  const [hsRules, setHsRules] = useState([]);
  const [hsImpositions, setHsImpositions] = useState([]);
  const [taxesTotal, setTaxesTotal] = useState(0);
  const [taxCreditTo, setTaxCreditTo] = useState({ id: '', name: '' });
  const [creditSearch, setCreditSearch] = useState('');
  const [showCredit, setShowCredit] = useState(false);

  // Load HS Code rules on mount
  useEffect(() => {
    getDocs(query(collection(db, 'hs_code_rules'), orderBy('createdAt', 'desc'))).then(snap => {
      setHsRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  // Compute raw amount for HS Code tax calculation
  const rawAmtUnreg = (() => { const a = Number(amount||0); const q = Number(qty||0); const r = Number(rate||0); return a > 0 ? a : (q * r); })();

  // When hscode or amount changes, look up matching HS Code rule
  useEffect(() => {
    if (!hscode) { setHsImpositions([]); setTaxesTotal(0); return; }
    const rule = hsRules.find(r => r.hsCode === hscode && (r.category === 'Local Unregistered Sales' || r.category === 'Both'));
    if (!rule || !rule.impositions || rule.impositions.length === 0) {
      setHsImpositions([]); setTaxesTotal(0);
      return;
    }
    const imps = rule.impositions;
    const results = [];
    const taxAmountMap = {};
    imps.forEach((imp, idx) => {
      let taxAmt;
      if (imp.baseOn === 'assessed_value') {
        taxAmt = rawAmtUnreg * imp.percentage / 100;
      } else if (imp.baseOn === 'assessed_value_plus') {
        const refTaxIds = imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : []);
        let parentTotal = 0;
        refTaxIds.forEach(ptId => { parentTotal += (taxAmountMap[ptId] || 0); });
        taxAmt = (rawAmtUnreg + parentTotal) * imp.percentage / 100;
      } else { taxAmt = 0; }
      taxAmountMap[imp.taxId] = taxAmt;
      results.push({ ...imp, calculatedAmount: taxAmt, index: idx });
    });
    setHsImpositions(results);
    setTaxesTotal(results.reduce((sum, r) => sum + r.calculatedAmount, 0));
  }, [hscode, rawAmtUnreg, hsRules]);

  const unregItemValue = rawAmtUnreg;
  const unregGrandTotal = unregItemValue + taxesTotal;

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
    const hasHsTaxes = hsImpositions.length > 0;
    const saveTaxes = hasHsTaxes ? hsImpositions : [];
    const saveTaxTotal = hasHsTaxes ? taxesTotal : (finalAmount * (tax ? Number(tax.rate)||0 : 0) / 100);
    const saveGrandTotal = hasHsTaxes ? unregGrandTotal : (finalAmount + saveTaxTotal);

    // Save to ACCPRO TAX collection
    const taxDocRef = await addDoc(collection(db, 'tax_sales_unregistered'), {
      date, customer: selectedCustomer, productName: selectedProduct, hscode, refNo,
      qty: Number(qty), rate: finalRate, taxableValue: finalAmount,
      appliedTaxes: saveTaxes,
      taxAmountTotal: saveTaxTotal,
      grandTotal: saveGrandTotal,
      taxCreditTo: hasHsTaxes ? taxCreditTo : null,
      taxId: selectedTax||null, taxName: tax?.name||null, taxRate: hasHsTaxes ? 0 : Number(taxRate), total: saveGrandTotal,
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
        hscode,
        appliedTaxes: saveTaxes,
        taxAmountTotal: saveTaxTotal,
        grandTotal: saveGrandTotal,
        taxCreditTo: hasHsTaxes ? taxCreditTo : null,
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
        taxRate: hasHsTaxes ? 0 : Number(taxRate),
        taxAmount: saveTaxTotal,
        total: saveGrandTotal,
        totalAmount: saveGrandTotal,
        amount: saveGrandTotal,
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
    setSelectedCustomer(''); setSelectedProduct(''); setHscode(''); setRefNo('');
    setCustSearch(''); setProdSearch(''); setQty(''); setRate(''); setAmount('');
    setSelectedTax(''); setTaxRate(0); setTotal(0);
    setHsImpositions([]); setTaxesTotal(0); setTaxCreditTo({ id: '', name: '' }); setCreditSearch('');
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
                  <div key={p.id} onMouseDown={() => { setSelectedProduct(p.name); setProdSearch(p.name); setHscode(p.hscode || ''); setShowProd(false); }}
                    className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name} {p.group && <span className="text-slate-600">({p.group})</span>}</div>
                ))}
              </div>
            )}
            {selectedProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {selectedProduct}</div>}
          </div>

          {hscode && <div className="text-[10px] text-slate-500 -mt-2 ml-1">HS Code: <span className="font-mono font-bold text-slate-700">{hscode}</span></div>}

          {/* HS Code cascading taxes */}
          {hsImpositions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              <div className="text-[9px] font-bold text-amber-700 uppercase mb-1">📋 Applied Taxes (HS Code Rule)</div>
              {hsImpositions.map((imp, i) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <span className="text-slate-700">{imp.taxName || taxRates.find(t => t.id === imp.taxId)?.name || 'Tax'} <span className="text-slate-400">({imp.percentage}%)</span></span>
                  <span className="font-mono font-bold text-amber-700">{formatNum(imp.calculatedAmount)}</span>
                </div>
              ))}
            </div>
          )}

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

          {hsImpositions.length > 0 ? (
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">📦 Items Value</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(unregItemValue)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">🧾 Total Taxes & Duties</div><div className="text-sm font-black font-mono text-blue-700">{formatNum(taxesTotal)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">💰 Grand Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(unregGrandTotal)}</div></div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(Number(amount||0) || (Number(qty||0)*Number(rate||0)))}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax @ {taxRate}%</div><div className="text-sm font-black font-mono text-blue-700">{formatNum((Number(amount||0) || (Number(qty||0)*Number(rate||0))) * taxRate / 100)}</div></div>
              <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-lg font-black font-mono text-green-700">{formatNum(total)}</div></div>
            </div>
          )}

          <button onClick={save} className="w-full py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg">Save Unregistered Sale</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {entries.length === 0 ? <div className="text-center py-8 text-xs text-slate-400">No entries.</div> : (
          <table className="w-full text-xs"><thead className="bg-slate-50"><tr>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Date</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Ref</th>
            <th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Customer</th><th className="text-left px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Product</th>
            <th className="text-center px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">HS Code</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Qty</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Value</th>
            <th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Tax</th><th className="text-right px-3 py-2.5 text-[9px] font-bold text-slate-400 uppercase">Total</th>
          </tr></thead><tbody>
            {entries.map(e => (
              <tr key={e.id} onClick={() => setViewingEntry(e)} className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-3 py-2.5 text-slate-800">{e.date}</td><td className="px-3 py-2.5 font-mono text-slate-800">{e.refNo}</td>
                <td className="px-3 py-2.5 font-medium text-slate-800">{e.customer}</td><td className="px-3 py-2.5 text-slate-800">{e.productName}</td>
                <td className="px-3 py-2.5 text-center font-mono text-[10px] text-slate-500">{e.hscode || '-'}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{formatNum(e.taxableValue)}</td>
                <td className="px-3 py-2.5 text-right text-slate-800">{e.taxName ? <span className="text-blue-600">{e.taxName}</span> : '-'}</td>
                <td className="px-3 py-2.5 text-right font-bold text-slate-800">{formatNum(e.total)}</td>
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


