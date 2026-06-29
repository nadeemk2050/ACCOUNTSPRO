import React, { useState } from 'react';
import { Modal } from './components/Modal';
import { DownloadCloud, FileText, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { addBackupHistoryEntry } from './BackupHistoryModal';

const VOUCHER_TYPES = [
    { label: 'Sales', collection: 'invoices', typeFilter: 'sales' },
    { label: 'Purchases', collection: 'invoices', typeFilter: 'purchase' },
    { label: 'Payments', collection: 'payments', typeFilter: 'out' },
    { label: 'Receipt', collection: 'payments', typeFilter: 'in' },
    { label: 'Contra', collection: 'payments', typeFilter: 'contra' },
    { label: 'Journal', collection: 'journal_vouchers', typeFilter: null },
    { label: 'Stock Journal', collection: 'stock_journals', typeFilter: null },
];

// Date parsing matching the app's toDateObject logic
const toDateObject = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
        if (value.includes('T')) return new Date(value);
        return new Date(`${value}T00:00:00`);
    }
    return null;
};

export default function ExportVoucherModal({ isOpen, onClose, user, dataOwnerId, invoices, payments, journalVouchers, stockJournals }) {
    const [selectedType, setSelectedType] = useState(null);
    const [periodMode, setPeriodMode] = useState('all'); // 'all' or 'range'
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [exporting, setExporting] = useState(false);
    const [result, setResult] = useState(null);

    const reset = () => {
        setSelectedType(null);
        setPeriodMode('all');
        setStartDate('');
        setEndDate('');
        setExporting(false);
        setResult(null);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleExport = async () => {
        if (!selectedType) return;
        setExporting(true);
        setResult(null);

        try {
            // Get the source data array based on selected collection
            let sourceData = [];
            if (selectedType.collection === 'invoices') sourceData = invoices || [];
            else if (selectedType.collection === 'payments') sourceData = payments || [];
            else if (selectedType.collection === 'journal_vouchers') sourceData = journalVouchers || [];
            else if (selectedType.collection === 'stock_journals') sourceData = stockJournals || [];

            // Filter by type (e.g., 'purchase' for invoices, 'out' for payments)
            let filtered = sourceData;
            if (selectedType.typeFilter) {
                filtered = filtered.filter(v => v.type === selectedType.typeFilter);
            }

            // Filter by date range
            if (periodMode === 'range' && startDate && endDate) {
                const rangeStart = toDateObject(startDate);
                const rangeEnd = toDateObject(endDate);
                if (rangeStart && rangeEnd) {
                    rangeEnd.setHours(23, 59, 59, 999);
                    filtered = filtered.filter(v => {
                        const d = toDateObject(v.date);
                        return d && d >= rangeStart && d <= rangeEnd;
                    });
                }
            }

            if (filtered.length === 0) {
                setResult({ success: false, message: 'No vouchers found for the selected criteria.' });
                setExporting(false);
                return;
            }

            // Build export object
            const exportData = {
                meta: {
                    date: new Date().toISOString(),
                    version: '3.0',
                    exportedBy: user?.email || 'unknown',
                    scope: `voucher_export_${selectedType.label.toLowerCase().replace(/\s+/g, '_')}`,
                    ownerId: user?.uid || dataOwnerId,
                    voucherType: selectedType.label,
                    collection: selectedType.collection,
                    typeFilter: selectedType.typeFilter,
                    dateRange: periodMode === 'range' ? { start: startDate, end: endDate } : 'all',
                    count: filtered.length,
                },
                data: {
                    [selectedType.collection]: filtered,
                },
            };

            // Download JSON file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const fileName = `${selectedType.label.toLowerCase().replace(/\s+/g, '_')}_${periodMode === 'range' ? `${startDate}_to_${endDate}` : 'all'}_${new Date().toISOString().slice(0, 10)}.json`;
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Log to backup history
            try {
                addBackupHistoryEntry({ action: 'export_voucher', type: selectedType.label, count: filtered.length, collection: selectedType.collection, details: `Exported ${filtered.length} ${selectedType.label} vouchers` });
            } catch {}

            setResult({ success: true, message: `✅ Exported ${filtered.length} ${selectedType.label} voucher(s) successfully!` });
        } catch (err) {
            console.error('[ExportVoucher] Error:', err);
            setResult({ success: false, message: `Error: ${err.message}` });
        }
        setExporting(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Export by Voucher Type" maxWidth="max-w-lg" zIndex={60}>
            <div className="space-y-5 p-2">
                <p className="text-sm text-gray-500">Select voucher type and date range to export.</p>

                {/* Voucher Type Selection */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Voucher Type</label>
                    <div className="grid grid-cols-2 gap-2">
                        {VOUCHER_TYPES.map(vt => (
                            <button
                                key={vt.label}
                                onClick={() => { setSelectedType(vt); setResult(null); }}
                                className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
                                    selectedType?.label === vt.label
                                        ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <FileText size={16} />
                                    {vt.label}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Period Selection */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Period</label>
                    <div className="flex gap-3 mb-3">
                        <button
                            onClick={() => setPeriodMode('all')}
                            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                                periodMode === 'all'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                            }`}
                        >
                            All Vouchers
                        </button>
                        <button
                            onClick={() => setPeriodMode('range')}
                            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                                periodMode === 'range'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                            }`}
                        >
                            By Date Range
                        </button>
                    </div>

                    {periodMode === 'range' && (
                        <div className="flex gap-3 items-center">
                            <div className="flex-1">
                                <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                />
                            </div>
                            <span className="text-gray-400 mt-5">→</span>
                            <div className="flex-1">
                                <label className="block text-xs text-gray-500 mb-1">End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Export Button */}
                <button
                    onClick={handleExport}
                    disabled={!selectedType || exporting}
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        !selectedType || exporting
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-lg shadow-blue-200'
                    }`}
                >
                    {exporting ? (
                        <><Loader size={18} className="animate-spin" /> Exporting...</>
                    ) : (
                        <><DownloadCloud size={18} /> Export Vouchers</>
                    )}
                </button>

                {/* Result Message */}
                {result && (
                    <div className={`p-3 rounded-xl text-sm font-medium flex items-start gap-2 ${
                        result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                        {result.success ? <CheckCircle size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
                        <span>{result.message}</span>
                    </div>
                )}
            </div>
        </Modal>
    );
}
