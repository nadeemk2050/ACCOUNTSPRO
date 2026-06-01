import React, { useState, useEffect } from 'react';
import { Modal } from './components/Modal';
import { Key, RefreshCw, Copy, Check, Globe, Shield, Activity, Info, ChevronDown, ChevronRight, Monitor, Database, Clock, Users, Wifi, WifiOff } from 'lucide-react';
import { httpsCallable } from '@firebase/functions';
import { cloudFunctions as functions } from './firebase';
import { getActiveCompanyId } from './localDB';

const ApiKeyModal = ({ isOpen, onClose, zIndex = 200 }) => {
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const [usageExpanded, setUsageExpanded] = useState(false);
    const [usageData, setUsageData] = useState(null);
    const [usageLoading, setUsageLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchApiKey();
            setUsageExpanded(false);
            setUsageData(null);
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

    const fetchUsageDetails = async () => {
        if (usageData) return; // Already loaded
        setUsageLoading(true);
        try {
            const companyId = getActiveCompanyId();
            const getUsageFn = httpsCallable(functions, 'getApiUsageDetails');
            const result = await getUsageFn({ companyId });
            setUsageData(result.data);
        } catch (err) {
            console.error("Error fetching usage details:", err);
        } finally {
            setUsageLoading(false);
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
                setUsageData(null); // Reset usage data
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

    const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'KB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatTimestamp = (ts) => {
        if (!ts) return 'N/A';
        const d = new Date(ts);
        return d.toLocaleString();
    };

    const baseEndpoint = `https://cashshams.web.app/accproApi`;

    const handleToggleUsage = () => {
        const newVal = !usageExpanded;
        setUsageExpanded(newVal);
        if (newVal && !usageData) {
            fetchUsageDetails();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="API & Widget Access" maxWidth="max-w-2xl" zIndex={zIndex}>
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

                {/* API Usage Details Section */}
                {apiKey && (
                    <div className="bg-slate-50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <button
                            onClick={handleToggleUsage}
                            className="w-full flex items-center justify-between p-4 hover:bg-slate-100 transition-colors text-left"
                        >
                            <div className="flex items-center gap-2 text-slate-800">
                                <Database size={18} className="text-indigo-600" />
                                <h4 className="text-xs font-black uppercase tracking-wider">API Usage Details</h4>
                                {usageData && (
                                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
                                        {usageData.stats?.totalRequests || 0} requests
                                    </span>
                                )}
                            </div>
                            {usageExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                        </button>

                        {usageExpanded && (
                            <div className="px-4 pb-4 space-y-4 border-t border-slate-200 pt-3">
                                {usageLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <RefreshCw size={20} className="animate-spin text-indigo-500" />
                                        <span className="ml-2 text-xs text-slate-500">Loading usage data...</span>
                                    </div>
                                ) : !usageData || !usageData.exists ? (
                                    <div className="text-center py-4">
                                        <WifiOff size={24} className="text-slate-300 mx-auto mb-2" />
                                        <p className="text-xs text-slate-500">No usage data available yet.</p>
                                        <p className="text-[10px] text-slate-400 mt-1">Connect the teller app or widget to start seeing details.</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Stats Summary */}
                                        <div className="grid grid-cols-4 gap-2">
                                            <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
                                                <p className="text-lg font-black text-indigo-600">{usageData.stats?.totalRequests || 0}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-1">Requests</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
                                                <p className="text-lg font-black text-green-600">{usageData.stats?.uniqueDevices || 0}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-1">Devices</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
                                                <p className="text-sm font-black text-slate-700">{formatBytes(usageData.stats?.totalDataSent || 0)}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-1">Sent</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-3 border border-slate-100 text-center">
                                                <p className="text-sm font-black text-slate-700">{formatBytes(usageData.stats?.totalDataReceived || 0)}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-1">Received</p>
                                            </div>
                                        </div>

                                        {/* First/Last Connection */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                                                <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                                                    <Clock size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">First Connected</span>
                                                </div>
                                                <p className="text-xs font-semibold text-slate-700">{formatTimestamp(usageData.stats?.firstConnection)}</p>
                                            </div>
                                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                                                <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                                                    <Activity size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">Last Activity</span>
                                                </div>
                                                <p className="text-xs font-semibold text-slate-700">{formatTimestamp(usageData.stats?.lastConnection)}</p>
                                            </div>
                                        </div>

                                        {/* Connected Devices */}
                                        {usageData.usageLogs && usageData.usageLogs.length > 0 && (
                                            <div>
                                                <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                                                    <Monitor size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">Connected Devices</span>
                                                </div>
                                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                                    {[...new Map(usageData.usageLogs.map(l => [l.deviceInfo, l])).values()].slice(0, 5).map((log, i) => (
                                                        <div key={i} className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-slate-100">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <Wifi size={12} className="text-green-500 shrink-0" />
                                                                <span className="text-[10px] font-medium text-slate-700 truncate">{log.deviceInfo}</span>
                                                            </div>
                                                            <span className="text-[8px] text-slate-400 shrink-0 ml-2">{log.action}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Team Members Dropdown */}
                                        {usageData.teamMembers && usageData.teamMembers.length > 0 && (
                                            <div>
                                                <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                                                    <Users size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">User Names (Team Members)</span>
                                                </div>
                                                <div className="max-h-40 overflow-y-auto space-y-1">
                                                    {usageData.teamMembers.map(member => (
                                                        <div key={member.id} className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-slate-100">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">
                                                                    {(member.name || '?').charAt(0).toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <p className="text-[11px] font-semibold text-slate-700">{member.name}</p>
                                                                    <p className="text-[8px] text-slate-400">{member.email}</p>
                                                                </div>
                                                            </div>
                                                            <span className="text-[8px] font-bold uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                                                                {member.role === 'owner' ? 'Admin/Owner' : member.role}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Recent Activity Log */}
                                        {usageData.usageLogs && usageData.usageLogs.length > 0 && (
                                            <div>
                                                <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                                                    <Activity size={12} />
                                                    <span className="text-[9px] font-bold uppercase tracking-wider">Recent Activity</span>
                                                </div>
                                                <div className="max-h-32 overflow-y-auto space-y-1">
                                                    {usageData.usageLogs.slice(0, 10).map((log, i) => (
                                                        <div key={log.id || i} className="flex items-center justify-between bg-white rounded-lg p-2 border border-slate-100">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-[9px] font-mono text-slate-500">{formatTimestamp(log.timestamp)}</span>
                                                                <span className="text-[9px] font-bold text-slate-600 uppercase">{log.action}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-[8px] text-slate-400">{formatBytes(log.dataReceived)} recv</span>
                                                                {log.deviceInfo && (
                                                                    <span className="text-[8px] text-slate-400 truncate max-w-[80px]">{log.deviceInfo}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

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
