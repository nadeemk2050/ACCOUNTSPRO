import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

const formatNum = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function HscodeRules({ onClose, products = [], taxRates = [], uid = '' }) {
  const [activeTab, setActiveTab] = useState('add');
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState(null); // rule being edited

  // Load rules on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'hs_code_rules'), orderBy('createdAt', 'desc')));
        setRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error('HscodeRules load error:', e); }
      setLoading(false);
    };
    load();
  }, []);

  // Group products by hscode
  const productsByHscode = useMemo(() => {
    const map = {};
    products.forEach(p => {
      if (p.hscode) {
        if (!map[p.hscode]) map[p.hscode] = [];
        map[p.hscode].push(p);
      }
    });
    return map;
  }, [products]);

  // Unique HS Codes from all products
  const availableHscodes = useMemo(() => {
    const codes = new Set();
    products.forEach(p => { if (p.hscode) codes.add(p.hscode); });
    return [...codes].sort();
  }, [products]);

  const hscodeKeys = Object.keys(productsByHscode).sort();

  return (
    <div className="fixed inset-0 z-[10002] bg-white flex flex-col">
      <style>{`.hsc input,.hsc select,.hsc textarea{color:#1e293b!important;background:#fff!important}.hsc select option{color:#1e293b!important}`}</style>

      {/* Header */}
      <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-xs font-black">HS</div>
          <span className="text-sm font-bold">HS Code Rules &amp; Directory</span>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Sub Tabs */}
      <div className="flex gap-1 px-5 py-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        {[
          { id: 'add', label: '➕ Add Rule' },
          { id: 'list', label: '📋 Rules List' },
          { id: 'items', label: '📦 Items under HSCodes' }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === tab.id ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5 hsc">
        {editingRule ? (
          <EditRuleForm rule={editingRule} taxRates={taxRates} rules={rules}
            onSaved={(updated) => {
              setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
              setEditingRule(null);
            }}
            onCancel={() => setEditingRule(null)} />
        ) : activeTab === 'add' ? (
          <AddRuleTab rules={rules} setRules={setRules} uid={uid} availableHscodes={availableHscodes} taxRates={taxRates} />
        ) : activeTab === 'list' ? (
          <RuleListTab rules={rules} setRules={setRules} uid={uid} loading={loading} taxRates={taxRates}
            onEdit={(rule) => setEditingRule(rule)} />
        ) : (
          <ItemsTab productsByHscode={productsByHscode} hscodeKeys={hscodeKeys} products={products} />
        )}
      </div>
    </div>
  );
}

