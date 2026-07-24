import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

const TAX_TYPES = [
  { id: 'purchase_apt', label: '📥 Purchase APT Rules' },
  { id: 'sales_reg_apt', label: '🧾 Reg Sales APT Rules' },
  { id: 'sales_unreg_apt', label: '📄 Unreg Sales APT Rules' },
];

export default function TaxCalcRules({ onClose, taxRates = [], uid = '' }) {
  const [activeType, setActiveType] = useState('purchase_apt');
  const [tab, setTab] = useState('add'); // 'add' or 'list'
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'tax_calc_rules'), orderBy('createdAt', 'desc')));
        setRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error('TaxCalcRules load error:', e); }
      setLoading(false);
    };
    load();
  }, []);

  const filteredRules = useMemo(() =>
    rules.filter(r => r.type === activeType),
    [rules, activeType]
  );

  return (
    <div className="fixed inset-0 z-[10002] bg-white flex flex-col">
      <style>{`.tcr input,.tcr select,.tcr textarea{color:#1e293b!important;background:#fff!important}.tcr select option{color:#1e293b!important}`}</style>

      {/* Header */}
      <div className="h-12 bg-[#1e3264] text-white flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-xs font-black">TC</div>
          <span className="text-sm font-bold">Tax Calculation Rules</span>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Type Tabs */}
      <div className="flex gap-1 px-5 py-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
        {TAX_TYPES.map(t => (
          <button key={t.id} onClick={() => setActiveType(t.id)}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${activeType === t.id ? 'bg-purple-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub tabs: Add / View */}
      <div className="flex gap-1 px-5 py-2 bg-white border-b border-slate-100 flex-shrink-0">
        <button onClick={() => setTab('add')}
          className={`px-3 py-1.5 text-[10px] font-bold rounded-lg ${tab === 'add' ? 'bg-purple-100 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}>
          ➕ Add Rule
        </button>
        <button onClick={() => setTab('list')}
          className={`px-3 py-1.5 text-[10px] font-bold rounded-lg ${tab === 'list' ? 'bg-purple-100 text-purple-700' : 'text-slate-400 hover:text-slate-600'}`}>
          📋 View Rules ({filteredRules.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5 tcr">
        {tab === 'add' && (
          <AddRuleTab type={activeType} taxRates={taxRates} uid={uid} rules={rules}
            onSaved={(newRule) => setRules(prev => [newRule, ...prev])} />
        )}
        {tab === 'list' && (
          <RuleListTab rules={filteredRules} taxRates={taxRates}
            onDeleted={(id) => setRules(prev => prev.filter(r => r.id !== id))} />
        )}
      </div>
    </div>
  );
}

// ─── Add Rule Tab ──────────────────────────────────────────────────────────────
function AddRuleTab({ type, taxRates, uid, rules, onSaved }) {
  const [selectedTax, setSelectedTax] = useState('');
  const [percentage, setPercentage] = useState('');
  const [baseOn, setBaseOn] = useState('assessed_value');
  const [plusTaxes, setPlusTaxes] = useState([]); // array of { taxId, taxName }
  const [saving, setSaving] = useState(false);

  // Get available taxes (not already used in rules for this type)
  const usedTaxIds = useMemo(() =>
    new Set(rules.filter(r => r.type === type).map(r => r.taxId)),
    [rules, type]
  );

  const availableTaxes = useMemo(() =>
    taxRates.filter(t => !usedTaxIds.has(t.id)),
    [taxRates, usedTaxIds]
  );

  const selectedTaxRate = useMemo(() =>
    taxRates.find(t => t.id === selectedTax),
    [taxRates, selectedTax]
  );

  const handleAddPlusTax = () => {
    // Ask user which tax to add via a simple prompt approach
    // We'll use an inline dropdown
    setPlusTaxes(prev => [...prev, { taxId: '', taxName: '' }]);
  };

  const updatePlusTax = (index, taxId) => {
    const tax = taxRates.find(t => t.id === taxId);
    setPlusTaxes(prev => {
      const next = [...prev];
      next[index] = { taxId, taxName: tax?.name || '' };
      return next;
    });
  };

  const removePlusTax = (index) => {
    setPlusTaxes(prev => prev.filter((_, i) => i !== index));
  };

  // Get taxes available for the plus chain (exclude self + already used)
  const getAvailablePlusTaxes = (currentIndex) => {
    const usedInChain = plusTaxes.map(p => p.taxId).filter((id, i) => i < currentIndex && id);
    return taxRates.filter(t =>
      t.id !== selectedTax && !usedInChain.includes(t.id) && !usedTaxIds.has(t.id)
    );
  };

  const save = async () => {
    if (!selectedTax) { alert('Select a tax'); return; }
    if (!percentage) { alert('Enter percentage'); return; }
    setSaving(true);
    try {
      const ruleData = {
        type,
        taxId: selectedTax,
        taxName: selectedTaxRate?.name || '',
        percentage: Number(percentage),
        baseOn,
        plusTaxes: baseOn === 'assessed_value_plus' ? plusTaxes.filter(p => p.taxId) : [],
        userId: uid,
        createdAt: serverTimestamp()
      };
      const ref = await addDoc(collection(db, 'tax_calc_rules'), ruleData);
      onSaved({ id: ref.id, ...ruleData });
      setSelectedTax('');
      setPercentage('');
      setBaseOn('assessed_value');
      setPlusTaxes([]);
      alert('✅ Rule added!');
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="text-sm font-bold text-slate-700 mb-4">
        Add Rule for {type === 'purchase_apt' ? 'Purchase APT' : type === 'sales_reg_apt' ? 'Reg Sales APT' : 'Unreg Sales APT'}
      </h3>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        {/* Tax Select */}
        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">
            Select Tax <span className="text-red-400">*</span>
          </label>
          <select value={selectedTax} onChange={e => setSelectedTax(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
            <option value="">— Select Tax —</option>
            {availableTaxes.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>
            ))}
            {availableTaxes.length === 0 && <option disabled>All taxes already have rules</option>}
          </select>
          {selectedTaxRate && (
            <div className="mt-1 text-[10px] text-green-600">Selected: {selectedTaxRate.name} @ {selectedTaxRate.rate}%</div>
          )}
        </div>

        {/* Percentage */}
        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">
            Duty / Tax Percentage (%) <span className="text-red-400">*</span>
          </label>
          <input type="number" value={percentage} onChange={e => setPercentage(e.target.value)}
            placeholder="e.g. 17"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-purple-500" />
        </div>

        {/* Calculated On */}
        <div>
          <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">
            This tax will be calculated on
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
              <input type="radio" name="baseOn" value="assessed_value" checked={baseOn === 'assessed_value'}
                onChange={() => setBaseOn('assessed_value')} className="accent-purple-600" />
              <span className="text-xs text-slate-700">Item's Assessed Value only</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
              <input type="radio" name="baseOn" value="assessed_value_plus" checked={baseOn === 'assessed_value_plus'}
                onChange={() => setBaseOn('assessed_value_plus')} className="accent-purple-600" />
              <span className="text-xs text-slate-700">Assessed Value + (other taxes)</span>
            </label>
          </div>
        </div>

        {/* Plus Taxes Chain */}
        {baseOn === 'assessed_value_plus' && (
          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-bold text-slate-400 uppercase">Add other taxes to base</label>
              <button onClick={handleAddPlusTax}
                className="px-3 py-1 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-lg hover:bg-purple-200">
                + Add Tax
              </button>
            </div>

            {plusTaxes.length === 0 && (
              <div className="text-[10px] text-slate-400 text-center py-2">
                No additional taxes added yet. Click "+ Add Tax" to chain another tax.
              </div>
            )}

            {plusTaxes.map((pt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 w-4">{i + 1}.</span>
                <select value={pt.taxId} onChange={e => updatePlusTax(i, e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                  <option value="">— Select Tax —</option>
                  {getAvailablePlusTaxes(i).map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({Number(t.rate||0)}%)</option>
                  ))}
                </select>
                <button onClick={() => removePlusTax(i)}
                  className="px-2 py-1 text-red-500 hover:text-red-700 text-xs">✕</button>
              </div>
            ))}

            {plusTaxes.filter(p => p.taxId).length > 0 && (
              <div className="text-[10px] text-slate-500 bg-white rounded-lg p-2 font-mono">
                Formula: Assessed Value {plusTaxes.filter(p => p.taxId).map((p, i) => (
                  <span key={i}> + ({p.taxName}%)</span>
                ))} → then apply {percentage || '?'}%
              </div>
            )}
          </div>
        )}

        {/* Save */}
        <button onClick={save} disabled={saving}
          className="w-full py-3 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 shadow-lg disabled:opacity-50">
          {saving ? '💾 Saving...' : '💾 Save Rule'}
        </button>
      </div>
    </div>
  );
}

// ─── View Rules List Tab ──────────────────────────────────────────────────────
function RuleListTab({ rules, taxRates, onDeleted }) {
  const [deleting, setDeleting] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this calculation rule?')) return;
    setDeleting(id);
    try {
      await deleteDoc(doc(db, 'tax_calc_rules', id));
      onDeleted(id);
    } catch (e) { alert('Delete failed: ' + e.message); }
    setDeleting(null);
  };

  if (rules.length === 0) {
    return <div className="text-center py-12 text-xs text-slate-400">No rules added yet.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Tax Calculation Rules ({rules.length})</h3>
      <div className="space-y-3">
        {rules.map(r => {
          const isExpanded = expandedId === r.id;
          const plusTaxNames = (r.plusTaxes || []).map(pt => {
            const t = taxRates.find(tx => tx.id === pt.taxId);
            return t?.name || pt.taxName || pt.taxId;
          });

          return (
            <div key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                  <span className="font-bold text-sm text-slate-800">{r.taxName || r.taxId}</span>
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold">{r.percentage}%</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                  disabled={deleting === r.id}
                  className="px-2 py-1 bg-red-100 text-red-600 text-[10px] font-bold rounded hover:bg-red-200">
                  {deleting === r.id ? '...' : '🗑️'}
                </button>
              </button>
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3 space-y-1 text-xs">
                  <div className="text-slate-500">Calculation:</div>
                  <div className="bg-slate-50 rounded-lg p-3 font-mono text-sm text-slate-700">
                    {r.baseOn === 'assessed_value' ? (
                      <span>Assessed Value × <b>{r.percentage}%</b></span>
                    ) : (
                      <span>
                        (Assessed Value {plusTaxNames.map(n => <span key={n}> + <b>{n}</b></span>)})
                        {' '}× <b>{r.percentage}%</b>
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 text-[10px]">Type: {r.type} | ID: {r.id}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
