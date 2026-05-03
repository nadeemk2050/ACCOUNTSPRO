import React, { useState, useEffect } from 'react';
import { Modal } from './components/Modal';
import { Key, RefreshCw, Copy, Check, Globe, Shield, ExternalLink, Activity, Info } from 'lucide-react';
import { httpsCallable } from '@firebase/functions';
import { cloudFunctions as functions } from './firebase';
import { getActiveCompanyId } from './localDB';

const ApiKeyModal = ({ isOpen, onClose, zIndex = 200 }) => {
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            fetchApiKey();
        }
    }, [isOpen]);

    const fetchApiKey = async () => {
        setLoading(true);
        setError('');
        try {
            const companyId = getActiveCompanyId();
            const getApiKeyFn = httpsCallable(functions, 'getApiKey');
            const result = await getApiKeyFn({ companyId });
            if (result.data && result.data.apiKey) {
                setApiKey(result.data.apiKey);
            }
        } catch (err) {
            console.error("Error fetching API key:", err);
            const msg = err.message || 'Failed to fetch API key';
            setError(`Error: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    const generateKey = async () => {
        if (apiKey && !window.confirm("Generating a new API key will invalidate the old one. External widgets using the old key will stop working. Continue?")) return;
        
        setLoading(true);
        setError('');
        try {
            const companyId = getActiveCompanyId();
            const genKeyFn = httpsCallable(functions, 'generateApiKey');
            const result = await genKeyFn({ companyId });
            if (result.data && result.data.apiKey) {
                setApiKey(result.data.apiKey);
            }
        } catch (err) {
            console.error("Error generating API key:", err);
            const msg = err.message || 'Failed to generate API key';
            setError(`Error: ${msg}`);
            alert(`API Error: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const baseEndpoint = `https://accproapi-cashshams.web.app/accproApi`; // Standard Firebase Hosting + Cloud Functions alias

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="API & Widget Access" maxWidth="max-w-xl" zIndex={zIndex}>
            <div className="space-y-6 py-2">
                {/* Header Info */}
                <div className="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-lg">
                    <div className="flex gap-3">
                        <Shield className="text-indigo-600 shrink-0" size={24} />
                        <div>
                            <h4 className="text-sm font-black text-indigo-900 uppercase tracking-wide">Developer API Access</h4>
                            <p className="text-xs text-indigo-700 mt-1 font-medium italic">Use your API key to connect the Accpro Widget or external dashboards to your real-time data.</p>
                        </div>
                    </div>
                </div>

                {/* API Key Section */}
                <div className="space-y-2">
                    <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block">Your Secret API Key</label>
                        {apiKey && (
                            <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100 flex items-center gap-1">
                                <Check size={10} /> Active
                            </span>
                        )}
                    </div>
                    
                    <div className="relative group">
                        <div className={`
                            w-full p-6 bg-slate-900 text-green-400 font-mono text-sm rounded-xl border-2 transition-all shadow-2xl
                            ${apiKey ? 'border-slate-800' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400'}
                        `}>
                            {loading ? (
                                <div className="flex flex-col items-center gap-4 justify-center py-4">
                                    <div className="relative">
                                        <RefreshCw size={32} className="animate-spin text-indigo-500" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-white font-black text-xs uppercase tracking-widest animate-pulse">Initializing Secure Vault</span>
                                        <span className="text-[10px] text-slate-500 mt-1">This may take a moment on first run...</span>
                                    </div>
                                </div>
                            ) : apiKey ? (
                                <div className="flex items-center justify-between gap-4">
                                    <span className="break-all tracking-widest text-lg">{apiKey}</span>
                                    <button 
                                        onClick={() => copyToClipboard(apiKey)}
                                        className="shrink-0 p-3 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 rounded-xl transition-all active:scale-90 shadow-lg"
                                        title="Copy Key"
                                    >
                                        {copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center py-6 gap-6">
                                    <div className="text-center">
                                        <p className="text-slate-500 font-medium italic">No active API key found for this account.</p>
                                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-tighter">Generate one to start connecting widgets</p>
                                    </div>
                                    <button 
                                        onClick={generateKey}
                                        className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-black uppercase tracking-widest text-xs flex items-center gap-2 shadow-xl shadow-indigo-200 transition-all active:scale-95"
                                    >
                                        <Key size={16} />
                                        Generate New API Key
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {apiKey && (
                        <div className="flex justify-between items-center px-1">
                            <div className="flex items-center gap-1.5 text-slate-500">
                                <Info size={12} />
                                <p className="text-[10px] font-medium">Never share this key. If compromised, regenerate it immediately.</p>
                            </div>
                            <button 
                                onClick={generateKey}
                                disabled={loading}
                                className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest flex items-center gap-1.5 transition-colors group"
                            >
                                <RefreshCw size={12} className={`${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                                Revoke & Regenerate
                            </button>
                        </div>
                    )}
                </div>

                {/* API Documentation / Integration */}
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-3">
                        <Activity size={18} className="text-indigo-600" />
                        <h4 className="text-xs font-black uppercase tracking-wider">Accpro Widget Integration</h4>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">API Endpoint URL</span>
                            <div className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 shadow-sm">
                                <Globe size={14} className="text-indigo-500" />
                                <span className="flex-1 truncate font-mono text-[10px]">https://cashshams.web.app/api</span>
                                <button onClick={() => copyToClipboard('https://cashshams.web.app/api')} className="text-slate-400 hover:text-indigo-600 transition-colors">
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Widget Setup Instructions</span>
                            <div className="space-y-2">
                                <div className="flex items-start gap-3 p-3 bg-white/50 rounded-xl border border-slate-100">
                                    <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                                    <p className="text-[11px] text-slate-600 leading-relaxed">Open the <span className="font-bold text-slate-800">Accpro Widget App</span> on your mobile or desktop.</p>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white/50 rounded-xl border border-slate-100">
                                    <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                                    <p className="text-[11px] text-slate-600 leading-relaxed">Paste your <span className="font-bold text-slate-800">Secret API Key</span> when prompted for activation.</p>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white/50 rounded-xl border border-slate-100">
                                    <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">3</div>
                                    <p className="text-[11px] text-slate-600 leading-relaxed">Your dashboard will sync immediately using <span className="font-bold text-slate-800">Secure TLS Encryption</span>.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600">
                        <Activity size={14} />
                        <p className="text-[10px] font-black uppercase">{error}</p>
                    </div>
                )}
                
                <div className="pt-2">
                    <button 
                        onClick={onClose}
                        className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-[0.2em] text-xs hover:bg-indigo-700 transition-all active:scale-[0.98] shadow-lg shadow-indigo-200"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ApiKeyModal;
