import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * BankDetailsEditor — the multi-bank sub-form from the old Create / Alter Masters
 * "Customers / Parties" screen, made reusable so Chart of Masters and the
 * voucher "+ New" dialog can both edit a party's banks.
 *
 * Value shape (array on the party record):
 *   [{ bankTitle, bankName, branchName, iban, accNumber, swiftCode, bankAddress }]
 */

const EMPTY_BANK = {
    bankTitle: '',
    bankName: '',
    branchName: '',
    iban: '',
    accNumber: '',
    swiftCode: '',
    bankAddress: ''
};

const BANK_FIELDS = [
    { key: 'bankTitle', label: 'Bank Title' },
    { key: 'bankName', label: 'Bank Name' },
    { key: 'branchName', label: 'Branch Name' },
    { key: 'iban', label: 'IBAN' },
    { key: 'accNumber', label: 'Account Number' },
    { key: 'swiftCode', label: 'SWIFT Code' },
    { key: 'bankAddress', label: 'Bank Address' }
];

const BankDetailsEditor = ({ value = [], onChange, className = '' }) => {
    const rows = Array.isArray(value) ? value : [];

    const updateRow = (idx, key, val) => {
        onChange(rows.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
    };
    const addRow = () => onChange([...rows, { ...EMPTY_BANK }]);
    const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

    return (
        <div className={className}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                    Bank Details{rows.length > 0 ? ` (${rows.length})` : ''}
                </span>
                <button
                    type="button"
                    onClick={addRow}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#005994]/10 hover:bg-[#005994]/20 rounded-md text-[#005994] transition-colors"
                >
                    <Plus size={12} className="stroke-[3]" />
                    <span className="text-[10px] font-black uppercase tracking-wide">Add Bank</span>
                </button>
            </div>

            {rows.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">No bank details. Use "Add Bank" to add one.</p>
            ) : (
                <div className="space-y-2">
                    {rows.map((row, idx) => (
                        <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-bold text-slate-500">Bank #{idx + 1}</span>
                                <button
                                    type="button"
                                    onClick={() => removeRow(idx)}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                                    title="Remove this bank"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {BANK_FIELDS.map(f => (
                                    <label key={f.key} className="block">
                                        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{f.label}</span>
                                        <input
                                            type="text"
                                            value={row[f.key] ?? ''}
                                            onChange={(e) => updateRow(idx, f.key, e.target.value)}
                                            className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold focus:border-[#005994] outline-none bg-white"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BankDetailsEditor;
