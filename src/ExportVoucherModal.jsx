import React, { useState } from 'react';
import { Modal } from './components/Modal';
import { DownloadCloud, FileText, Loader, CheckCircle, AlertCircle, Package, Recycle } from 'lucide-react';
import { addBackupHistoryEntry } from './BackupHistoryModal';
import { db } from './firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

// Jumbo bags can only exist on these voucher scopes
const BAGS_SUPPORTED = (type) => !!type && (
    (type.collection === 'invoices' && ['sales', 'purchase'].includes(type.typeFilter)) ||
    type.collection === 'stock_journals'
);

const normalizeBagNo = (v) => String(v || '').replace(/^#/, '').trim().toUpperCase();

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
    const [includeBags, setIncludeBags] = useState(true);
    const [includeReusable, setIncludeReusable] = useState(true);
    const [includeAllBags, setIncludeAllBags] = useState(true);

    const bagsSupported = BAGS_SUPPORTED(selectedType);

    const reset = () => {
        setSelectedType(null);
        setPeriodMode('all');
        setStartDate('');
        setEndDate('');
        setExporting(false);
        setResult(null);
        setIncludeBags(true);
        setIncludeReusable(true);
        setIncludeAllBags(true);
    };

    // ── Jumbo bags linked to the exported vouchers (by doc id, REF NO, or embedded bag numbers)
    const fetchRelatedBags = async (vouchers, collectionName) => {
        const uid = dataOwnerId || user?.uid;
        if (!uid || !vouchers?.length) return [];

        const snaps = await Promise.all([
            getDocs(query(collection(db, 'jumbo_bags'), where('userId', '==', uid))),
            getDocs(query(collection(db, 'jumbo_bags'), where('ownerId', '==', uid)))
        ]);
        const map = new Map();
        snaps.forEach(s => s.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() })));
        const allBags = [...map.values()];

        const ids = new Set();
        const refNos = new Set();
        const bagNos = new Set();
        vouchers.forEach(v => {
            if (v.id) ids.add(String(v.id).trim());
            if (v.refNo) refNos.add(String(v.refNo).trim());
            const embedded = [
                ...(Array.isArray(v.jumboBags) ? v.jumboBags : []),
                ...(Array.isArray(v.jumbo_bags) ? v.jumbo_bags : []),
                ...(Array.isArray(v.producedBags) ? v.producedBags : []),
                ...(Array.isArray(v.soldBags) ? v.soldBags : []),
                ...(Array.isArray(v.produced)
                    ? v.produced.flatMap(p => [
                        ...(Array.isArray(p?.jumboBags) ? p.jumboBags : []),
                        ...(Array.isArray(p?.jumbo_bags) ? p.jumbo_bags : [])
                    ])
                    : [])
            ];
            embedded.forEach(b => {
                const bn = normalizeBagNo(b?.bagNo || b?.bagNoKey);
                if (bn) bagNos.add(bn);
            });
        });

        // Match every bag → voucher link style used across the app (see Filled Bags Intelligence getBagsForVoucher)
        const isStockJournal = collectionName === 'stock_journals';
        const idFields = isStockJournal
            ? ['stockJournalId', 'linkedStockJournalId', 'voucherId', 'originId', 'purchaseId', 'salesId']
            : ['salesId', 'purchaseId', 'voucherId', 'originId', 'stockJournalId', 'linkedStockJournalId'];
        const refFields = ['stockJournalRefNo', 'voucherRefNo', 'purchaseRefNo', 'salesRefNo', 'refNo'];

        return allBags.filter(b => {
            const bn = normalizeBagNo(b.bagNo);
            if (bn && bagNos.has(bn)) return true;
            if (idFields.some(f => b[f] && ids.has(String(b[f]).trim()))) return true;
            return refFields.some(f => b[f] && refNos.has(String(b[f]).trim()));
        });
    };

    // ── Reusable Jumbo Bags registry (global list, refillable bags approved for manufacturing allocation)
    const fetchReusableBags = async () => {
        const uid = dataOwnerId || user?.uid;
        if (!uid) return [];
        const snaps = await Promise.all([
            getDocs(query(collection(db, 'reusable_jumbo_bags'), where('userId', '==', uid))),
            getDocs(query(collection(db, 'reusable_jumbo_bags'), where('ownerId', '==', uid)))
        ]);
        const map = new Map();
        snaps.forEach(s => s.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() })));
        return [...map.values()];
    };

    // ── Full bag dump: every jumbo bag record (incl. unused / orphan / duplicate) + legacy reusable scope
    const fetchAllBagRecords = async () => {
        const uid = dataOwnerId || user?.uid;
        if (!uid) return { bags: [], legacyReusable: [] };
        const [bagByUser, bagByOwner, reusableByUser] = await Promise.all([
            getDocs(query(collection(db, 'jumbo_bags'), where('userId', '==', uid))),
            getDocs(query(collection(db, 'jumbo_bags'), where('ownerId', '==', uid))),
            getDocs(query(collection(db, 'reusable_jumbo_bags'), where('userId', '==', uid)))
        ]);
        const bagMap = new Map();
        [...bagByUser.docs, ...bagByOwner.docs].forEach(d => bagMap.set(d.id, { id: d.id, ...d.data() }));
        return { bags: [...bagMap.values()], legacyReusable: reusableByUser.docs.map(d => ({ id: d.id, ...d.data() })) };
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

            // ── JUMBO BAGS: attach the bag records linked to these vouchers so Import restores them too
            let bagsForExport = [];
            if (includeBags && bagsSupported) {
                try {
                    const relatedBags = await fetchRelatedBags(filtered, selectedType.collection);
                    // Make every bag re-linkable after import: ensure the parent REF NO is present
                    const refById = new Map();
                    filtered.forEach(v => { if (v.id) refById.set(String(v.id).trim(), v.refNo || ''); });
                    bagsForExport = relatedBags.map(b => {
                        const patch = {};
                        const link = (idField, refField) => {
                            const v = b[idField] ? refById.get(String(b[idField]).trim()) : '';
                            if (v && !b[refField]) patch[refField] = v;
                        };
                        link('salesId', 'salesRefNo');
                        link('purchaseId', 'purchaseRefNo');
                        link('stockJournalId', 'stockJournalRefNo');
                        return Object.keys(patch).length ? { ...b, ...patch } : b;
                    });
                } catch (e) {
                    console.warn('[ExportVoucher] Jumbo bag fetch failed:', e);
                }
            }

            // ── REUSABLE JUMBO BAGS: registry travels whole; usage history is re-pointed to the exported vouchers
            let reusableForExport = [];
            if (includeReusable && bagsSupported) {
                try {
                    const registry = await fetchReusableBags();
                    const idByRefNo = new Map();
                    filtered.forEach(v => { if (v.refNo && v.id) idByRefNo.set(String(v.refNo).trim(), String(v.id).trim()); });
                    reusableForExport = registry.map(rb => {
                        const history = Array.isArray(rb.usageHistory) ? rb.usageHistory : null;
                        if (!history) return rb;
                        const patched = history.map(h => {
                            const ref = String(h.manufacturingRefNo || '').trim();
                            if (ref && idByRefNo.has(ref) && String(h.stockJournalId || '') !== idByRefNo.get(ref)) {
                                return { ...h, stockJournalId: idByRefNo.get(ref) };
                            }
                            return h;
                        });
                        return { ...rb, usageHistory: patched };
                    });
                } catch (e) {
                    console.warn('[ExportVoucher] Reusable bag fetch failed:', e);
                }
            }

            // ── FULL BAG DUMP (optional): every bag record incl. unused / orphan / duplicates, plus legacy reusable scope
            let bagsScope = 'related';
            if (includeAllBags && bagsSupported) {
                try {
                    const { bags: everyBag, legacyReusable } = await fetchAllBagRecords();
                    const bagMap = new Map();
                    [...bagsForExport, ...everyBag].forEach(b => { if (b?.id) bagMap.set(b.id, b); });
                    bagsForExport = [...bagMap.values()];
                    const rMap = new Map();
                    [...reusableForExport, ...legacyReusable].forEach(rb => { if (rb?.id) rMap.set(rb.id, rb); });
                    reusableForExport = [...rMap.values()];
                    bagsScope = 'all';
                } catch (e) {
                    console.warn('[ExportVoucher] Full bag dump failed:', e);
                }
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
                    bagsCount: bagsForExport.length,
                    reusableBagsCount: reusableForExport.length,
                    bagsScope,
                },
                data: {
                    [selectedType.collection]: filtered,
                    ...(bagsForExport.length > 0 ? { jumbo_bags: bagsForExport } : {}),
                    ...(reusableForExport.length > 0 ? { reusable_jumbo_bags: reusableForExport } : {})
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
                addBackupHistoryEntry({ action: 'export_voucher', type: selectedType.label, count: filtered.length + bagsForExport.length + reusableForExport.length, collection: selectedType.collection, details: `Exported ${filtered.length} ${selectedType.label} vouchers${bagsForExport.length > 0 ? ` with ${bagsForExport.length} jumbo bags` : ''}${reusableForExport.length > 0 ? ` + ${reusableForExport.length} reusable bags` : ''}` });
            } catch {}

            setResult({
                success: true,
                message: `✅ Exported ${filtered.length} ${selectedType.label} voucher(s)${bagsForExport.length > 0 ? ` + ${bagsForExport.length} jumbo bag record(s)` : ''}${reusableForExport.length > 0 ? ` + ${reusableForExport.length} reusable bag(s)` : ''} successfully!`
            });
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

                {bagsSupported && (
                    <div className="border rounded-xl p-3 bg-emerald-50/40 border-emerald-200">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                className="mt-0.5 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                                checked={includeBags}
                                onChange={e => setIncludeBags(e.target.checked)}
                            />
                            <span>
                                <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                    <Package size={14} className="text-emerald-600" /> Include Jumbo Bags
                                </span>
                                <span className="block text-[11px] text-slate-500 mt-0.5">
                                    Adds the jumbo bag records linked to these vouchers (
                                    {selectedType.collection === 'stock_journals'
                                        ? 'bags created / allotted in production'
                                        : selectedType.typeFilter === 'sales'
                                            ? 'bags assigned in these sales'
                                            : 'bags allotted in these purchases'}
                                    ) so the Import restores them together.
                                </span>
                            </span>
                        </label>
                        <div className="mt-3 pt-3 border-t border-emerald-200">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                                    checked={includeReusable}
                                    onChange={e => setIncludeReusable(e.target.checked)}
                                />
                                <span>
                                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                        <Recycle size={14} className="text-teal-600" /> Include Reusable Bags Registry
                                    </span>
                                    <span className="block text-[11px] text-slate-500 mt-0.5">
                                        Adds the Reusable Jumbo Bags registry (active + deactivated, with usage history) so the Import restores the refillable bags used in manufacturing allocation.
                                    </span>
                                </span>
                            </label>
                        </div>
                        <div className="mt-3 pt-3 border-t border-emerald-200">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                                    checked={includeAllBags}
                                    onChange={e => setIncludeAllBags(e.target.checked)}
                                />
                                <span>
                                    <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                        <AlertCircle size={14} className="text-amber-600" /> Include ALL bag records (incl. unused / orphan / duplicate)
                                    </span>
                                    <span className="block text-[11px] text-slate-500 mt-0.5">
                                        Dumps every jumbo bag record in your data plus the legacy reusable registry scope — so buggy or orphan records travel with the file and can be reviewed & cleaned later.
                                    </span>
                                </span>
                            </label>
                        </div>
                    </div>
                )}

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
