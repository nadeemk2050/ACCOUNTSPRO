import React, { useState, useRef } from 'react';
import { Modal } from './components/Modal';
import { db } from './firebase';
import { collection, query, where, getDocs, addDoc, setDoc, doc, writeBatch } from 'firebase/firestore';
import { UploadCloud, FileText, Loader, CheckCircle, AlertCircle, Search, Upload } from 'lucide-react';
import { addBackupHistoryEntry } from './BackupHistoryModal';

const VOUCHER_MAPPING = [
    { label: 'Sales', collection: 'invoices', typeFilter: 'sales' },
    { label: 'Purchases', collection: 'invoices', typeFilter: 'purchase' },
    { label: 'Payments', collection: 'payments', typeFilter: 'out' },
    { label: 'Receipt', collection: 'payments', typeFilter: 'in' },
    { label: 'Contra', collection: 'payments', typeFilter: 'contra' },
    { label: 'Journal', collection: 'journal_vouchers', typeFilter: null },
    { label: 'Stock Journal', collection: 'stock_journals', typeFilter: null },
];

export default function ImportVoucherModal({ isOpen, onClose, user, dataOwnerId }) {
    const [selectedType, setSelectedType] = useState(null);
    const [fileData, setFileData] = useState(null);
    const [fileName, setFileName] = useState('');
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState(null);
    const [preview, setPreview] = useState(null);
    const fileInputRef = useRef(null);

    const reset = () => {
        setSelectedType(null);
        setFileData(null);
        setFileName('');
        setImporting(false);
        setResult(null);
        setPreview(null);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setFileName(file.name);
        setResult(null);
        setSelectedType(null);
        setPreview(null);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const json = JSON.parse(evt.target.result);
                setFileData(json);

                // Build preview: count docs per collection
                const counts = {};
                if (json.data) {
                    for (const [col, docs] of Object.entries(json.data)) {
                        if (Array.isArray(docs)) {
                            counts[col] = docs.length;
                        }
                    }
                }
                setPreview(counts);
            } catch (err) {
                setResult({ success: false, message: `Invalid JSON file: ${err.message}` });
                setFileData(null);
            }
        };
        reader.readAsText(file);
    };

    const getMatchingDocs = () => {
        if (!fileData?.data || !selectedType) return [];

        const colDocs = fileData.data[selectedType.collection];
        if (!Array.isArray(colDocs)) return [];

        if (selectedType.typeFilter) {
            return colDocs.filter(d => d.type === selectedType.typeFilter);
        }
        return colDocs;
    };

    const handleImport = async () => {
        if (!selectedType || !fileData) return;
        setImporting(true);
        setResult(null);

        try {
            const uid = dataOwnerId || user?.uid;
            if (!uid) throw new Error('User not identified');

            const matchingDocs = getMatchingDocs();
            if (matchingDocs.length === 0) {
                setResult({ success: false, message: `No ${selectedType.label} vouchers found in the selected file.` });
                setImporting(false);
                return;
            }

            // Fetch existing refNos from Firestore for this collection+user
            const constraints = [where('userId', '==', uid)];
            if (selectedType.typeFilter) {
                constraints.push(where('type', '==', selectedType.typeFilter));
            }
            const q = query(collection(db, selectedType.collection), ...constraints);
            const existingSnap = await getDocs(q);
            const existingRefNos = new Set(existingSnap.docs.map(d => d.data().refNo).filter(Boolean));

            // Filter: keep only docs whose refNo is NOT already in Firestore
            const newDocs = matchingDocs.filter(d => !existingRefNos.has(d.refNo));

            if (newDocs.length === 0) {
                setResult({ success: true, message: `All ${matchingDocs.length} ${selectedType.label} voucher(s) already exist. Nothing to import.` });
                setImporting(false);
                return;
            }

            // Add new docs to Firestore with correct userId stamped
            let added = 0;
            let errors = 0;

            // Use batches of 500 (Firestore limit)
            const BATCH_SIZE = 500;
            for (let i = 0; i < newDocs.length; i += BATCH_SIZE) {
                const batch = writeBatch(db);
                const chunk = newDocs.slice(i, i + BATCH_SIZE);

                for (const docData of chunk) {
                    const { id, ...rest } = docData;
                    const docRef = doc(collection(db, selectedType.collection)); // auto-generated ID
                    batch.set(docRef, {
                        ...rest,
                        // Stamp current userId so it matches the snapshot listener filter
                        userId: uid,
                        ownerId: uid,
                        importedAt: new Date().toISOString(),
                        importedFromBackup: true,
                    });
                }

                await batch.commit();
                added += chunk.length;
            }

            const skipped = matchingDocs.length - newDocs.length;

            // Log to backup history
            try {
                addBackupHistoryEntry({ action: 'import_voucher', type: selectedType.label, count: added, collection: selectedType.collection, details: `Imported ${added} new ${selectedType.label} vouchers, skipped ${skipped} duplicates` });
            } catch {}

            setResult({
                success: true,
                message: `✅ Imported ${added} new ${selectedType.label} voucher(s). Skipped ${skipped} duplicate(s).`,
            });
        } catch (err) {
            console.error('[ImportVoucher] Error:', err);
            setResult({ success: false, message: `Error: ${err.message}` });
        }
        setImporting(false);
    };

    const matchingCount = selectedType && fileData ? getMatchingDocs().length : 0;

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import / Restore Vouchers" maxWidth="max-w-lg" zIndex={60}>
            <div className="space-y-5 p-2">
                <p className="text-sm text-gray-500">Upload a JSON backup file and restore vouchers by type. Duplicate refNos will be skipped.</p>

                {/* File Upload */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Backup File</label>
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        {fileName ? (
                            <div className="flex items-center justify-center gap-2 text-blue-600">
                                <FileText size={20} />
                                <span className="font-medium text-sm">{fileName}</span>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-1 text-gray-400">
                                <Upload size={24} />
                                <span className="text-sm font-medium">Click to select a JSON backup file</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Preview */}
                {preview && (
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">File contains:</p>
                        <div className="space-y-1">
                            {Object.entries(preview).map(([col, count]) => (
                                <div key={col} className="flex justify-between text-sm">
                                    <span className="text-gray-600">{col}</span>
                                    <span className="font-medium text-gray-800">{count} records</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Voucher Type Selection */}
                {fileData && (
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Select Voucher Type to Restore</label>
                        <div className="grid grid-cols-2 gap-2">
                            {VOUCHER_MAPPING.map(vt => {
                                const count = fileData?.data?.[vt.collection]
                                    ?.filter(d => !vt.typeFilter || d.type === vt.typeFilter).length || 0;
                                return (
                                    <button
                                        key={vt.label}
                                        onClick={() => { setSelectedType(vt); setResult(null); }}
                                        disabled={count === 0}
                                        className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-left ${
                                            count === 0
                                                ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                                                : selectedType?.label === vt.label
                                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:bg-emerald-50/50'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="flex items-center gap-2">
                                                <FileText size={16} />
                                                {vt.label}
                                            </span>
                                            {count > 0 && (
                                                <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{count}</span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Import Button */}
                {selectedType && matchingCount > 0 && (
                    <button
                        onClick={handleImport}
                        disabled={importing}
                        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                            importing
                                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] shadow-lg shadow-emerald-200'
                        }`}
                    >
                        {importing ? (
                            <><Loader size={18} className="animate-spin" /> Importing...</>
                        ) : (
                            <><UploadCloud size={18} /> Import {matchingCount} Voucher(s)</>
                        )}
                    </button>
                )}

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
