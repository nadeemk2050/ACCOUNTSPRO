import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
    X, FileText, Printer, Download, CheckCircle2, ChevronRight, 
    Settings, Image as ImageIcon, Signature, Stamp, Zap, Mail,
    Eye, FileDown, Layers, Briefcase, Building2, AlertTriangle
} from 'lucide-react';
import { 
    generateInvoicePDF, 
    generatePackingListPDF, 
    generateBillOfExchangePDF, 
    generateBankApplicationPDF, 
    downloadInvoiceExcel,
    generateAccountingVoucherPDF,
    generateSelectedDocsPDF 
} from './invoiceGenerator';
import { db } from './firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { resolveStoredImages } from './storageAsset';

const DocumentGeneratorV2 = ({ 
    isOpen, 
    onClose, 
    data, // Full transaction data
    type = 'sales', // 'sales' | 'purchase' | 'payment' | 'receipt'
    parties = [],
    products = [],
    accounts = [],
    companyProfile = {},
    dataOwnerId = null,
    user = null,
    zIndex = 10000
}) => {
    // ── State ──────────────────────────────────────────────────────────────
    const [images, setImages] = useState([]);
    const [hbzOptions, setHbzOptions] = useState({
        releaseAgainstPayment: true,
        releaseAgainstAcceptance: false,
        releaseAgainstAvalised: false,
        releaseAgainstOthers: false,
        releaseAgainstOthersText: '',
        chargesOnDrawee: true,
        protestNonPayment: false,
        doNotProtest: true,
        doNotWaiveCharges: true,
        ourChargesText: '',
        draftSight: true,
        draftUsance: false,
        blOriginal: true,
        blNonNegotiable: false,
    });

    const isFinance = ['payment', 'receipt'].includes(type);
    
    // Default document configs
    const docConfigs = companyProfile?.rules?.docConfigs || [
        { id: 'invoice', templateId: 'invoice', name: type === 'purchase' ? 'Purchase Bill' : 'Tax Invoice', enabled: true },
        { id: 'packing_list', templateId: 'packing_list', name: 'Packing List', enabled: !isFinance },
        { id: 'bill_of_exchange', templateId: 'bill_of_exchange', name: 'Bill of Exchange', enabled: !isFinance },
        { id: 'bank_application', templateId: 'bank_application', name: 'Bank Letter', enabled: !isFinance }
    ];

    const [printOptions, setPrintOptions] = useState({
        generateMode: 'single', // 'single' | 'selected'
        documentType: isFinance ? 'voucher' : 'invoice',
        selectedHeading: '',
        attachHeader: true,
        headerId: '',
        attachStamp: true,
        stampId: '',
        attachSignature: true,
        signatureId: '',
        stampScale: 1.0,
        selectedDocs: isFinance ? [] : ['invoice']
    });

    // ── Load Images & Settings ─────────────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const targetUid = dataOwnerId || user?.uid;
        if (!targetUid) return;

        const q = query(collection(db, 'company_images'), where('userId', '==', targetUid));
        const unsub = onSnapshot(q, async (snap) => {
            const dataImg = await resolveStoredImages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setImages(dataImg);

            // Auto-select defaults
            setPrintOptions(prev => ({
                ...prev,
                headerId: prev.headerId || dataImg.find(img => img.category === 'headers')?.id || '',
                stampId: prev.stampId || dataImg.find(img => img.category === 'stumps' || img.category === 'stamps')?.id || '',
                signatureId: prev.signatureId || dataImg.find(img => img.category === 'signatures')?.id || '',
                selectedHeading: prev.selectedHeading || (isFinance ? (type === 'payment' ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER') : (type === 'purchase' ? 'PURCHASE VOUCHER' : 'TAX INVOICE'))
            }));
        });

        return () => unsub();
    }, [isOpen, dataOwnerId, user, type]);

    if (!isOpen) return null;

    // ── Handlers ───────────────────────────────────────────────────────────
    const preparePrintData = (docTypeOverride = null) => {
        const docType = docTypeOverride || printOptions.documentType;
        const selectedDoc = docConfigs.find(d => d.templateId === docType);
        
        return {
            ...data,
            type: data.type || type,
            invoiceNo: data.refNo || 'DRAFT',
            partyName: data.partyName || parties.find(p => p.id === data.partyId)?.name || 'Unknown',
            partyAddress: parties.find(p => p.id === data.partyId)?.address || '',
            partyTrn: parties.find(p => p.id === data.partyId)?.trn || '',
            items: (data.items || []).map(i => ({
                ...i,
                productName: products.find(p => p.id === i.productId)?.name || 'Unknown'
            })),
            seller: {
                name: companyProfile?.name || '',
                address: companyProfile?.address || '',
                trn: companyProfile?.trn || '',
                email: companyProfile?.email || '',
                phone: companyProfile?.phone || ''
            },
            printOptions: {
                ...printOptions,
                documentType: docType,
                selectedHeading: (docTypeOverride ? (selectedDoc?.name || docType).toUpperCase() : printOptions.selectedHeading),
                headerImage: printOptions.attachHeader ? images.find(img => img.id === printOptions.headerId)?.url : null,
                stampImage: printOptions.attachStamp ? images.find(img => img.id === printOptions.stampId)?.url : null,
                signatureImage: printOptions.attachSignature ? images.find(img => img.id === printOptions.signatureId)?.url : null,
            },
            hbzOptions,
            // Finance specific
            sourceName: accounts.find(a => a.id === data.sourceId)?.name || '---',
            targetName: accounts.find(a => a.id === data.targetId)?.name || '---',
            ...data
        };
    };

    const handlePreview = async () => {
        if (printOptions.generateMode === 'selected') {
            const rawData = preparePrintData();
            await generateSelectedDocsPDF({
                ...rawData,
                printOptions: { ...rawData.printOptions, selectedDocs: printOptions.selectedDocs }
            }, 'preview');
        } else {
            const rawData = preparePrintData();
            if (isFinance) {
                generateAccountingVoucherPDF(rawData, 'preview');
            } else {
                if (printOptions.documentType === 'packing_list') generatePackingListPDF(rawData, 'preview');
                else if (printOptions.documentType === 'bill_of_exchange') generateBillOfExchangePDF(rawData, 'preview');
                else if (printOptions.documentType === 'bank_application') generateBankApplicationPDF(rawData, 'preview');
                else generateInvoicePDF(rawData, 'preview');
            }
        }
    };

    const handleDownload = async () => {
        const rawData = preparePrintData();
        if (isFinance) {
            generateAccountingVoucherPDF(rawData, 'download');
        } else {
            if (printOptions.documentType === 'packing_list') generatePackingListPDF(rawData, 'download');
            else if (printOptions.documentType === 'bill_of_exchange') generateBillOfExchangePDF(rawData, 'download');
            else if (printOptions.documentType === 'bank_application') generateBankApplicationPDF(rawData, 'download');
            else generateInvoicePDF(rawData, 'download');
        }
    };

    const handleExcel = () => {
        downloadInvoiceExcel(preparePrintData());
    };

    const toggleDoc = (id) => {
        setPrintOptions(prev => ({
            ...prev,
            selectedDocs: prev.selectedDocs.includes(id) 
                ? prev.selectedDocs.filter(d => d !== id)
                : [...prev.selectedDocs, id]
        }));
    };

    // ── Render Helpers ─────────────────────────────────────────────────────
    const ConfigBox = ({ title, icon: Icon, children }) => (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
            <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center gap-2">
                <Icon size={14} className="text-blue-600" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{title}</span>
            </div>
            <div className="p-4">{children}</div>
        </div>
    );

    return createPortal(
        <div 
            className="fixed inset-0 bg-[#0a1628]/80 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-300"
            style={{ zIndex }}
            onClick={onClose}
        >
            <div 
                className="bg-[#f8fafc] w-full max-w-4xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-white px-8 py-5 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                            <Zap size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-800 tracking-tight">Generate Documents</h2>
                            <p className="text-xs text-slate-500 font-medium">Configure and export your professional business documents</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-all">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* Left Panel: Options */}
                    <div className="w-2/3 p-8 overflow-y-auto custom-scrollbar space-y-6 bg-slate-50/50">
                        {/* 1. Mode Selection */}
                        <div className="grid grid-cols-2 gap-4">
                            <button 
                                onClick={() => setPrintOptions(p => ({ ...p, generateMode: 'single' }))}
                                className={`p-4 rounded-2xl border-2 transition-all text-left ${printOptions.generateMode === 'single' ? 'border-blue-600 bg-blue-50/50 ring-4 ring-blue-50' : 'border-white bg-white hover:border-slate-200 shadow-sm'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className={`p-2 rounded-lg ${printOptions.generateMode === 'single' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                        <FileText size={18} />
                                    </div>
                                    {printOptions.generateMode === 'single' && <CheckCircle2 size={18} className="text-blue-600" />}
                                </div>
                                <div className="font-black text-slate-800 text-sm">Single Document</div>
                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Preview or print one specific template</div>
                            </button>
                            <button 
                                onClick={() => setPrintOptions(p => ({ ...p, generateMode: 'selected' }))}
                                className={`p-4 rounded-2xl border-2 transition-all text-left ${printOptions.generateMode === 'selected' ? 'border-indigo-600 bg-indigo-50/50 ring-4 ring-indigo-50' : 'border-white bg-white hover:border-slate-200 shadow-sm'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className={`p-2 rounded-lg ${printOptions.generateMode === 'selected' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                        <Layers size={18} />
                                    </div>
                                    {printOptions.generateMode === 'selected' && <CheckCircle2 size={18} className="text-indigo-600" />}
                                </div>
                                <div className="font-black text-slate-800 text-sm">Bundle Export</div>
                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Combine multiple docs into one PDF</div>
                            </button>
                        </div>

                        {/* 2. Document Selection */}
                        <ConfigBox title={printOptions.generateMode === 'single' ? "Select Template" : "Select Documents for Bundle"} icon={FileText}>
                            <div className="flex flex-wrap gap-2">
                                {docConfigs.filter(d => isFinance ? (d.templateId === 'voucher') : d.enabled).map(doc => {
                                    const isSelected = printOptions.generateMode === 'single' 
                                        ? printOptions.documentType === doc.templateId
                                        : printOptions.selectedDocs.includes(doc.templateId);
                                    
                                    return (
                                        <button
                                            key={doc.id}
                                            onClick={() => {
                                                if (printOptions.generateMode === 'single') {
                                                    setPrintOptions(p => ({ ...p, documentType: doc.templateId, selectedHeading: doc.name.toUpperCase() }));
                                                } else {
                                                    toggleDoc(doc.templateId);
                                                }
                                            }}
                                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all border-2 ${isSelected ? 'bg-slate-800 text-white border-slate-800 shadow-lg shadow-slate-200' : 'bg-slate-100 text-slate-500 border-transparent hover:bg-slate-200'}`}
                                        >
                                            {doc.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </ConfigBox>

                        {/* 3. Heading & Branding */}
                        <div className="grid grid-cols-2 gap-4">
                            <ConfigBox title="Document Heading" icon={Settings}>
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                                    placeholder="e.g. TAX INVOICE"
                                    value={printOptions.selectedHeading}
                                    onChange={e => setPrintOptions(p => ({ ...p, selectedHeading: e.target.value.toUpperCase() }))}
                                />
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {['TAX INVOICE', 'INVOICE', 'PROFORMA', 'CASH MEMO'].map(h => (
                                        <button key={h} className="text-[9px] font-black text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded" onClick={() => setPrintOptions(p => ({ ...p, selectedHeading: h }))}>
                                            {h}
                                        </button>
                                    ))}
                                </div>
                            </ConfigBox>

                            <ConfigBox title="Attachments" icon={ImageIcon}>
                                <div className="space-y-2">
                                    <label className="flex items-center justify-between group cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-1 rounded ${printOptions.attachHeader ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                                                <ImageIcon size={12} />
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-600">Company Header</span>
                                        </div>
                                        <input type="checkbox" checked={printOptions.attachHeader} onChange={e => setPrintOptions(p => ({...p, attachHeader: e.target.checked}))} className="w-3 h-3 rounded text-blue-600" />
                                    </label>
                                    <label className="flex items-center justify-between group cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-1 rounded ${printOptions.attachStamp ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                                                <Stamp size={12} />
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-600">Official Stamp</span>
                                        </div>
                                        <input type="checkbox" checked={printOptions.attachStamp} onChange={e => setPrintOptions(p => ({...p, attachStamp: e.target.checked}))} className="w-3 h-3 rounded text-blue-600" />
                                    </label>
                                    <label className="flex items-center justify-between group cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-1 rounded ${printOptions.attachSignature ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                                                <Signature size={12} />
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-600">Signature</span>
                                        </div>
                                        <input type="checkbox" checked={printOptions.attachSignature} onChange={e => setPrintOptions(p => ({...p, attachSignature: e.target.checked}))} className="w-3 h-3 rounded text-blue-600" />
                                    </label>
                                </div>
                            </ConfigBox>
                        </div>

                        {/* 4. Bank covering specific */}
                        {printOptions.documentType === 'bank_application' && printOptions.generateMode === 'single' && (
                            <ConfigBox title="HBZ Covering Letter Details" icon={Building2}>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <div>
                                            <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Release Documents Against</div>
                                            <div className="space-y-1.5">
                                                {[
                                                    { id: 'releaseAgainstPayment', label: 'Payment' },
                                                    { id: 'releaseAgainstAcceptance', label: 'Acceptance' },
                                                    { id: 'releaseAgainstAvalised', label: 'Avalised' },
                                                ].map(opt => (
                                                    <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                                                        <input type="checkbox" checked={hbzOptions[opt.id]} onChange={e => setHbzOptions(p => ({...p, [opt.id]: e.target.checked}))} className="rounded text-blue-600" />
                                                        <span className="text-[11px] font-bold text-slate-700">{opt.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Draft Type</div>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={hbzOptions.draftSight} onChange={e => setHbzOptions(p => ({ ...p, draftSight: e.target.checked, draftUsance: !e.target.checked }))} />
                                                    <span className="text-[11px] font-bold text-slate-700">Sight</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={hbzOptions.draftUsance} onChange={e => setHbzOptions(p => ({ ...p, draftUsance: e.target.checked, draftSight: !e.target.checked }))} />
                                                    <span className="text-[11px] font-bold text-slate-700">Usance</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={hbzOptions.chargesOnDrawee} onChange={e => setHbzOptions(p => ({...p, chargesOnDrawee: e.target.checked}))} />
                                                <span className="text-[11px] font-bold text-slate-700">All charges on Drawee</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={hbzOptions.doNotProtest} onChange={e => setHbzOptions(p => ({...p, doNotProtest: e.target.checked}))} />
                                                <span className="text-[11px] font-bold text-slate-700">Do Not Protest</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={hbzOptions.doNotWaiveCharges} onChange={e => setHbzOptions(p => ({...p, doNotWaiveCharges: e.target.checked}))} />
                                                <span className="text-[11px] font-bold text-slate-700">Do Not Waive Charges</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </ConfigBox>
                        )}
                    </div>

                    {/* Right Panel: Summary & Actions */}
                    <div className="w-1/3 bg-white border-l border-slate-200 flex flex-col overflow-y-auto custom-scrollbar">
                        <div className="p-8 flex-1 space-y-6">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2">Generation Summary</h3>
                            
                            <div className="space-y-4">
                                <div className="bg-slate-50 p-4 rounded-2xl flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-400">
                                        <Building2 size={20} />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Client / Party</div>
                                        <div className="text-xs font-black text-slate-700 truncate">{data.partyName || parties.find(p => p.id === data.partyId)?.name || 'N/A'}</div>
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-4 rounded-2xl flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-400">
                                        <FileText size={20} />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <div className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Reference No</div>
                                        <div className="text-xs font-black text-slate-700 truncate">{data.refNo || 'N/A'}</div>
                                    </div>
                                </div>

                                <div className="bg-blue-600 p-5 rounded-2xl text-white shadow-xl shadow-blue-100">
                                    <div className="text-[8px] font-black text-blue-200 uppercase tracking-widest mb-1">Total Amount</div>
                                    <div className="text-2xl font-black">{data.currencySymbol || ''} {Number(data.grandTotalForeign || data.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    <div className="text-[9px] font-bold text-blue-100 mt-1 opacity-70">Calculated from {data.items?.length || 0} unique lines</div>
                                </div>
                            </div>

                            {printOptions.generateMode === 'selected' && (
                                <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl">
                                    <div className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                        <Layers size={10} /> Queued Documents
                                    </div>
                                    <div className="space-y-1.5">
                                        {printOptions.selectedDocs.length === 0 && <div className="text-[10px] text-indigo-400 italic">No documents selected for bundle...</div>}
                                        {printOptions.selectedDocs.map(id => (
                                            <div key={id} className="flex items-center gap-2 text-[10px] font-bold text-indigo-700">
                                                <CheckCircle2 size={12} />
                                                {(docConfigs.find(d => d.templateId === id)?.name || id).toUpperCase()}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!isFinance && type === 'sales' && (
                                <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-2.5">
                                    <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Compliance Tip</div>
                                        <p className="text-[10px] text-amber-600 font-medium leading-tight mt-1">Ensure TRN is visible and correct for tax compliance on all generated documents.</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-8 pt-0 space-y-3">
                            <button 
                                onClick={handlePreview}
                                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-slate-200 active:scale-95"
                            >
                                <Eye size={20} />
                                <span className="text-sm">Preview PDF</span>
                            </button>
                            <div className="grid grid-cols-2 gap-3">
                                <button 
                                    onClick={handleDownload}
                                    className="bg-white border-2 border-slate-100 hover:border-blue-200 hover:bg-blue-50 text-slate-700 font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 text-xs"
                                >
                                    <FileDown size={16} /> Download
                                </button>
                                <button 
                                    onClick={handleExcel}
                                    className="bg-white border-2 border-slate-100 hover:border-emerald-200 hover:bg-emerald-50 text-slate-700 font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 text-xs"
                                >
                                    <Download size={16} /> Excel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DocumentGeneratorV2;
