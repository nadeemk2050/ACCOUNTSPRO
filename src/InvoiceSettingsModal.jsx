import React, { useState, useEffect } from 'react';
import { Modal } from './components/Modal';
import { X, UploadCloud, Trash2, Check, FileText } from 'lucide-react';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query, where, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from "firebase/storage";
import { db } from './firebase';

const InvoiceSettingsModal = ({ isOpen, onClose, onBack, zIndex, user, onSaveSettings, dataOwnerId }) => {
    const [loading, setLoading] = useState(false);
    const [headerImage, setHeaderImage] = useState(null);
    const [footerImage, setFooterImage] = useState(null);
    const [useHeader, setUseHeader] = useState(true);
    const [useFooter, setUseFooter] = useState(true);
    const [selectedHeading, setSelectedHeading] = useState('TAX INVOICE');
    const [availableHeadings, setAvailableHeadings] = useState([]);
    const [stampScale, setStampScale] = useState(1);

    const [companyDetails, setCompanyDetails] = useState({
        name: '',
        address: '',
        trn: '',
        email: '',
        phone: ''
    });

    const targetUid = dataOwnerId || user?.uid;

    useEffect(() => {
        if (!isOpen || !targetUid) return;

        // Load current settings from Firestore
        const loadSettings = async () => {
            const docRef = doc(db, 'invoice_settings', targetUid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setHeaderImage(data.headerImage || null);
                setFooterImage(data.footerImage || null);
                setUseHeader(data.useHeader !== false);
                setUseFooter(data.useFooter !== false);
                setSelectedHeading(data.selectedHeading || 'TAX INVOICE');
                setStampScale(data.stampScale || 1);
                setCompanyDetails(data.companyDetails || { name: '', address: '', trn: '', email: '', phone: '' });
            } else {
                setCompanyDetails({
                    name: user?.displayName || '',
                    address: '',
                    trn: '',
                    email: user?.email || '',
                    phone: ''
                });
            }
        };

        // Load available headings from company_images
        const unsub = onSnapshot(query(collection(db, 'company_images'), where('userId', '==', targetUid), where('category', '==', 'headings')), (snap) => {
            setAvailableHeadings(snap.docs.map(d => d.data().name));
        });

        loadSettings();
        return () => unsub();
    }, [isOpen, targetUid, user]);

    const handleSave = async () => {
        setLoading(true);
        try {
            await setDoc(doc(db, 'invoice_settings', targetUid), {
                headerImage,
                footerImage,
                companyDetails,
                useHeader,
                useFooter,
                selectedHeading,
                stampScale,
                userId: targetUid,
                updatedAt: new Date(),
                updatedBy: user?.uid
            }, { merge: true });

            if (onSaveSettings) onSaveSettings({
                headerImage,
                footerImage,
                companyDetails,
                useHeader,
                useFooter,
                selectedHeading,
                stampScale
            });
            onClose();

        } catch (e) {
            console.error(e);
            alert("Failed to save settings");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            onBack={onBack}
            zIndex={zIndex || 100}
            title="Invoice Print Settings"
            maxWidth="max-w-2xl"
        >
            <div className="space-y-6">
                {/* 0. Heading Type Selection */}
                <div className="space-y-2">
                    <label className="font-bold text-slate-700 block">Invoice Heading / Title</label>
                    <select
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                        value={selectedHeading}
                        onChange={(e) => setSelectedHeading(e.target.value)}
                    >
                        <option value="TAX INVOICE">Default (TAX INVOICE)</option>
                        <option value="INVOICE">INVOICE</option>
                        <option value="COMMERCIAL INVOICE">COMMERCIAL INVOICE</option>
                        <option value="SALES INVOICE">SALES INVOICE</option>
                        <option value="PURCHASE INVOICE">PURCHASE INVOICE</option>
                        {availableHeadings.map(h => (
                            <option key={h} value={h}>{h}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-slate-400">Headings can be managed in 'Image Files Storage'.</p>
                </div>

                {/* 1. Header Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-700">Company Header / Letterhead</label>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-medium">{useHeader ? "Enabled" : "Disabled (Using Text Fallback)"}</span>
                            <button
                                onClick={() => setUseHeader(!useHeader)}
                                className={`w-10 h-5 rounded-full transition-colors relative ${useHeader ? 'bg-green-500' : 'bg-slate-300'}`}
                            >
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${useHeader ? 'left-5.5' : 'left-0.5'}`} />
                            </button>
                        </div>
                    </div>

                    {useHeader ? (
                        <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center gap-3">
                            {headerImage ? (
                                <div className="relative group">
                                    <img src={headerImage} alt="Header" className="max-h-24 rounded shadow-sm" />
                                    <button
                                        onClick={() => setHeaderImage(null)}
                                        className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center py-4">
                                    <UploadCloud size={32} className="text-slate-300 mx-auto mb-2" />
                                    <p className="text-xs text-slate-500 font-medium">Header image not selected</p>
                                    <p className="text-[10px] text-slate-400 mt-1">Select from 'Image Files Storage' module</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-black text-slate-400">Company Name</label>
                                <input
                                    type="text"
                                    className="w-full bg-transparent border-b border-slate-200 py-1 font-bold text-slate-700 outline-none text-sm"
                                    value={companyDetails.name}
                                    onChange={(e) => setCompanyDetails({ ...companyDetails, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-black text-slate-400">Tax Registration (TRN)</label>
                                <input
                                    type="text"
                                    className="w-full bg-transparent border-b border-slate-200 py-1 font-bold text-slate-700 outline-none text-sm"
                                    value={companyDetails.trn}
                                    onChange={(e) => setCompanyDetails({ ...companyDetails, trn: e.target.value })}
                                />
                            </div>
                            <div className="md:col-span-2 space-y-1">
                                <label className="text-[10px] uppercase font-black text-slate-400">Address</label>
                                <input
                                    type="text"
                                    className="w-full bg-transparent border-b border-slate-200 py-1 font-bold text-slate-700 outline-none text-sm"
                                    value={companyDetails.address}
                                    onChange={(e) => setCompanyDetails({ ...companyDetails, address: e.target.value })}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* 2. Stamp & Footer */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-700">Stamp & Signature</label>
                        <button
                            onClick={() => setUseFooter(!useFooter)}
                            className={`w-10 h-5 rounded-full transition-colors relative ${useFooter ? 'bg-green-500' : 'bg-slate-300'}`}
                        >
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${useFooter ? 'left-5.5' : 'left-0.5'}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center min-h-[120px]">
                            {footerImage ? (
                                <div className="relative group">
                                    <img src={footerImage} alt="Stamp" style={{ transform: `scale(${stampScale})` }} className="max-h-20 rounded transition-transform" />
                                    <button
                                        onClick={() => setFooterImage(null)}
                                        className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400">Stamp/Seal</p>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-black text-slate-400">Stamp Scaling</label>
                                <select
                                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                                    value={stampScale}
                                    onChange={(e) => setStampScale(Number(e.target.value))}
                                >
                                    <option value={0.5}>Small (0.5x)</option>
                                    <option value={0.75}>Compact (0.75x)</option>
                                    <option value={1.0}>Normal (1.0x)</option>
                                    <option value={1.25}>Medium (1.25x)</option>
                                    <option value={1.5}>Large (1.5x)</option>
                                    <option value={2.0}>Double (2.0x)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="pt-6 flex justify-end gap-3 border-t">
                    <button onClick={onClose} className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition-all">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-blue-100 transition-all disabled:opacity-50"
                    >
                        {loading && <UploadCloud size={18} className="animate-spin" />}
                        <Check size={18} />
                        Save Settings
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default InvoiceSettingsModal;
