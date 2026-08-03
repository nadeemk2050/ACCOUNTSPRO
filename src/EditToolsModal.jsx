import React, { useState } from 'react';
import { Modal } from './components/Modal';
import { 
    FileText, Image as ImageIcon, ExternalLink, Sparkles, 
    FileSpreadsheet, ArrowRight, Shield, Layers, HelpCircle, 
    Zap, Lock, Compass 
} from 'lucide-react';

const EditToolsModal = ({ isOpen, onClose, zIndex = 200 }) => {
    const [activeTab, setActiveTab] = useState('pdf_image');

    const handleOpenWebsite = () => {
        window.open('https://www.aitoolsgent.com', '_blank', 'noopener,noreferrer');
    };

    const handleTabClick = (tab) => {
        setActiveTab(tab);
        if (tab === 'pdf_image') {
            // Also trigger opening the website directly as requested
            handleOpenWebsite();
        }
    };

    // Simulated list of tools available on aitoolsgent.com
    const pdfTools = [
        { name: 'Compress PDF', desc: 'Reduce the file size of your PDF while maintaining quality.', icon: FileText, color: 'from-red-500 to-rose-600' },
        { name: 'Image to PDF', desc: 'Convert JPG, PNG, and other images to PDF documents.', icon: ImageIcon, color: 'from-blue-500 to-indigo-600' },
        { name: 'PDF to Word', desc: 'Extract text and layouts into editable Word files.', icon: FileText, color: 'from-amber-500 to-orange-600' },
        { name: 'Merge/Split PDF', desc: 'Combine multiple files or extract specific pages.', icon: Layers, color: 'from-purple-500 to-violet-600' },
        { name: 'Image Compressor', desc: 'Shrink JPEG/PNG image file sizes with optimal quality.', icon: Zap, color: 'from-emerald-500 to-teal-600' },
        { name: 'Background Remover', desc: 'Automatically remove image background using AI.', icon: Sparkles, color: 'from-fuchsia-500 to-pink-600' }
    ];

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="AI & Edit Tools Hub"
            maxWidth="max-w-4xl"
            zIndex={zIndex}
            defaultMaximized={true}
        >
            <div className="flex flex-col flex-1 h-full">
                {/* Modern Premium Tabs Header */}
                <div className="flex border-b border-slate-100 bg-slate-50/50 p-1.5 rounded-lg gap-2 mb-4">
                    <button
                        onClick={() => handleTabClick('pdf_image')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-semibold transition-all duration-200 ${
                            activeTab === 'pdf_image'
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <FileText size={16} />
                        PDF & Image Tools
                    </button>
                    <button
                        onClick={() => handleTabClick('coming_soon')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-semibold transition-all duration-200 ${
                            activeTab === 'coming_soon'
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <Sparkles size={16} />
                        Coming Soon More Sections
                    </button>
                </div>

                {/* Tab Contents */}
                <div className="flex-1 overflow-y-auto px-1">
                    {activeTab === 'pdf_image' && (
                        <div className="space-y-6">
                            {/* Premium Announcement Hero Card */}
                            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-8 text-white shadow-xl">
                                <div className="absolute top-0 right-0 -mt-6 -mr-6 w-36 h-36 rounded-full bg-blue-500/10 blur-2xl"></div>
                                <div className="absolute bottom-0 left-0 -mb-6 -ml-6 w-36 h-36 rounded-full bg-indigo-500/10 blur-2xl"></div>
                                
                                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="space-y-2 max-w-xl">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-xs font-bold text-blue-300 uppercase tracking-wider">
                                            <Sparkles size={12} className="animate-pulse" /> Custom Web Utilities
                                        </div>
                                        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-300">
                                            Premium Tools at aitoolsgent.com
                                        </h2>
                                        <p className="text-slate-300 text-sm md:text-base leading-relaxed">
                                            Access our own custom-made utility tools built for speed, privacy, and productivity. Edit PDFs, convert formats, compress files, and clean up images in seconds.
                                        </p>
                                    </div>
                                    
                                    <button
                                        onClick={handleOpenWebsite}
                                        className="shrink-0 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-200 transform hover:-translate-y-0.5 group"
                                    >
                                        Launch Web Tools
                                        <ExternalLink size={16} className="group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                </div>
                            </div>

                            {/* Tools Grid Preview */}
                            <div>
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">Featured Online Tools</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {pdfTools.map((tool, idx) => {
                                        const IconComponent = tool.icon;
                                        return (
                                            <div 
                                                key={idx} 
                                                onClick={handleOpenWebsite}
                                                className="group relative flex gap-4 p-4 rounded-xl border border-slate-100 hover:border-indigo-100 bg-white hover:bg-gradient-to-r hover:from-white hover:to-indigo-50/20 cursor-pointer shadow-sm hover:shadow-md transition-all duration-200"
                                            >
                                                <div className={`flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br ${tool.color} text-white shadow-md`}>
                                                    <IconComponent size={22} />
                                                </div>
                                                <div className="flex-1 space-y-1 pr-6">
                                                    <h4 className="font-bold text-slate-800 group-hover:text-indigo-950 transition-colors flex items-center gap-1.5">
                                                        {tool.name}
                                                    </h4>
                                                    <p className="text-xs text-slate-500 leading-normal">
                                                        {tool.desc}
                                                    </p>
                                                </div>
                                                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-indigo-500 transition-opacity">
                                                    <ArrowRight size={14} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'coming_soon' && (
                        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 animate-bounce">
                                <Compass size={32} />
                            </div>
                            <div className="space-y-1.5 max-w-md">
                                <h3 className="text-lg font-bold text-slate-800">More Tools Coming Soon</h3>
                                <p className="text-sm text-slate-500">
                                    We are actively developing more sections including advanced calculation builders, currency calculators, accounting templates, and AI-powered document automations.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-bold text-slate-600 border border-slate-200">AI Assistants</span>
                                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-bold text-slate-600 border border-slate-200">Automation</span>
                                <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-bold text-slate-600 border border-slate-200">Custom Forms</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer status bar */}
                <div className="border-t border-slate-100 mt-6 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 bg-white">
                    <div className="flex items-center gap-1.5">
                        <Shield size={12} className="text-emerald-500" />
                        <span>All processed documents are handled safely. No files are stored.</span>
                    </div>
                    <a 
                        href="https://www.aitoolsgent.com" 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                    >
                        Visit aitoolsgent.com <ExternalLink size={10} />
                    </a>
                </div>
            </div>
        </Modal>
    );
};

export default EditToolsModal;
