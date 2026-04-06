import React from 'react';
import { X, ShoppingBag, FileText, Truck, ArrowRightLeft, Package } from 'lucide-react';

const OrderVouchersDashboard = ({ onClose }) => {
    // Voucher Definitions
    const vouchers = [
        { id: 'purchase_order', label: 'Purchase Order', icon: ShoppingBag, color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'quotation', label: 'Quotation', icon: FileText, color: 'text-orange-600', bg: 'bg-orange-50' },
        { id: 'sales_order', label: 'Sales Order', icon: ShoppingBag, color: 'text-green-600', bg: 'bg-green-50' },
        { id: 'claim_debit', label: 'Claim Debit Request', icon: ArrowRightLeft, color: 'text-red-600', bg: 'bg-red-50' },
        { id: 'delivery_note', label: 'Delivery Note (Challan)', icon: Truck, color: 'text-purple-600', bg: 'bg-purple-50' },
        { id: 'rejection_out', label: 'Rejection Out', icon: Package, color: 'text-red-500', bg: 'bg-red-50' },
        { id: 'rejection_in', label: 'Rejection In', icon: Package, color: 'text-green-500', bg: 'bg-green-50' },
        { id: 'material_req', label: 'Material Request (Internal)', icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 animate-in fade-in duration-200">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-100 rounded-lg text-teal-700">
                        <ShoppingBag size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Order Vouchers</h1>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Manage Orders & Requests</div>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <X size={28} />
                </button>
            </div>

            {/* Content - Titanium Light Grey Background */}
            <div className="flex-1 p-8 overflow-y-auto">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {vouchers.map((v) => (
                            <button
                                key={v.id}
                                onClick={() => alert(`${v.label} module coming soon!`)}
                                className="group flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-teal-200 transition-all duration-200 active:scale-[0.98]"
                            >
                                <div className={`p-4 rounded-xl mb-4 transition-transform group-hover:scale-110 duration-300 ${v.bg} ${v.color}`}>
                                    <v.icon size={32} strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-700 group-hover:text-teal-700 transition-colors text-center">
                                    {v.label}
                                </h3>
                                <p className="text-xs text-slate-400 mt-2 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                    Click to open
                                </p>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderVouchersDashboard;