// ─── Tab 1: Add Rule ───────────────────────────────────────────────────────────
function AddRuleTab({ rules, setRules, uid, availableHscodes = [], taxRates = [] }) {
  const [useCustom, setUseCustom] = useState(false);
  const [hsCode, setHsCode] = useState('');
  const [customHsCode, setCustomHsCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [impositions, setImpositions] = useState([]); // [{ taxId, percentage, baseOn, plusTaxIds: [] }]
  const [saving, setSaving] = useState(false);

  const addImposition = () => {
    setImpositions(prev => [...prev, { taxId: '', percentage: '', baseOn: 'assessed_value', plusTaxIds: [] }]);
  };

  const updateImposition = (index, field, value) => {
    setImpositions(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeImposition = (index) => {
    setImpositions(prev => prev.filter((_, i) => i !== index));
  };

  // Add a new slot in the plusTaxIds chain for an imposition
  const addPlusTaxId = (impIndex) => {
    setImpositions(prev => {
      const next = [...prev];
      next[impIndex] = { ...next[impIndex], plusTaxIds: [...(next[impIndex].plusTaxIds || []), ''] };
      return next;
    });
  };

  const updatePlusTaxId = (impIndex, slotIndex, value) => {
    setImpositions(prev => {
      const next = [...prev];
      const ids = [...(next[impIndex].plusTaxIds || [])];
      ids[slotIndex] = value;
      next[impIndex] = { ...next[impIndex], plusTaxIds: ids };
      return next;
    });
  };

  const removePlusTaxId = (impIndex, slotIndex) => {
    setImpositions(prev => {
      const next = [...prev];
      const ids = (next[impIndex].plusTaxIds || []).filter((_, i) => i !== slotIndex);
      next[impIndex] = { ...next[impIndex], plusTaxIds: ids };
      return next;
    });
  };

  // Get taxes not already used in impositions for this rule
  const getAvailableTaxes = (currentIndex) => {
    const usedIds = new Set();
    impositions.forEach((imp, i) => {
      if (i !== currentIndex && imp.taxId) usedIds.add(imp.taxId);
    });
    return taxRates.filter(t => !usedIds.has(t.id));
  };

  const save = async () => {
    const code = useCustom ? customHsCode : hsCode;
    if (!code) { alert('Select or enter HS Code'); return; }
    if (impositions.length === 0) { alert('Add at least one tax imposition'); return; }
    // Check duplicate
    if (rules.some(r => r.hsCode === code && r.category === category)) {
      alert('❌ A rule for HS Code "' + code + '" with category "' + category + '" already exists!\n\nPlease edit the existing rule instead.\nEach HS Code can have one rule per transaction type.');
      return;
    }
    // Validate each imposition
    for (let i = 0; i < impositions.length; i++) {
      if (!impositions[i].taxId) { alert('Tax #' + (i+1) + ': Select a tax'); return; }
      if (!impositions[i].percentage) { alert('Tax #' + (i+1) + ': Enter percentage'); return; }
    }
    setSaving(true);
    try {
      const ruleData = {
        hsCode: code, description, category, notes,
        impositions: impositions.map(imp => ({
          taxId: imp.taxId,
          taxName: taxRates.find(t => t.id === imp.taxId)?.name || '',
          percentage: Number(imp.percentage),
          baseOn: imp.baseOn,
          plusTaxIds: imp.baseOn === 'assessed_value_plus' ? (imp.plusTaxIds || []).filter(id => id) : [],
          plusTaxId: imp.baseOn === 'assessed_value_plus' && (imp.plusTaxIds || []).filter(id => id)[0] || null, // backward compat
        })),
        userId: uid, createdAt: serverTimestamp()
      };
      const ref = await addDoc(collection(db, 'hs_code_rules'), ruleData);
      setRules(prev => [{ id: ref.id, ...ruleData }, ...prev]);
      setHsCode(''); setCustomHsCode(''); setUseCustom(false);
      setDescription(''); setCategory(''); setNotes(''); setImpositions([]);
      alert('✅ Rule saved!');
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const CATEGORIES = ['Import', 'Export', 'Both', 'Local Registered Sales', 'Local Unregistered Sales', 'Local Purchase'];

  return (
    <div className="max-w-3xl mx-auto">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Add HS Code Tax Rule</h3>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">

        {/* HS Code */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">HS Code <span className="text-red-400">*</span></label>
            {!useCustom ? (
              <div>
                <select value={hsCode} onChange={e => {
                  if (e.target.value === '__custom__') { setUseCustom(true); setHsCode(''); }
                  else setHsCode(e.target.value);
                }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-500 bg-white">
                  <option value="">— Select HS Code —</option>
                  {availableHscodes.map(code => (<option key={code} value={code}>{code}</option>))}
                  <option disabled>───────</option>
                  <option value="__custom__">✏️ Type custom HS Code...</option>
                </select>
                {hsCode && <div className="mt-1 text-[10px] text-emerald-600">Selected: {hsCode}</div>}
              </div>
            ) : (
              <div>
                <input value={customHsCode} onChange={e => setCustomHsCode(e.target.value)} placeholder="e.g. 8471.30" autoFocus className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-500" />
                <button onClick={() => { setUseCustom(false); setCustomHsCode(''); }} className="mt-1 text-[10px] text-slate-400 hover:text-slate-600">← Back to list</button>
              </div>
            )}
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
              <option value="">Select...</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Item description..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-500" />
        </div>

        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-500" />
        </div>

        {/* ═══════════ TAX IMPOSITIONS ═══════════ */}
        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-[9px] font-bold text-slate-400 uppercase">Tax Impositions under this HS Code</label>
            <button onClick={addImposition} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-200">
              + Add Tax
            </button>
          </div>

          {impositions.length === 0 && (
            <div className="text-center py-6 text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              No taxes added yet. Click <b>"+ Add Tax"</b> to define which taxes apply to this HS Code.
            </div>
          )}

          {impositions.map((imp, i) => {
            const availTaxes = getAvailableTaxes(i);
            const selTax = taxRates.find(t => t.id === imp.taxId);
            return (
              <div key={i} className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500">Tax #{i + 1}</span>
                  <button onClick={() => removeImposition(i)} className="text-red-500 hover:text-red-700 text-xs font-bold">✕ Remove</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Select Tax</label>
                    <select value={imp.taxId} onChange={e => updateImposition(i, 'taxId', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                      <option value="">— Select Tax Name —</option>
                      {availTaxes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>)}
                    </select>
                    {selTax && <div className="mt-1 text-[10px] text-slate-500">Selected: {selTax.name}</div>}
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Percentage (%)</label>
                    <input type="number" value={imp.percentage} onChange={e => updateImposition(i, 'percentage', e.target.value)}
                      placeholder="e.g. 17" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-emerald-500" />
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">This tax will be imposed on</label>
                  <div className="space-y-2 pl-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={'base_' + i} checked={imp.baseOn === 'assessed_value'}
                        onChange={() => updateImposition(i, 'baseOn', 'assessed_value')} className="accent-emerald-600" />
                      <span className="text-xs text-slate-700">Directly on Assessed Value</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={'base_' + i} checked={imp.baseOn === 'assessed_value_plus'}
                        onChange={() => updateImposition(i, 'baseOn', 'assessed_value_plus')} className="accent-emerald-600" />
                      <span className="text-xs text-slate-700">Assessed Value + (another tax amount)</span>
                    </label>
                  </div>
                </div>

                {imp.baseOn === 'assessed_value_plus' && (
                  <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">🧮 Add these tax(es) to Assessed Value before applying this tax:</label>
                    {(imp.plusTaxIds || []).length === 0 && (
                      <div className="text-[10px] text-slate-400 italic">No taxes added yet. Click "+ Add Tax" to chain a tax into the base value.</div>
                    )}
                    {(imp.plusTaxIds || []).map((ptId, slot) => (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-5">{slot + 1}.</span>
                        <select value={ptId} onChange={e => updatePlusTaxId(i, slot, e.target.value)}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                          <option value="">— Select Tax —</option>
                          {taxRates.filter(t => t.id !== imp.taxId).map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>
                          ))}
                        </select>
                        <button onClick={() => removePlusTaxId(i, slot)}
                          className="text-red-500 hover:text-red-700 text-xs px-1">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addPlusTaxId(i)}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                      <span className="text-sm leading-none">+</span> Add another tax to base
                    </button>
                    {(imp.plusTaxIds || []).filter(id => id).length > 0 && (
                      <div className="text-[10px] text-slate-600 bg-slate-50 rounded-lg p-2 font-mono border border-slate-100 mt-1">
                        Formula: Assessed Value {(imp.plusTaxIds || []).filter(id => id).map(id => {
                          const t = taxRates.find(tx => tx.id === id);
                          return <span key={id}> + <b>{t?.name || id}</b></span>;
                        })} → then apply <b>{imp.percentage || '?'}%</b>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 shadow-lg disabled:opacity-50">
          {saving ? '💾 Saving...' : '💾 Save HS Code Rule'}
        </button>
      </div>
    </div>
  );
}

// ─── Edit Rule Form (for editing existing HS Code rules) ─────────────────────
function EditRuleForm({ rule, taxRates, rules, onSaved, onCancel }) {
  const [hsCode, setHsCode] = useState(rule.hsCode || '');
  const [description, setDescription] = useState(rule.description || '');
  const [category, setCategory] = useState(rule.category || '');
  const [notes, setNotes] = useState(rule.notes || '');
  const [impositions, setImpositions] = useState((rule.impositions || []).map(imp => ({
    taxId: imp.taxId || '', percentage: imp.percentage || '',
    baseOn: imp.baseOn || 'assessed_value',
    plusTaxIds: imp.plusTaxIds || (imp.plusTaxId ? [imp.plusTaxId] : [])
  })));
  const [saving, setSaving] = useState(false);

  const addImposition = () => setImpositions(prev => [...prev, { taxId: '', percentage: '', baseOn: 'assessed_value', plusTaxIds: [] }]);
  const updateImposition = (index, field, value) => setImpositions(prev => { const n = [...prev]; n[index] = { ...n[index], [field]: value }; return n; });
  const removeImposition = (index) => setImpositions(prev => prev.filter((_, i) => i !== index));
  const addPlusTaxId = (idx) => setImpositions(prev => { const n = [...prev]; n[idx] = { ...n[idx], plusTaxIds: [...(n[idx].plusTaxIds || []), ''] }; return n; });
  const updatePlusTaxId = (idx, slot, val) => setImpositions(prev => { const n = [...prev]; const ids = [...(n[idx].plusTaxIds || [])]; ids[slot] = val; n[idx] = { ...n[idx], plusTaxIds: ids }; return n; });
  const removePlusTaxId = (idx, slot) => setImpositions(prev => { const n = [...prev]; n[idx] = { ...n[idx], plusTaxIds: (n[idx].plusTaxIds || []).filter((_, i) => i !== slot) }; return n; });

  const getAvailableTaxes = (currentIndex) => {
    const usedIds = new Set();
    impositions.forEach((imp, i) => { if (i !== currentIndex && imp.taxId) usedIds.add(imp.taxId); });
    return taxRates.filter(t => !usedIds.has(t.id));
  };

  const save = async () => {
    if (!hsCode) { alert('HS Code is required'); return; }
    if (impositions.length === 0) { alert('Add at least one tax imposition'); return; }
    for (let i = 0; i < impositions.length; i++) {
      if (!impositions[i].taxId) { alert('Tax #' + (i+1) + ': Select a tax'); return; }
      if (!impositions[i].percentage) { alert('Tax #' + (i+1) + ': Enter percentage'); return; }
    }
    setSaving(true);
    try {
      const ruleData = {
        hsCode, description, category, notes,
        impositions: impositions.map(imp => ({
          taxId: imp.taxId,
          taxName: taxRates.find(t => t.id === imp.taxId)?.name || '',
          percentage: Number(imp.percentage),
          baseOn: imp.baseOn,
          plusTaxIds: imp.baseOn === 'assessed_value_plus' ? (imp.plusTaxIds || []).filter(id => id) : [],
          plusTaxId: imp.baseOn === 'assessed_value_plus' && (imp.plusTaxIds || []).filter(id => id)[0] || null,
        })),
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'hs_code_rules', rule.id), ruleData);
      onSaved({ id: rule.id, ...ruleData, userId: rule.userId, createdAt: rule.createdAt });
      alert('✅ Rule updated!');
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const CATEGORIES = ['Import', 'Export', 'Both', 'Local Registered Sales', 'Local Unregistered Sales', 'Local Purchase'];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">✏️ Edit Rule — {hsCode}</h3>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600">← Back to list</button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">HS Code</label>
            <div className="text-sm font-mono font-bold text-slate-800 bg-slate-50 rounded-lg px-3 py-2">{hsCode}</div>
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
              <option value="">Select...</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none" />
        </div>
        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none" />
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-[9px] font-bold text-slate-400 uppercase">Tax Impositions</label>
            <button onClick={addImposition} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-200">+ Add Tax</button>
          </div>
          {impositions.length === 0 && <div className="text-center py-6 text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">No taxes added yet.</div>}
          {impositions.map((imp, i) => {
            const availTaxes = getAvailableTaxes(i);
            const selTax = taxRates.find(t => t.id === imp.taxId);
            return (
              <div key={i} className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500">Tax #{i + 1}</span>
                  <button onClick={() => removeImposition(i)} className="text-red-500 hover:text-red-700 text-xs font-bold">✕ Remove</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Select Tax</label>
                    <select value={imp.taxId} onChange={e => updateImposition(i, 'taxId', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                      <option value="">— Select Tax Name —</option>
                      {availTaxes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Percentage (%)</label>
                    <input type="number" value={imp.percentage} onChange={e => updateImposition(i, 'percentage', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Imposed on</label>
                  <div className="space-y-2 pl-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={'ebase_' + i} checked={imp.baseOn === 'assessed_value'} onChange={() => updateImposition(i, 'baseOn', 'assessed_value')} className="accent-emerald-600" />
                      <span className="text-xs text-slate-700">Directly on Assessed Value</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name={'ebase_' + i} checked={imp.baseOn === 'assessed_value_plus'} onChange={() => updateImposition(i, 'baseOn', 'assessed_value_plus')} className="accent-emerald-600" />
                      <span className="text-xs text-slate-700">Assessed Value + (another tax)</span>
                    </label>
                  </div>
                </div>
                {imp.baseOn === 'assessed_value_plus' && (
                  <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">🧮 Add these tax(es) to base:</label>
                    {(imp.plusTaxIds || []).length === 0 && <div className="text-[10px] text-slate-400 italic">No taxes yet.</div>}
                    {(imp.plusTaxIds || []).map((ptId, slot) => (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-5">{slot + 1}.</span>
                        <select value={ptId} onChange={e => updatePlusTaxId(i, slot, e.target.value)} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                          <option value="">— Select Tax —</option>
                          {taxRates.filter(t => t.id !== imp.taxId).map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>
                          ))}
                        </select>
                        <button onClick={() => removePlusTaxId(i, slot)} className="text-red-500 hover:text-red-700 text-xs px-1">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addPlusTaxId(i)} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                      <span className="text-sm leading-none">+</span> Add another tax
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="flex-1 py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 shadow-lg disabled:opacity-50">
            {saving ? '💾 Saving...' : '💾 Update Rule'}
          </button>
          <button onClick={onCancel} className="px-6 py-3 bg-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-300">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 2: Rules List ─────────────────────────────────────────────────────────
function RuleListTab({ rules, setRules, uid, loading, taxRates = [], onEdit }) {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() =>
    search ? rules.filter(r =>
      (r.hsCode||'').toLowerCase().includes(search.toLowerCase()) ||
      (r.description||'').toLowerCase().includes(search.toLowerCase())
    ) : rules,
    [rules, search]
  );

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    setDeleting(id);
    try {
      await deleteDoc(doc(db, 'hs_code_rules', id));
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (e) { alert('Delete failed: ' + e.message); }
    setDeleting(null);
  };

  if (loading) return <div className="text-center py-12 text-xs text-slate-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">HS Code Rules ({rules.length})</h3>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search HS Code..."
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none w-64" />
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-xs text-slate-400">No rules found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const isExpanded = expandedId === r.id;
            return (
              <div key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                    <span className="font-mono font-bold text-sm text-slate-800">{r.hsCode}</span>
                    <span className="text-[10px] text-slate-400">{(r.impositions||[]).length} tax(es)</span>
                    {r.category && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700">{r.category}</span>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} disabled={deleting === r.id}
                    className="px-2 py-1 bg-red-100 text-red-600 text-[10px] font-bold rounded hover:bg-red-200">
                    {deleting === r.id ? '...' : '🗑️'}
                  </button>
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
                        {r.notes && <div className="text-[10px] text-slate-400">Notes: {r.notes}</div>}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onEdit(r); }}
                        className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg hover:bg-emerald-200">
                        ✏️ Edit
                      </button>
                    </div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase">Tax Impositions:</div>
                    {(r.impositions||[]).length === 0 && <div className="text-xs text-slate-400">No tax impositions defined.</div>}
                    {(r.impositions||[]).map((imp, j) => {
                      const formula = imp.baseOn === 'assessed_value'
                        ? `Assessed Value × ${imp.percentage}%`
                        : `(Assessed Value + ${imp.plusTaxName || imp.plusTaxId || '?'}) × ${imp.percentage}%`;
                      return (
                        <div key={j} className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <span className="font-bold text-xs text-slate-700">{imp.taxName || imp.taxId}</span>
                            <span className="ml-2 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">{imp.percentage}%</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">{formula}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Items under HSCodes ──────────────────────────────────────────────
function ItemsTab({ productsByHscode, hscodeKeys, products }) {
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');

  const filteredKeys = useMemo(() =>
    search ? hscodeKeys.filter(k => k.toLowerCase().includes(search.toLowerCase())) : hscodeKeys,
    [hscodeKeys, search]
  );

  const totalItemsWithHscode = products.filter(p => p.hscode).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700">Items with HS Codes ({totalItemsWithHscode} items, {hscodeKeys.length} codes)</h3>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search HS Code..."
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none w-64" />
      </div>
      {filteredKeys.length === 0 ? (
        <div className="text-center py-12 text-xs text-slate-400">
          {products.length === 0 ? 'No products found. Add items with HS Codes in Manage Items.' : 'No matching HS Codes.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredKeys.map(hs => {
            const items = productsByHscode[hs];
            const isOpen = expanded[hs];
            return (
              <div key={hs} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => setExpanded(prev => ({ ...prev, [hs]: !isOpen }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-base">{isOpen ? '▼' : '▶'}</span>
                    <span className="font-mono font-bold text-sm text-slate-800">{hs}</span>
                    <span className="text-[10px] text-slate-400">({items.length} items)</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50"><tr>
                        <th className="text-left px-4 py-2 text-[9px] font-bold text-slate-400 uppercase">Item Name</th>
                        <th className="text-left px-4 py-2 text-[9px] font-bold text-slate-400 uppercase">Group</th>
                        <th className="text-right px-4 py-2 text-[9px] font-bold text-slate-400 uppercase">Opening Stock</th>
                      </tr></thead>
                      <tbody>
                        {items.map(p => (
                          <tr key={p.id} className="border-t border-slate-50 hover:bg-slate-50">
                            <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                            <td className="px-4 py-2 text-slate-500">{p.group || '-'}</td>
                            <td className="px-4 py-2 text-right text-slate-800">{p.openingStock || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
