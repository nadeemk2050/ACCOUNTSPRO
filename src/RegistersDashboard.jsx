import React, { useState } from 'react';
import {
    X, ArrowRight, ChevronRight
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
    onShowBagInventory,
    onShowLotDetail,
    onShowCashierRegister,
    onShowCustomerRegister,
    onShowCapitalRegister,
    onShowAssetRegister,
    onShowExpenseRegister,
    onShowIncomeRegister,
    onShowManufacturingRegister,
    onShowLoansAdvancesRegister,
    user,
    effectiveName,
    companyProfile
}) => {
    const bgGradient = "bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a]";

    const modules = [
        { id: 'sales_reg', name: 'Sales Register', action: onShowSalesRegister, v2: true, desc: 'Sales transactions & performance' },
        { id: 'purchase_reg', name: 'Purchase Register', action: onShowPurchaseRegister, v2: true, desc: 'Procurement & vendor records' },
        { id: 'payment_reg', name: 'Payments Register', action: onShowPaymentRegister, v2: true, desc: 'Outward cash & bank flows' },
        { id: 'receipt_reg', name: 'Receipts Register', action: onShowReceiptRegister, v2: true, desc: 'Inward cash & bank flows' },
        { id: 'contra_reg', name: 'Contra Register', action: onShowContraRegister, v2: true, desc: 'Inter-account fund transfers' },
        { id: 'journal_reg', name: 'Journal Register', action: onShowJournalRegister, v2: true, desc: 'Adjustment & non-cash entries' },
        { id: 'debit_note', name: 'Debit Notes', action: onShowDebitNoteRegister, v2: true, desc: 'Purchase returns & adjustments' },
        { id: 'credit_note', name: 'Credit Notes', action: onShowCreditNoteRegister, v2: true, desc: 'Sales returns & adjustments' },
        { id: 'stock_inv', name: 'Stock Inventory', action: onShowStockInventory, v2: true, desc: 'Current warehouse stock levels' },
        { id: 'piece_inv', name: 'Piece Wise Inventory', action: onShowPieceInventory, v2: true, desc: 'Unit-by-unit stock breakdown' },
        { id: 'bag_inv', name: 'BAG WISE REGISTER', action: onShowBagInventory, v2: true, desc: 'Jumbo bag & packing records' },
        { id: 'lot_inv', name: 'Lot Wise Detail', action: onShowLotDetail, v2: true, desc: 'Batch & batch-wise tracking' },
        { id: 'cashier_reg', name: 'Cashier Register', action: onShowCashierRegister, v2: true, desc: 'Detailed cashier transactions' },
        { id: 'customer_reg', name: 'Customers Register', action: onShowCustomerRegister, v2: true, desc: 'Party-wise ledger summary' },
        { id: 'capital_reg', name: 'Capital Register', action: onShowCapitalRegister, v2: true, desc: 'Owner & equity investments' },
        { id: 'asset_reg', name: 'Assets Register', action: onShowAssetRegister, v2: true, desc: 'Fixed & current asset records' },
        { id: 'expense_reg', name: 'Indirect Expenses Register', action: onShowExpenseRegister, v2: true, desc: 'Operating & administrative costs' },
        { id: 'income_reg', name: 'Indirect Incomes Register', action: onShowIncomeRegister, v2: true, desc: 'Non-operating revenue sources' },
        { id: 'manuf_reg', name: 'Manufacturing Register', action: onShowManufacturingRegister, v2: true, desc: 'Production & processing logs' },
        { id: 'loans_adv', name: 'Loans & Advances Tracker', action: onShowLoansAdvancesRegister, v2: true, desc: 'OA · TA · OL · TL — Track outstanding balances & due dates' },
        { id: 'bill_wise', name: 'Bill Wise Details', action: null, comingSoon: true, desc: 'Party-wise outstanding bill tracking' },
    ];

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
                    <div className="px-8 py-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-1">Navigation</div>
                            <h2 className="text-white font-black text-2xl tracking-tight leading-none">Select a Register</h2>
                        </div>
                    </div>

                    <div className="p-3 space-y-0.5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        {modules.map((mod) => (
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
                                                {mod.name}
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
                    </div>

                    <div className="px-8 py-4 bg-black/20 border-t border-white/5 flex items-center justify-between">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            Audit Ready Reports
                        </div>
                        <div className="text-[9px] font-mono bg-white/5 px-2 py-1 rounded text-slate-400">
                            V 2.5.1
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
