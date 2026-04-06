import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, UploadCloud, Trash2, Check, FileImage, Layers, Stamp, PenTool, Loader2, Type, Plus } from 'lucide-react';
import { collection, addDoc, deleteDoc, doc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from './firebase';
import { resolveStoredImages } from './storageAsset';
import Modal from './components/Modal';

const ImageStorageModal = ({ isOpen, onClose, user, dataOwnerId }) => {
    const [activeSection, setActiveSection] = useState('headers');
    const [images, setImages] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [newHeading, setNewHeading] = useState('');

    const targetUid = dataOwnerId || user?.uid;

    useEffect(() => {
        if (!isOpen || !targetUid) return;

        setLoading(true);
        const q = query(collection(db, 'company_images'), where('userId', '==', targetUid));
        const unsub = onSnapshot(q, async (snap) => {
            const data = await resolveStoredImages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setImages(data);
            setLoading(false);
        });

        return () => unsub();
    }, [isOpen, targetUid]);

    const handleFileUpload = async (e, category) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation for image files
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file (PNG, JPG, etc.)');
            return;
        }

        setUploading(true);
        try {
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
            const storagePath = `company_images/${targetUid}/${category}/${fileName}`;
            const storageRef = ref(storage, storagePath);

            // Upload to Firebase Storage
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            // Save Metadata to Firestore
            await addDoc(collection(db, 'company_images'), {
                userId: targetUid,
                category: category,
                name: file.name,
                url: downloadURL,
                storagePath: storagePath,
                createdAt: serverTimestamp(),
                createdBy: user?.uid
            });

        } catch (err) {
            console.error(err);
            alert('Failed to upload image: ' + err.message);
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (image) => {
        if (!window.confirm('Are you sure you want to delete this image?')) return;

        try {
            // Delete from Firestore
            await deleteDoc(doc(db, 'company_images', image.id));

            // Delete from Storage
            const storageRef = ref(storage, image.storagePath);
            await deleteObject(storageRef).catch(err => console.warn('Storage file already deleted or missing:', err));

        } catch (err) {
            console.error(err);
            alert('Failed to delete image');
        }
    };

    const handleAddHeading = async () => {
        if (!newHeading.trim()) return;
        setUploading(true);
        try {
            await addDoc(collection(db, 'company_images'), {
                userId: targetUid,
                category: 'headings',
                name: newHeading.trim(),
                createdAt: serverTimestamp(),
                createdBy: user?.uid
            });
            setNewHeading('');
        } catch (err) {
            console.error(err);
            alert('Failed to add heading');
        } finally {
            setUploading(false);
        }
    };

    if (!isOpen) return null;

    const sections = [
        { id: 'headers', title: 'Headers', icon: <Layers size={18} />, color: 'blue' },
        { id: 'headings', title: 'Headings', icon: <Type size={18} />, color: 'purple' },
        { id: 'stumps', title: 'Stumps', icon: <Stamp size={18} />, color: 'orange' },
        { id: 'signatures', title: 'Signatures', icon: <PenTool size={18} />, color: 'teal' },
    ];

    const currentImages = images.filter(img => img.category === activeSection);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Image Files Storage"
            maxWidth="max-w-4xl"
        >
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden -m-4 h-[70vh]">
                {/* Sidebar Tabs */}
                <div className="w-full md:w-48 bg-slate-50 border-r p-4 space-y-2 flex md:block overflow-x-auto md:overflow-x-visible">
                    {sections.map(s => (
                        <button
                            key={s.id}
                            onClick={() => setActiveSection(s.id)}
                            className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeSection === s.id
                                ? `bg-indigo-600 text-white shadow-lg shadow-indigo-200`
                                : 'text-slate-600 hover:bg-white hover:shadow-sm'
                                }`}
                        >
                            {s.icon}
                            {s.title}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col bg-white">
                    {/* Mobile Tabs */}
                    <div className="md:hidden flex p-2 bg-slate-100 gap-1 overflow-x-auto">
                        {sections.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${activeSection === s.id ? 'bg-indigo-600 text-white' : 'text-slate-600 bg-white shadow-sm'
                                    }`}
                            >
                                {s.icon}
                                {s.title}
                            </button>
                        ))}
                    </div>

                    {/* Top Action Bar */}
                    <div className="p-4 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700 capitalize">{activeSection} Library</span>
                            <span className="text-[10px] text-slate-400">{currentImages.length} {activeSection === 'headings' ? 'Items' : 'Files'} found</span>
                        </div>

                        {activeSection === 'headings' ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Add new heading (e.g. Tax Invoice)"
                                    className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
                                    value={newHeading}
                                    onChange={(e) => setNewHeading(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddHeading()}
                                />
                                <button
                                    onClick={handleAddHeading}
                                    disabled={uploading || !newHeading.trim()}
                                    className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                                    Add
                                </button>
                            </div>
                        ) : (
                            <label className={`cursor-pointer flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm ${uploading ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md'
                                }`}>
                                {uploading ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
                                {uploading ? 'Uploading...' : `Upload to ${activeSection}`}
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={uploading}
                                    onChange={(e) => handleFileUpload(e, activeSection)}
                                />
                            </label>
                        )}
                    </div>

                    {/* Image Grid */}
                    <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
                        {loading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 size={32} className="text-indigo-600 animate-spin" />
                                    <span className="text-sm font-medium text-slate-500">Loading library...</span>
                                </div>
                            </div>
                        ) : currentImages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                                    {sections.find(s => s.id === activeSection).icon}
                                </div>
                                <h3 className="font-bold text-slate-700 mb-1">No {activeSection} found</h3>
                                <p className="text-xs text-slate-400 max-w-[200px]">Upload {activeSection} to use them in your vouchers and documents.</p>
                            </div>
                        ) : activeSection === 'headings' ? (
                            <div className="space-y-3">
                                {currentImages.map((heading) => (
                                    <div key={heading.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-all">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                                <Type size={18} />
                                            </div>
                                            <span className="font-bold text-slate-700">{heading.name}</span>
                                        </div>
                                        <button
                                            onClick={() => handleDelete(heading)}
                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                                {currentImages.map((img) => (
                                    <div key={img.id} className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300">
                                        <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden flex items-center justify-center p-2">
                                            <img
                                                src={img.url}
                                                alt={img.name}
                                                className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500"
                                            />
                                            <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
                                                <a
                                                    href={img.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-2.5 bg-white text-slate-800 rounded-full hover:bg-indigo-600 hover:text-white transition-all shadow-lg"
                                                >
                                                    <FileImage size={18} />
                                                </a>
                                                <button
                                                    onClick={() => handleDelete(img)}
                                                    className="p-2.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-all shadow-lg"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-3 border-t bg-white">
                                            <div className="text-[11px] font-black text-slate-700 truncate" title={img.name}>
                                                {img.name}
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-0.5 flex items-center justify-between">
                                                <span>{img.createdAt ? new Date(img.createdAt.seconds * 1000).toLocaleDateString() : 'Uploading...'}</span>
                                                <Check size={10} className="text-green-500" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="p-4 border-t bg-white flex justify-end gap-3 shrink-0">
                <button onClick={onClose} className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs rounded-xl transition-all">
                    Close Storage
                </button>
            </div>
        </Modal>
    );
};

export default ImageStorageModal;
