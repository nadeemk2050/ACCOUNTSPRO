import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight } from 'lucide-react';

export const VoucherV2Menu = ({ isOpen, onClose, onSelect, zIndexCode = 200 }) => {
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const vouchers = [
        { id: 'sales_v2', label: 'Sales', kbd: 'F8', desc: 'Outgoing goods & revenue', color: 'text-blue-400' },
        { id: 'purchase_v2', label: 'Purchase', kbd: 'F9', desc: 'Incoming goods & stock', color: 'text-emerald-400' },
        { id: 'payment_v2', label: 'Payment', kbd: 'F5', desc: 'Cash / bank outflow', color: 'text-rose-400' },
        { id: 'receipt_v2', label: 'Receipt', kbd: 'F6', desc: 'Cash / bank inflow', color: 'text-teal-400' },
        { id: 'contra_v2', label: 'Contra', kbd: 'F4', desc: 'Internal fund transfer', color: 'text-purple-400' },
        { id: 'journal_v2', label: 'Journal', kbd: 'F7', desc: 'Adjustment transactions', color: 'text-slate-400' },
        { id: 'manufacturing_v2', label: 'Mfg Jnl', kbd: 'M', desc: 'Production / Consumption', color: 'text-indigo-400' },
    ];

    return createPortal(
        <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 transition-all"
            style={{ zIndex: zIndexCode }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-[#0f172a] border border-white/10 rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div>
                        <div className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-0.5">Voucher Types</div>
                        <h2 className="text-white font-black text-xl tracking-tight leading-none">Select Transaction</h2>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-white/5 rounded-xl text-slate-500 hover:text-white transition-all">
                        <X size={20} />
                    </button>
                </div>

                {/* Voucher List */}
                <div className="p-4 space-y-1 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {vouchers.map((v) => (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => { onSelect(v.id); onClose(); }}
                            className="w-full group relative flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.04] transition-all text-left active:scale-[0.99] outline-none"
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <div className="text-white font-black text-sm tracking-tight">{v.label}</div>
                                        <div className="text-slate-500 text-[10px] font-black group-hover:text-blue-400 transition-colors">({v.kbd})</div>
                                    </div>
                                    <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider opacity-60">{v.desc}</div>
                                </div>
                            </div>
                            
                            <div className="opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all text-blue-400">
                                <ChevronRight size={16} strokeWidth={3} />
                            </div>
                        </button>
                    ))}
                </div>

                <div className="px-6 py-3 flex items-center justify-between text-[8px] text-slate-600 font-bold uppercase tracking-widest border-t border-white/5 bg-black/10">
                    <span>Pro Account Edition</span>
                    <span className="opacity-40 select-none">TallyPrime Aesthetics</span>
                </div>
            </div>
        </div>,
        document.body
    );
};
