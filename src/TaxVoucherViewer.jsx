import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, collection, addDoc, query, orderBy, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const formatNum = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function TaxVoucherViewer({ data, onClose, parties = [], products = [], taxRates = [] }) {
  const [voucher, setVoucher] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Determine collection and field names based on voucher type
  const typeInfo = (() => {
    const t = data?.type || 'purchase_apt';
    if (t === 'sales_reg_apt') return {
      collection: 'tax_sales_registered',
      label: 'REG APT',
      headerLabel: 'Registered Sale',
      partyField: 'customer',
      partyLabel: 'Customer',
      refField: 'refNo',
      refLabel: 'Ref No.',
    };
    if (t === 'sales_unreg_apt') return {
      collection: 'tax_sales_unregistered',
      label: 'UNREG APT',
      headerLabel: 'Unregistered Sale',
      partyField: 'customer',
      partyLabel: 'Customer',
      refField: 'refNo',
      refLabel: 'Ref No.',
    };
    return {
      collection: 'tax_purchase',
      label: 'APT PUR',
      headerLabel: 'Purchase / GD Import',
      partyField: 'supplierName',
      partyLabel: 'Supplier',
      refField: 'gdNo',
      refLabel: 'GD No.',
    };
  })();

  // Edit form state
  const [eRef, setERef] = useState('');
  const [eDate, setEDate] = useState('');
  const [eParty, setEParty] = useState('');
  const [eProduct, setEProduct] = useState('');
  const [eQty, setEQty] = useState('');
  const [eRate, setERate] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eTaxId, setETaxId] = useState('');
  const [eTotal, setETotal] = useState(0);

  // Search states for edit
  const [partySearch, setPartySearch] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [showParty, setShowParty] = useState(false);
  const [showProd, setShowProd] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const taxId = data.taxVoucherId || data.id;
        const snap = await getDoc(doc(db, typeInfo.collection, taxId));
        if (snap.exists()) {
          const v = { id: snap.id, ...snap.data() };
          setVoucher(v);
          // Pre-fill edit form (handle both supplierName and customer field names)
          setERef(v[typeInfo.refField] || v.refNo || '');
          setEDate(v.date || '');
          setEParty(v[typeInfo.partyField] || v.supplierName || v.customer || '');
          setEProduct(v.productName || '');
          setEQty(String(v.qty || ''));
          setERate(String(v.rate || ''));
          setEAmount(String(v.taxableValue || ''));
          setETaxId(v.taxId || '');
          setETotal(v.total || 0);
        } else {
          // Fallback: show invoice data directly
          setVoucher({ ...data, _fromInvoice: true });
        }
      } catch (e) {
        console.error('TaxVoucherViewer load error:', e);
        setVoucher({ ...data, _fromInvoice: true, _error: e.message });
      }
      setLoading(false);
    };
    load();
  }, [data, typeInfo.collection, typeInfo.refField, typeInfo.partyField]);

  // Recalculate total during edit
  useEffect(() => {
    const q = Number(eQty) || 0;
    const r = Number(eRate) || 0;
    const a = Number(eAmount) || 0;
    const val = a > 0 ? a : (q * r);
    const tax = taxRates.find(t => t.id === eTaxId);
    const rPct = tax ? Number(tax.rate) || 0 : 0;
    setETotal(val + (val * rPct / 100));
  }, [eQty, eRate, eAmount, eTaxId, taxRates]);

  const handleSave = async () => {
    if (!eParty || !eProduct || !eQty || (!eRate && !eAmount)) {
      alert('Fill required fields: ' + typeInfo.partyLabel + ', Product, Qty, Rate/Amount');
      return;
    }
    setSaving(true);
    try {
      const taxId = data.taxVoucherId || data.id;
      const q = Number(eQty) || 0;
      const r = Number(eRate) || 0;
      const a = Number(eAmount) || 0;
      const finalAmount = a > 0 ? a : (q * r);
      const finalRate = r > 0 ? r : (finalAmount / (q || 1));
      const tax = taxRates.find(t => t.id === eTaxId);
      const rPct = tax ? Number(tax.rate) || 0 : 0;
      const taxAmount = finalAmount * rPct / 100;
      const finalTotal = finalAmount + taxAmount;

      // Build update payload for the tax collection
      const taxUpdatePayload = {
        date: eDate,
        productName: eProduct,
        qty: q,
        rate: finalRate,
        taxableValue: finalAmount,
        taxId: eTaxId || null,
        taxName: tax?.name || null,
        taxRate: rPct,
        total: finalTotal,
        updatedAt: serverTimestamp()
      };
      taxUpdatePayload[typeInfo.refField] = eRef;
      taxUpdatePayload[typeInfo.partyField] = eParty;

      // Update the tax collection document
      await updateDoc(doc(db, typeInfo.collection, taxId), taxUpdatePayload);

      // Also update the linked invoice in invoices collection
      if (data.id && data.id.length > 4) {
        const invoiceRef = doc(db, 'invoices', data.id);
        const invoiceSnap = await getDoc(invoiceRef);
        if (invoiceSnap.exists()) {
          await updateDoc(invoiceRef, {
            date: eDate,
            refNo: eRef || `TAX-${Date.now()}`,
            partyName: eParty,
            items: [{
              productName: eProduct,
              qty: q,
              rate: finalRate,
              amount: finalAmount
            }],
            taxableValue: finalAmount,
            taxId: eTaxId || null,
            taxName: tax?.name || null,
            taxRate: rPct,
            taxAmount,
            total: finalTotal,
            totalAmount: finalTotal,
            amount: finalTotal,
            updatedAt: serverTimestamp()
          });
        }
      }

      // Update local state
      const updated = {
        ...voucher,
        [typeInfo.refField]: eRef,
        date: eDate,
        [typeInfo.partyField]: eParty,
        productName: eProduct,
        qty: q,
        rate: finalRate,
        taxableValue: finalAmount,
        taxId: eTaxId || null,
        taxName: tax?.name || null,
        taxRate: rPct,
        total: finalTotal,
      };
      setVoucher(updated);
      setEditing(false);
      alert('✅ Voucher updated successfully!');
    } catch (e) {
      console.error('TaxVoucherViewer save error:', e);
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  const filteredParties = parties.filter(s =>
    partySearch ? (s.name || '').toLowerCase().includes(partySearch.toLowerCase()) : true
  );
  const filteredProducts = products.filter(p =>
    prodSearch ? (p.name || '').toLowerCase().includes(prodSearch.toLowerCase()) : true
  );

  if (loading) {
    return (
      <div className="fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <div className="animate-spin w-8 h-8 border-4 border-[#1e3264] border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-xs text-slate-500">Loading voucher...</p>
        </div>
      </div>
    );
  }

  if (!voucher) {
    return (
      <div className="fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4">
          <div className="text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h3 className="text-sm font-bold text-slate-700 mb-1">Not Found</h3>
            <p className="text-xs text-slate-500 mb-4">Tax voucher not found in database.</p>
            <button onClick={onClose}
              className="px-6 py-2 bg-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-300">Close</button>
          </div>
        </div>
      </div>
    );
  }

  const isEditing = editing;

  return (
    <div className="fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-auto overflow-hidden">
        <style>{".ev-input input,.ev-input select,.ev-input textarea{color:#1e293b!important;background:#fff!important}.ev-input select option{color:#1e293b!important}"}</style>

        {/* Header */}
        <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-[10px] font-black">TX</div>
            <span className="text-sm font-bold">{typeInfo.label} Voucher — {voucher[typeInfo.refField] || voucher.refNo || data.refNo || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button onClick={() => setEditing(true)}
                className="px-3 py-1.5 bg-white/15 text-white text-[10px] font-bold rounded-lg hover:bg-white/25">
                ✏️ Edit
              </button>
            )}
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="p-5 ev-input">
          {!isEditing ? (
            /* ── VIEW MODE ── */
            <div className="space-y-4">
              {/* Key fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{typeInfo.refLabel}</label>
                  <div className="text-sm font-mono font-bold text-slate-800">{voucher[typeInfo.refField] || voucher.refNo || '—'}</div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label>
                  <div className="text-sm text-slate-800">{voucher.date || '—'}</div>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{typeInfo.partyLabel}</label>
                <div className="text-sm font-medium text-slate-800">{voucher[typeInfo.partyField] || voucher.supplierName || voucher.customer || '—'}</div>
              </div>

              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product</label>
                <div className="text-sm text-slate-800">{voucher.productName || '—'}</div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label>
                  <div className="text-sm font-mono text-slate-800">{voucher.qty || 0}</div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label>
                  <div className="text-sm font-mono text-slate-800">{formatNum(voucher.rate)}</div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label>
                  <div className="text-sm font-mono font-medium text-slate-800">{formatNum(voucher.taxableValue)}</div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax</label>
                  <div className="text-sm text-blue-700">{voucher.taxName || 'No Tax'}{voucher.taxRate ? ' (' + String(voucher.taxRate) + '%)' : ''}</div>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">Taxable Value</div>
                  <div className="text-base font-black font-mono text-slate-700">{formatNum(voucher.taxableValue)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">Tax Amount</div>
                  <div className="text-base font-black font-mono text-blue-700">{formatNum((voucher.taxableValue||0) * (voucher.taxRate||0) / 100)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">Grand Total</div>
                  <div className="text-lg font-black font-mono text-green-700">{formatNum(voucher.total)}</div>
                </div>
              </div>

              {/* Narration */}
              {voucher.narration && (
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Narration</label>
                  <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3">{voucher.narration}</div>
                </div>
              )}

              <div className="text-[9px] text-slate-400 text-right">
                ID: {voucher.id || data.id} {voucher._fromInvoice ? '(from invoice)' : ''}
              </div>
            </div>
          ) : (
            /* ── EDIT MODE ── */
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{typeInfo.refLabel}</label>
                  <input value={eRef} onChange={e => setERef(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Date</label>
                  <input type="date" value={eDate} onChange={e => setEDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                </div>
              </div>

              {/* Party (Supplier/Customer) */}
              <div className="relative">
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">{typeInfo.partyLabel}</label>
                <input value={partySearch || eParty}
                  onFocus={() => setShowParty(true)}
                  onBlur={() => setTimeout(() => setShowParty(false), 200)}
                  onChange={e => { setPartySearch(e.target.value); setEParty(''); }}
                  placeholder={"Search " + typeInfo.partyLabel.toLowerCase() + "..."} 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                {showParty && filteredParties.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
                    {filteredParties.slice(0, 30).map(s => (
                      <div key={s.id} onMouseDown={() => { setEParty(s.name); setPartySearch(''); setShowParty(false); }}
                        className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{s.name}</div>
                    ))}
                  </div>
                )}
                {eParty && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {eParty}</div>}
              </div>

              {/* Product */}
              <div className="relative">
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Item / Product</label>
                <input value={prodSearch || eProduct}
                  onFocus={() => setShowProd(true)}
                  onBlur={() => setTimeout(() => setShowProd(false), 200)}
                  onChange={e => { setProdSearch(e.target.value); setEProduct(''); }}
                  placeholder="Search product..." 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                {showProd && filteredProducts.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
                    {filteredProducts.slice(0, 30).map(p => (
                      <div key={p.id} onMouseDown={() => { setEProduct(p.name); setProdSearch(''); setShowProd(false); }}
                        className="px-3 py-2 text-xs hover:bg-blue-50 border-b border-slate-50 cursor-pointer text-slate-800">{p.name}</div>
                    ))}
                  </div>
                )}
                {eProduct && <div className="mt-1 text-[9px] text-green-600 font-medium">✓ {eProduct}</div>}
              </div>

              {/* Qty, Rate, Amount */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Qty</label>
                  <input type="number" value={eQty} onChange={e => {
                    setEQty(e.target.value);
                    const q = Number(e.target.value) || 0;
                    const r = Number(eRate) || 0;
                    const a = Number(eAmount) || 0;
                    if (r > 0) setEAmount(String(q * r));
                    else if (a > 0) setERate(String(a / (q || 1)));
                  }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Rate</label>
                  <input type="number" value={eRate} onChange={e => {
                    setERate(e.target.value);
                    const q = Number(eQty) || 0;
                    const r = Number(e.target.value) || 0;
                    if (q > 0) setEAmount(String(q * r));
                  }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Amount</label>
                  <input type="number" value={eAmount} onChange={e => {
                    setEAmount(e.target.value);
                    const q = Number(eQty) || 0;
                    const a = Number(e.target.value) || 0;
                    if (q > 0) setERate(String(a / q));
                  }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none text-slate-800" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tax</label>
                  <select value={eTaxId} onChange={e => setETaxId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white text-slate-800">
                    <option value="">No Tax</option>
                    {taxRates.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>)}
                  </select>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-3 gap-3 text-center">
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Amount</div><div className="text-sm font-black font-mono text-slate-700">{formatNum(Number(eAmount||0) || (Number(eQty||0)*Number(eRate||0)))}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Tax</div><div className="text-sm font-black font-mono text-blue-700">{formatNum(eTotal - (Number(eAmount||0) || (Number(eQty||0)*Number(eRate||0))))}</div></div>
                <div><div className="text-[9px] font-bold text-slate-400 uppercase">Total</div><div className="text-base font-black font-mono text-green-700">{formatNum(eTotal)}</div></div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-3 bg-[#1e3264] text-white text-sm font-bold rounded-xl hover:bg-[#2b5797] shadow-lg disabled:opacity-50">
                  {saving ? '💾 Saving...' : '💾 Save Changes'}
                </button>
                <button onClick={() => setEditing(false)}
                  className="px-6 py-3 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
