import React from 'react';
import { X, BookOpen, Command, Keyboard, Zap, FileText } from 'lucide-react';

const UserManualModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden">
      <div className="bg-white shadow-2xl w-full h-full flex flex-col animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <BookOpen size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">User Manual</h3>
              <p className="text-xs text-slate-500">Guide & Keyboard Shortcuts</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-red-500 transition-colors shadow-sm">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* Section 1: Keyboard Shortcuts */}
          <div className="mb-8">
            <h4 className="flex items-center gap-2 text-lg font-bold text-slate-800 mb-4 border-b pb-2">
              <Keyboard size={20} className="text-blue-600" /> Keyboard Shortcuts
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ShortcutKey k="F2" label="Jump to Date Selection" />
              <ShortcutKey k="F4" label="Open Ledgers / Select Customer" />
              <ShortcutKey k="F5" label="New Payment / Receipt Voucher" />
              <ShortcutKey k="F8" label="New Sales Invoice" />
              <ShortcutKey k="F9" label="New Purchase Invoice" />
              <ShortcutKey k="Esc" label="Close Current Modal / Menu" />
            </div>
          </div>

          {/* Section 2: Features Guide */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            <GuideCard
              icon={Zap}
              title="High-Speed Entry"
              color="yellow"
              desc="The app uses parallel processing. Saving Invoices with 50+ items happens instantly. Use the 'Tab' key to move between fields quickly."
            />

            <GuideCard
              icon={Command}
              title="Smart Updates"
              color="purple"
              desc="Editing an Item's 'Opening Stock' or a Party's 'Opening Balance' in the Masters menu will automatically recalculate balances for all history."
            />

            <GuideCard
              icon={FileText}
              title="Contra Vouchers"
              color="blue"
              desc="Use 'Payment Voucher (F5)' -> Select 'Contra' to transfer money between Cash/Bank ledgers. It updates both sides instantly."
            />

            <GuideCard
              icon={BookOpen}
              title="Dual Valuation"
              color="green"
              desc="In Stock Inventory & Financial Reports, you can toggle between 'Weighted Average Cost' (Accounting View) and 'Last Sold Price' (Market View)."
            />

          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 text-center text-xs text-slate-400">
          v 2.5 NADTALLY Accounting System • Press 'Esc' to close
        </div>
      </div>
    </div>
  );
};

// Sub-components for styling
const ShortcutKey = ({ k, label }) => (
  <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100 hover:border-blue-200 transition-colors">
    <span className="text-sm font-medium text-slate-600">{label}</span>
    <kbd className="px-3 py-1 bg-white border border-slate-200 rounded-md text-sm font-bold text-slate-700 shadow-sm min-w-[3rem] text-center">
      {k}
    </kbd>
  </div>
);

const GuideCard = ({ icon: Icon, title, desc, color }) => (
  <div className="flex gap-4 p-4 rounded-xl border border-slate-100 hover:shadow-md transition-shadow">
    <div className={`p-3 h-fit rounded-lg bg-${color}-50 text-${color}-600`}>
      <Icon size={20} />
    </div>
    <div>
      <h5 className="font-bold text-slate-800 mb-1">{title}</h5>
      <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
    </div>
  </div>
);

export default UserManualModal;