import React, { useState, useEffect } from 'react';
import { X, Plus, Check, Loader2 } from 'lucide-react';

/**
 * QuickMasterModal — lightweight "add new" dialog used by the dropdown lists in
 * vouchers (purchase / sales / payment / receipt / journal ...).
 *
 * Shows ONLY the name and the type (under-group / account type) so a new master
 * can be created without leaving the voucher. A small "Add full details" link
 * expands the complete Create / Alter Masters field set for that collection.
 *
 * Writing is delegated to the App-level create handler so the rules are identical
 * to the old screen (duplicate-name guard, name_lowercase, numeric coercion,
 * opening stock/balance seeding, CREATED audit log).
 */

// 'Primary' is prepended to the group list, but a group may legitimately be
// called "Primary" itself - de-duplicate so React keys stay unique.
const withPrimary = (groups) => {
    const seen = new Set();
    const out = [];
    ['Primary', ...(groups || [])].forEach(v => {
        const k = String(v ?? '').trim().toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push(v);
    });
    return out;
};

// Field definitions per collection. `isType: true` marks the single field shown
// in the minimal view next to the name.
const quickMasterFields = {
    parties: [
        { key: 'name', label: 'Party Name', type: 'text', required: true },
        { key: 'group', label: 'Under Group', type: 'select', isType: true },
        { key: 'openingBalance', label: 'Opening Balance', type: 'number' },
        { key: 'trn', label: 'TRN Number', type: 'text' },
        { key: 'email', label: 'Email Address', type: 'email' },
        { key: 'address', label: 'Company Address', type: 'text' },
        { key: 'mobile', label: 'Mobile', type: 'tel' }
    ],
    products: [
        { key: 'name', label: 'Item Name', type: 'text', required: true },
        { key: 'group', label: 'Under Group', type: 'select', isType: true },
        { key: 'hscode', label: 'HS Code', type: 'text' },
        { key: 'openingStock', label: 'Opening Qty', type: 'number' },
        { key: 'openingRate', label: 'Opening Rate', type: 'number' },
        { key: 'openingBalance', label: 'Opening Value', type: 'number' }
    ],
    accounts: [
        { key: 'name', label: 'Account Name', type: 'text', required: true },
        { key: 'type', label: 'Account Type', type: 'select', isType: true, staticOptions: ['bank', 'current_asset', 'fixed_asset', 'expense', 'other'] },
        { key: 'openingBalance', label: 'Opening Balance', type: 'number' }
    ],
    expenses: [
        { key: 'name', label: 'Indirect Expense Name', type: 'text', required: true },
        { key: 'group', label: 'Under Group', type: 'select', isType: true }
    ],
    direct_expenses: [
        { key: 'name', label: 'Direct Expense Name', type: 'text', required: true },
        { key: 'group', label: 'Under Group', type: 'select', isType: true }
    ],
    income_accounts: [
        { key: 'name', label: 'Income Account Name', type: 'text', required: true }
    ],
    capital_accounts: [
        { key: 'name', label: 'Owner Name', type: 'text', required: true },
        { key: 'openingBalance', label: 'Opening Balance (Invested)', type: 'number' }
    ],
    asset_accounts: [
        { key: 'name', label: 'Asset Name', type: 'text', required: true },
        { key: 'openingBalance', label: 'Opening Balance', type: 'number' }
    ],
    lots: [
        { key: 'name', label: 'Lot No / Batch No', type: 'text', required: true },
        { key: 'description', label: 'Description / Remarks', type: 'text' },
        { key: 'status', label: 'Status', type: 'select', staticOptions: ['Open', 'Closed'] }
    ],
    tax_rates: [
        { key: 'name', label: 'Tax Name', type: 'text', required: true },
        { key: 'rate', label: 'Rate %', type: 'number' }
    ],
    party_groups: [
        { key: 'name', label: 'Group Name', type: 'text', required: true },
        { key: 'addValues', label: 'Add Values?', type: 'select', staticOptions: ['Yes', 'No'] }
    ],
    expense_groups: [
        { key: 'name', label: 'Group Name', type: 'text', required: true },
        { key: 'addValues', label: 'Add Values?', type: 'select', staticOptions: ['Yes', 'No'] }
    ],
    stock_groups: [
        { key: 'name', label: 'Group Name', type: 'text', required: true },
        { key: 'parent', label: 'Parent Group', type: 'select', isType: true },
        { key: 'shouldQuantities', label: 'Add Quantities?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'shouldValues', label: 'Add Values?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addInwardQty', label: 'Add Inward Qty to Totals?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addInwardValue', label: 'Add Inward Value to Totals?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addOutwardQty', label: 'Add Outward Qty to Totals?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addOutwardValue', label: 'Add Outward Value to Totals?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addClosingQty', label: 'Add Closing Qty to Totals?', type: 'select', staticOptions: ['Yes', 'No'] },
        { key: 'addClosingValue', label: 'Add Closing Value to Totals?', type: 'select', staticOptions: ['Yes', 'No'] }
    ]
};

const TITLES = {
    parties: 'New Customer / Supplier',
    products: 'New Item',
    accounts: 'New Cash / Bank Account',
    expenses: 'New Indirect Expense',
    direct_expenses: 'New Direct Expense',
    income_accounts: 'New Income Account',
    capital_accounts: 'New Capital Account',
    asset_accounts: 'New Asset',
    lots: 'New Lot Number',
    tax_rates: 'New Tax Rate',
    party_groups: 'New Customer Group',
    expense_groups: 'New Expense Group',
    stock_groups: 'New Stock Group'
};

const QuickMasterModal = ({ isOpen, onClose, collectionName, groupOptions = [], onCreate }) => {
    const [form, setForm] = useState({});
    const [showAll, setShowAll] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Reset whenever it opens (or the target collection changes)
    useEffect(() => {
        if (isOpen) {
            setForm({});
            setShowAll(false);
            setError(null);
        }
    }, [isOpen, collectionName]);

    const fields = quickMasterFields[collectionName] || [];
    const typeField = fields.find(f => f.isType) || null;
    const detailFields = fields.filter(f => f.key !== 'name' && (!typeField || f.key !== typeField.key));

    const optionsFor = (field) => {
        if (field.staticOptions) return field.staticOptions;
        if (field.isType) return withPrimary(groupOptions);
        return [];
    };

    if (!isOpen) return null;

    const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

    const submit = async (e) => {
        e.preventDefault();
        const name = String(form.name ?? '').trim();
        if (!name) { setError('Name is required.'); return; }
        if (!onCreate) { setError('Cannot create a record here.'); return; }

        setSaving(true);
        setError(null);
        try {
            const payload = { ...form, name };
            if (!payload[typeField?.key] && typeField) payload[typeField.key] = 'Primary';
            const res = await onCreate(collectionName, payload);
            if (res?.ok) onClose();
            else if (!res?.cancelled) setError(res?.error || 'Could not save the new record.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const renderField = (field) => (
        <label key={field.key} className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {field.label}{field.required ? ' *' : ''}
            </span>
            {field.type === 'select' ? (
                <select
                    value={form[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium focus:border-[#005994] outline-none bg-white"
                >
                    <option value="">Select...</option>
                    {optionsFor(field).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            ) : (
                <input
                    type={field.type}
                    value={form[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:border-[#005994] outline-none"
                />
            )}
        </label>
    );

    return (
        <div className="fixed inset-0 z-[900000] flex items-start justify-center bg-slate-900/40 backdrop-blur-[2px] p-4 pt-[8vh]">
            <form
                onSubmit={submit}
                className={`bg-white rounded-2xl w-full ${showAll ? 'max-w-2xl' : 'max-w-md'} shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto`}
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                    <h3 className="font-bold text-[#005994] flex items-center gap-2 text-sm uppercase tracking-wide">
                        <Plus size={16} />
                        <span>{TITLES[collectionName] || 'New Record'}</span>
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-3.5">
                    {renderField(fields.find(f => f.key === 'name') || { key: 'name', label: 'Name', type: 'text', required: true })}

                    {typeField && renderField(typeField)}

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowAll(v => !v)}
                            className="text-[11px] font-black uppercase tracking-wide text-[#005994] underline decoration-dotted underline-offset-2 hover:text-[#004878]"
                        >
                            {showAll ? 'Hide full details' : '+ Add full details'}
                        </button>
                        <span className="text-[10px] text-slate-400 font-semibold">
                            {showAll ? '' : '(you can save with just the name)'}
                        </span>
                    </div>

                    {showAll && (
                        <div className="border-t border-slate-100 pt-3">
                            {detailFields.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {detailFields.map(renderField)}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 italic">No extra fields for this type.</p>
                            )}
                            {collectionName === 'parties' && (
                                <p className="text-[10px] text-slate-400 font-semibold mt-2">
                                    Bank details are added later from Create / Alter Masters {"->"} Customers / Parties.
                                </p>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-5 py-3.5">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-2 bg-[#005994] hover:bg-[#004878] disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
                    >
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        <span>{saving ? 'Saving...' : 'Save'}</span>
                    </button>
                </div>
            </form>
        </div>
    );
};

export default QuickMasterModal;
