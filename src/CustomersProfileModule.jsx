import React, { useState, useEffect } from 'react';
import {
    User, Search, PlusCircle, Edit, Trash2, Phone, Mail, MapPin,
    Globe, Users, FileText, CheckCircle, X, Smartphone, Home,
    MessageCircle, Link as LinkIcon, Briefcase, CreditCard, CalendarDays
} from 'lucide-react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

const CustomersProfileModule = ({ user, dataOwnerId }) => {
    const [view, setView] = useState('list'); // 'list', 'add', 'edit'
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [formData, setFormData] = useState(null);
    const [saving, setSaving] = useState(false);

    const targetUid = dataOwnerId || user?.uid;

    useEffect(() => {
        if (!targetUid) return;
        setLoading(true);
        const q = query(collection(db, 'parties'), where('userId', '==', targetUid));
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            setCustomers(data);
            setLoading(false);
        });
        return () => unsub();
    }, [targetUid]);

    const getInitialForm = () => ({
        type: 'customer',
        name: '',
        companyName: '',
        email: '',
        mobileNumber: '',
        homeTel: '',
        whatsappNumber: '',
        address: '', // Local Address
        homeCountryAddress: '',
        website: '',
        idNumber: '',
        idExpiry: '',
        passportNumber: '',
        passportExpiry: '',
        partners: [{ name: '', number: '' }],
        additionalNumbers: [''],
        notes: '',
        openingBalance: 0,
        creditPeriod: 0,
        trn: '', // <--- NEW
        banks: [] // <--- NEW: [{ bankTitle, bankName, branchName, iban, accNumber, swiftCode, bankAddress }]
    });

    const handleCreateNew = () => {
        setFormData(getInitialForm());
        setView('add');
    };

    const handleEdit = (customer) => {
        setFormData({
            ...getInitialForm(),
            ...customer,
            partners: customer.partners?.length ? customer.partners : [{ name: '', number: '' }],
            additionalNumbers: customer.additionalNumbers?.length ? customer.additionalNumbers : ['']
        });
        setView('edit');
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this customer profile? This action will not remove their invoices but will remove their profile.")) return;
        try {
            await deleteDoc(doc(db, 'parties', id));
        } catch (err) {
            console.error(err);
            alert("Failed to delete customer");
        }
    };

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleArrayChange = (arrayName, index, field, value) => {
        setFormData(prev => {
            const newArr = [...prev[arrayName]];
            if (field === null) {
                // simple string array (additionalNumbers)
                newArr[index] = value;
            } else {
                // object array (partners)
                newArr[index] = { ...newArr[index], [field]: value };
            }
            return { ...prev, [arrayName]: newArr };
        });
    };

    const addArrayItem = (arrayName, newItem) => {
        setFormData(prev => ({ ...prev, [arrayName]: [...prev[arrayName], newItem] }));
    };

    const removeArrayItem = (arrayName, index) => {
        setFormData(prev => ({ ...prev, [arrayName]: prev[arrayName].filter((_, i) => i !== index) }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) return alert("Name is required");

        setSaving(true);
        // Clean up empty array items
        const cleanData = {
            ...formData,
            partners: formData.partners.filter(p => p.name.trim() || p.number.trim()),
            additionalNumbers: formData.additionalNumbers.filter(n => n.trim()),
            banks: (formData.banks || []).filter(b => b.bankName?.trim() || b.accNumber?.trim()),
            updatedAt: serverTimestamp()
        };

        try {
            if (view === 'add') {
                cleanData.userId = targetUid;
                cleanData.createdAt = serverTimestamp();
                await addDoc(collection(db, 'parties'), cleanData);
            } else {
                const docRef = doc(db, 'parties', formData.id);
                delete cleanData.id;
                await updateDoc(docRef, cleanData);
            }
            setView('list');
        } catch (err) {
            console.error(err);
            alert("Failed to save customer profile: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="h-64 flex items-center justify-center text-white/50">Loading Customer Profiles...</div>;
    }

    if (view === 'add' || view === 'edit') {
        return (
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-in fade-in zoom-in-95 duration-300 relative">
                <button
                    onClick={() => setView('list')}
                    className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-all"
                >
                    <X size={20} />
                </button>
                <h3 className="text-xl font-bold mb-6 text-indigo-400 flex items-center gap-2">
                    {view === 'add' ? <PlusCircle /> : <Edit />}
                    {view === 'add' ? 'Add New Customer Profile' : 'Edit Customer Profile'}
                </h3>

                <form onSubmit={handleSave} className="space-y-8">
                    {/* Basic Information */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <h4 className="text-sm font-black text-white/60 uppercase tracking-widest border-b border-white/10 pb-2 mb-4 flex items-center gap-2">
                            <User size={16} /> Basic Details
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Full Name *</label>
                                <input required type="text" value={formData.name} onChange={e => handleChange('name', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Primary Contact Name" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Company Name</label>
                                <input type="text" value={formData.companyName} onChange={e => handleChange('companyName', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Business Name" />
                            </div>
                        </div>
                    </div>

                    {/* Contact Information */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <h4 className="text-sm font-black text-white/60 uppercase tracking-widest border-b border-white/10 pb-2 mb-4 flex items-center gap-2">
                            <Phone size={16} /> Contact Numbers
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><Smartphone size={12} /> Mobile Number</label>
                                <input type="text" value={formData.mobileNumber} onChange={e => handleChange('mobileNumber', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="+1 234..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><Home size={12} /> Home Tel</label>
                                <input type="text" value={formData.homeTel} onChange={e => handleChange('homeTel', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Landline..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><MessageCircle size={12} /> WhatsApp Number</label>
                                <input type="text" value={formData.whatsappNumber} onChange={e => handleChange('whatsappNumber', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="WhatsApp..." />
                            </div>
                        </div>

                        {/* Additional Numbers */}
                        <div className="pt-2">
                            <label className="text-[10px] uppercase font-bold text-white/40 block mb-2">Additional Phone Numbers</label>
                            {formData.additionalNumbers.map((num, i) => (
                                <div key={i} className="flex items-center gap-2 mb-2">
                                    <input type="text" value={num} onChange={e => handleArrayChange('additionalNumbers', i, null, e.target.value)}
                                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Any other number..." />
                                    {formData.additionalNumbers.length > 1 && (
                                        <button type="button" onClick={() => removeArrayItem('additionalNumbers', i)} className="p-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20"><Trash2 size={16} /></button>
                                    )}
                                    {i === formData.additionalNumbers.length - 1 && (
                                        <button type="button" onClick={() => addArrayItem('additionalNumbers', '')} className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20"><PlusCircle size={16} /></button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Address & Online */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <h4 className="text-sm font-black text-white/60 uppercase tracking-widest border-b border-white/10 pb-2 mb-4 flex items-center gap-2">
                            <MapPin size={16} /> Location & Web
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Current/Local Address</label>
                                <textarea value={formData.address || ''} onChange={e => handleChange('address', e.target.value)} rows="3"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none" placeholder="Full local address..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Home Country Address</label>
                                <textarea value={formData.homeCountryAddress || ''} onChange={e => handleChange('homeCountryAddress', e.target.value)} rows="3"
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none" placeholder="Address in home country..." />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><Mail size={12} /> Email Address</label>
                                <input type="email" value={formData.email} onChange={e => handleChange('email', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Email..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><Globe size={12} /> Website</label>
                                <input type="url" value={formData.website} onChange={e => handleChange('website', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="https://..." />
                            </div>
                        </div>
                    </div>

                    {/* Documentation */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <h4 className="text-sm font-black text-white/60 uppercase tracking-widest border-b border-white/10 pb-2 mb-4 flex items-center gap-2">
                            <CreditCard size={16} /> Official Documents
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><CreditCard size={12} /> ID Number</label>
                                <input type="text" value={formData.idNumber || ''} onChange={e => handleChange('idNumber', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="National ID / Emirates ID..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><CalendarDays size={12} /> ID Expiry Date</label>
                                <input type="date" value={formData.idExpiry || ''} onChange={e => handleChange('idExpiry', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><FileText size={12} /> TRN Number (VAT)</label>
                                <input type="text" value={formData.trn || ''} onChange={e => handleChange('trn', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-bold text-indigo-200" placeholder="100xxxxxxxxx..." />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><FileText size={12} /> Passport Number</label>
                                <input type="text" value={formData.passportNumber || ''} onChange={e => handleChange('passportNumber', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Passport No..." />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><CalendarDays size={12} /> Passport Expiry Date</label>
                                <input type="date" value={formData.passportExpiry || ''} onChange={e => handleChange('passportExpiry', e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" />
                            </div>
                        </div>
                    </div>

                    {/* Partners Information */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <h4 className="text-sm font-black text-white/60 uppercase tracking-widest border-b border-white/10 pb-2 mb-4 flex items-center gap-2">
                            <Users size={16} /> Partner Details
                        </h4>
                        {formData.partners.map((partner, i) => (
                            <div key={i} className="flex flex-col md:flex-row items-end gap-2 mb-2 p-3 bg-white/5 rounded-lg border border-white/5">
                                <div className="flex-1 w-full">
                                    <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Partner Name</label>
                                    <input type="text" value={partner.name} onChange={e => handleArrayChange('partners', i, 'name', e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Name..." />
                                </div>
                                <div className="flex-1 w-full">
                                    <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Partner Number</label>
                                    <input type="text" value={partner.number} onChange={e => handleArrayChange('partners', i, 'number', e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Number..." />
                                </div>
                                <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
                                    {formData.partners.length > 1 && (
                                        <button type="button" onClick={() => removeArrayItem('partners', i)} className="flex-1 md:flex-none p-2.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 flex justify-center items-center"><Trash2 size={16} /></button>
                                    )}
                                    {i === formData.partners.length - 1 && (
                                        <button type="button" onClick={() => addArrayItem('partners', { name: '', number: '' })} className="flex-1 md:flex-none p-2.5 bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20 flex justify-center items-center"><PlusCircle size={16} /></button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Bank Details Section */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5 space-y-4">
                        <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-4">
                            <h4 className="text-sm font-black text-white/60 uppercase tracking-widest flex items-center gap-2">
                                <CreditCard size={16} /> Company API / Bank Details
                            </h4>
                            <button 
                                type="button" 
                                onClick={() => addArrayItem('banks', { bankTitle: '', bankName: '', branchName: '', iban: '', accNumber: '', swiftCode: '', bankAddress: '' })}
                                className="text-[10px] font-black bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full uppercase hover:bg-indigo-500/20 transition-all border border-indigo-500/20"
                            >
                                + Add Bank Account
                            </button>
                        </div>
                        
                        {(formData.banks || []).map((bank, i) => (
                            <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/10 relative group mb-4">
                                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black shadow-lg">
                                    {i + 1}
                                </div>
                                <button type="button" onClick={() => removeArrayItem('banks', i)} className="absolute top-4 right-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 size={16} />
                                </button>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Bank Title</label>
                                        <input type="text" value={bank.bankTitle || ''} onChange={e => handleArrayChange('banks', i, 'bankTitle', e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Primary A/C..." />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Bank Name</label>
                                        <input type="text" value={bank.bankName || ''} onChange={e => handleArrayChange('banks', i, 'bankName', e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Bank Name..." />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">IBAN / Swift</label>
                                        <input type="text" value={bank.iban || ''} onChange={e => handleArrayChange('banks', i, 'iban', e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono" placeholder="IBAN..." />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Account Number</label>
                                        <input type="text" value={bank.accNumber || ''} onChange={e => handleArrayChange('banks', i, 'accNumber', e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono" placeholder="Acc No..." />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1">Bank Address / Branch</label>
                                        <input type="text" value={bank.bankAddress || ''} onChange={e => handleArrayChange('banks', i, 'bankAddress', e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="Branch location..." />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Notes */}
                    <div className="bg-black/20 p-5 rounded-lg border border-white/5">
                        <label className="text-[10px] uppercase font-bold text-white/40 block mb-1 flex items-center gap-1"><FileText size={12} /> Profile Notes</label>
                        <textarea value={formData.notes || ''} onChange={e => handleChange('notes', e.target.value)} rows="3"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none" placeholder="Any internal notes regarding this customer..." />
                    </div>

                    {/* Submit Button */}
                    <div className="pt-4 flex justify-end">
                        <button disabled={saving} type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 px-10 rounded-xl shadow-lg active:scale-95 transition-all uppercase tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            {saving ? 'Saving...' : <><CheckCircle size={18} /> {view === 'add' ? 'Save New Customer' : 'Update Profile'}</>}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    const filteredCustomers = customers.filter(c =>
        (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.companyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.mobileNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1 w-full relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/40" size={20} />
                    <input
                        type="text"
                        placeholder="Search customers by name, company, or mobile..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-4 text-white focus:ring-2 focus:ring-indigo-500 outline-none backdrop-blur-sm transition-all shadow-lg"
                    />
                </div>
                <button
                    onClick={handleCreateNew}
                    className="w-full md:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg active:scale-95 transition-all shrink-0"
                >
                    <PlusCircle size={20} /> Add New Customer
                </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/10 border-b border-white/10">
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">Customer Name</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">Mobile Number</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">WhatsApp</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">Email</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300">Company Name</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-indigo-300 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredCustomers.map(customer => (
                                <tr
                                    key={customer.id}
                                    onClick={() => handleEdit(customer)}
                                    className="group hover:bg-white/10 transition-all cursor-pointer border-b border-white/5 last:border-0"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-black shadow-lg shrink-0">
                                                {(customer.name || "?")[0].toUpperCase()}
                                            </div>
                                            <span className="font-bold text-sm text-white group-hover:text-indigo-300 transition-colors uppercase tracking-tight">{customer.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-2 text-xs text-white/70">
                                            <Smartphone size={12} className="text-white/30" />
                                            {customer.mobileNumber || <span className="text-white/20">---</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-2 text-xs text-white/70">
                                            <MessageCircle size={12} className="text-green-400/50" />
                                            {customer.whatsappNumber || <span className="text-white/20">---</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-white/60">
                                        {customer.email ? (
                                            <div className="flex items-center gap-2 max-w-[150px] truncate" title={customer.email}>
                                                <Mail size={12} className="text-white/30" /> {customer.email}
                                            </div>
                                        ) : <span className="text-white/20">---</span>}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {customer.companyName ? (
                                            <div className="flex items-center gap-2 text-xs font-medium text-indigo-300/80 uppercase">
                                                <Briefcase size={12} className="text-indigo-400/40" /> {customer.companyName}
                                            </div>
                                        ) : <span className="text-white/20">---</span>}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleEdit(customer); }}
                                                className="p-1.5 bg-indigo-500/20 hover:bg-indigo-500 rounded text-indigo-300 hover:text-white transition-all shadow-sm"
                                            >
                                                <Edit size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDelete(customer.id); }}
                                                className="p-1.5 bg-red-500/20 hover:bg-red-500 rounded text-red-300 hover:text-white transition-all shadow-sm"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filteredCustomers.length === 0 && (
                    <div className="py-24 text-center flex flex-col items-center justify-center opacity-40">
                        <Users size={64} className="mb-4 text-indigo-400" />
                        <h3 className="text-xl font-bold text-white mb-2">No Customers Found</h3>
                        <p className="text-white/60 max-w-sm px-6">You haven't added any customer profiles yet, or your search didn't match any existing records.</p>
                    </div>
                )}
            </div>

        </div>
    );
};

export default CustomersProfileModule;
