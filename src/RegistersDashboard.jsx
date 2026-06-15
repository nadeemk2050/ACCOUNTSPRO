import React, { useState, useEffect, useMemo } from 'react';
import {
    X, ArrowRight, ChevronRight, Search
} from 'lucide-react';

const RegistersDashboard = ({
    onClose,
    onShowSalesRegister,
    onShowPurchaseRegister,
    onShowPaymentRegister,
    onShowReceiptRegister,
    onShowContraRegister,
    onShowJournalRegister,
    onShowDebitNoteRegister,
    onShowCreditNoteRegister,
    onShowStockInventory,
    onShowPieceInventory,
    onShowLotDetail,
    onShowCashierRegister,
    onShowCustomerRegister,
    onShowCapitalRegister,
    onShowAssetRegister,
    onShowExpenseRegister,
    onShowDirectExpenseRegister,
    onShowIncomeRegister,
    onShowManufacturingRegister,
    onShowLoansAdvancesRegister,
    onShowTaxRegister,
    user,
    effectiveName,
    companyProfile
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const bgGradient = "bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a]";

    const modules = useMemo(() => [
        { id: 'sales_reg', name: 'Sales Register', shortcut: 'S', action: onShowSalesRegister, v2: true, desc: 'Sales transactions & performance' },
        { id: 'purchase_reg', name: 'Purchase Register', shortcut: 'P', action: onShowPurchaseRegister, v2: true, desc: 'Procurement & vendor records' },
        { id: 'payment_reg', name: 'Payments Register', shortcut: 'Y', action: onShowPaymentRegister, v2: true, desc: 'Outward cash & bank flows' },
        { id: 'receipt_reg', name: 'Receipts Register', shortcut: 'R', action: onShowReceiptRegister, v2: true, desc: 'Inward cash & bank flows' },
        { id: 'contra_reg', name: 'Contra Register', shortcut: 'C', action: onShowContraRegister, v2: true, desc: 'Inter-account fund transfers' },
        { id: 'journal_reg', name: 'Journal Register', shortcut: 'J', action: onShowJournalRegister, v2: true, desc: 'Adjustment & non-cash entries' },
        { id: 'debit_note', name: 'Debit Notes', shortcut: 'D', action: onShowDebitNoteRegister, v2: true, desc: 'Purchase returns & adjustments' },
        { id: 'credit_note', name: 'Credit Notes', shortcut: 'E', action: onShowCreditNoteRegister, v2: true, desc: 'Sales returns & adjustments' },
        { id: 'stock_inv', name: 'Stock Inventory', shortcut: 'K', action: onShowStockInventory, v2: true, desc: 'Current warehouse stock levels' },
        { id: 'piece_inv', name: 'Piece Wise Inventory', shortcut: 'W', action: onShowPieceInventory, v2: true, desc: 'Unit-by-unit stock breakdown' },
        { id: 'lot_inv', name: 'Lot Wise Detail', shortcut: 'L', action: onShowLotDetail, v2: true, desc: 'Batch & batch-wise tracking' },
        { id: 'cashier_reg', name: 'Cashier Register', shortcut: 'H', action: onShowCashierRegister, v2: true, desc: 'Detailed cashier transactions' },
        { id: 'customer_reg', name: 'Customers Register', shortcut: 'U', action: onShowCustomerRegister, v2: true, desc: 'Party-wise ledger summary' },
        { id: 'capital_reg', name: 'Capital Register', shortcut: 'I', action: onShowCapitalRegister, v2: true, desc: 'Owner & equity investments' },
        { id: 'asset_reg', name: 'Assets Register', shortcut: 'A', action: onShowAssetRegister, v2: true, desc: 'Fixed & current asset records' },
        { id: 'direct_expense_reg', name: 'Direct Expenses Register', shortcut: 'T', action: onShowDirectExpenseRegister, v2: true, desc: 'Manufacturing & COGS direct expense ledgers' },
        { id: 'expense_reg', name: 'Indirect Expenses Register', shortcut: 'X', action: onShowExpenseRegister, v2: true, desc: 'Operating & administrative costs' },
        { id: 'income_reg', name: 'Indirect Incomes Register', shortcut: 'N', action: onShowIncomeRegister, v2: true, desc: 'Non-operating revenue sources' },
        { id: 'manuf_reg', name: 'Manufacturing Register', shortcut: 'M', action: onShowManufacturingRegister, v2: true, desc: 'Production & processing logs' },
        { id: 'loans_adv', name: 'Loans & Advances Tracker', shortcut: 'V', action: onShowLoansAdvancesRegister, v2: true, desc: 'OA · TA · OL · TL — Track outstanding balances & due dates' },
        { id: 'tax_reg', name: 'Tax Registers', shortcut: 'G', action: onShowTaxRegister, v2: true, desc: 'Tax-wise invoice values and running balances' },
        { id: 'bill_wise', name: 'Bill Wise Details', shortcut: 'B', action: null, comingSoon: true, desc: 'Party-wise outstanding bill tracking' },
    ], [
        onShowSalesRegister, onShowPurchaseRegister, onShowPaymentRegister, onShowReceiptRegister,
        onShowContraRegister, onShowJournalRegister, onShowDebitNoteRegister, onShowCreditNoteRegister,
        onShowStockInventory, onShowPieceInventory, onShowLotDetail, onShowCashierRegister,
        onShowCustomerRegister, onShowCapitalRegister, onShowAssetRegister, onShowDirectExpenseRegister,
        onShowExpenseRegister, onShowIncomeRegister, onShowManufacturingRegister, onShowLoansAdvancesRegister,
        onShowTaxRegister
    ]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const isInputFocused = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

            if (e.altKey) {
                const key = e.key.toLowerCase();
                const module = modules.find(m => m.shortcut && m.shortcut.toLowerCase() === key);
                if (module && !module.comingSoon && module.action) {
                    e.preventDefault();
                    module.action();
                }
            } else if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
                if (!isInputFocused) {
                    e.preventDefault();
                    setSearchTerm(e.key.toUpperCase());
                    const searchInput = document.getElementById('register-search');
                    if (searchInput) searchInput.focus();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [modules]);

    const renderNameWithShortcut = (name, shortcut) => {
        if (!shortcut) return name;
        const index = name.toLowerCase().indexOf(shortcut.toLowerCase());
        if (index === -1) return name;

        return (
            <>
                {name.substring(0, index)}
                <span className="text-red-700 font-extrabold underline decoration-red-700/50 underline-offset-2">{name.charAt(index)}</span>
                {name.substring(index + 1)}
            </>
        );
    };

    return (
        <div className={`fixed inset-0 z-[100] ${bgGradient} text-white font-sans flex flex-col animate-in fade-in duration-300`}>
            {/* HEADER */}
            <div className="h-14 bg-black/20 flex items-center justify-between px-6 backdrop-blur-sm border-b border-white/10">
                <div className="flex items-center gap-4 cursor-pointer hover:bg-white/10 px-3 py-2 rounded-lg transition-colors" onClick={onClose}>
                    <div className="bg-white/10 p-2 rounded-md">
                        <ArrowRight className="rotate-180" size={20} />
                    </div>
                    <div className="flex flex-col select-none">
                        <span className="text-xl font-bold tracking-wide">REGISTERS DASHBOARD</span>
                        <span className="text-[10px] opacity-60 uppercase tracking-widest">Comprehensive Reports View</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden md:flex flex-col text-right">
                        <span className="text-xs font-bold text-white/80">{effectiveName || user?.email}</span>
                        <span className="text-[10px] opacity-50">{companyProfile?.name || 'Company Name'}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
                    >
                        <X size={24} />
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
                <div className="w-full max-w-lg bg-black/40 backdrop-blur-xl border border-white/10 rounded-[2.5rem] shadow-[0_40px_100px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95 duration-500">
                    <div className="px-8 py-6 border-b border-white/5 bg-white/[0.02] flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-1">Navigation</div>
                                <h2 className="text-white font-black text-2xl tracking-tight leading-none">Select a Register</h2>
                            </div>
                        </div>

                        {/* SEARCH FIELD */}
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <Search size={16} className="text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                            </div>
                            <input 
                                id="register-search"
                                type="text"
                                placeholder="SEARCH FOR A REGISTER (E.G. SALES, TAX, INVENTORY...)"
                                className="w-full bg-white/[0.05] border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-[10px] font-black text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white/[0.08] transition-all uppercase tracking-widest"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="p-3 space-y-0.5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {modules
                            .filter(mod => {
                                const search = searchTerm.toLowerCase();
                                if (!search) return true;
                                if (search.length === 1) {
                                    return mod.name.toLowerCase().startsWith(search);
                                }
                                return mod.name.toLowerCase().includes(search) || mod.desc.toLowerCase().includes(search);
                            })
                            .map((mod) => (
                            <button
                                key={mod.id}
                                onClick={() => {
                                    if (mod.comingSoon) return; // do nothing for coming soon
                                    if (mod.action) mod.action();
                                    else alert("Coming soon or not connected.");
                                }}
                                className={`w-full group relative flex items-center justify-between py-2.5 px-6 rounded-2xl transition-all text-left active:scale-[0.98] outline-none ${mod.comingSoon ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/[0.05]'}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-3">
                                            <div className="text-white font-black text-base tracking-tight uppercase group-hover:text-blue-400 transition-colors">
                                                {renderNameWithShortcut(mod.name, mod.shortcut)}
                                            </div>
                                            {mod.v2 && !mod.comingSoon && (
                                                <div className="bg-blue-600/20 text-blue-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest border border-blue-500/30">V2</div>
                                            )}
                                            {mod.comingSoon && (
                                                <div className="bg-yellow-500/20 text-yellow-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest border border-yellow-500/30 animate-pulse">Coming Soon</div>
                                            )}
                                        </div>
                                        <div className="text-slate-400 text-[11px] font-medium opacity-60 mt-0.5">{mod.desc}</div>
                                    </div>
                                </div>
                                
                                {!mod.comingSoon && (
                                    <div className="opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all text-blue-400">
                                        <ChevronRight size={20} strokeWidth={3} />
                                    </div>
                                )}
                            </button>
                        ))}
                        {modules.filter(mod => {
                            const search = searchTerm.toLowerCase();
                            if (!search) return true;
                            if (search.length === 1) {
                                return mod.name.toLowerCase().startsWith(search);
                            }
                            return mod.name.toLowerCase().includes(search) || mod.desc.toLowerCase().includes(search);
                        }).length === 0 && (
                            <div className="p-12 text-center flex flex-col items-center gap-3 opacity-30">
                                <Search size={48} className="text-slate-500" />
                                <div className="text-[10px] font-black uppercase tracking-[0.2em]">No Register Found</div>
                            </div>
                        )}
                    </div>

                    <div className="px-8 py-4 bg-black/20 border-t border-white/5 flex items-center justify-between">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            Audit Ready Reports
                        </div>
                        <div className="text-[9px] font-mono bg-white/5 px-2 py-1 rounded text-slate-400">
                            V2.6.7
                        </div>
                    </div>
                </div>
            </div>

            {/* INFO FOOTER (Subtle) */}
            <div className="p-6 opacity-30 text-center">
                 <p className="text-[10px] uppercase tracking-[0.2em]">Registers provide a chronological view of all transactions.</p>
            </div>
        </div>
    );
};

export default RegistersDashboard;
