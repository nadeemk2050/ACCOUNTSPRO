import React from 'react';
import { X, FileText } from 'lucide-react';

const SystemLogModal = ({ isOpen, onClose, user, dataOwnerId }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-slate-50 rounded-t-xl">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                <FileText size={24} />
             </div>
             <div>
                <h3 className="text-xl font-bold text-slate-800">System Log</h3>
                <p className="text-xs text-slate-500">History of all actions</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-red-500 transition-colors shadow-sm">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
           <p>Log content will be displayed here.</p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 text-center text-xs text-slate-400 rounded-b-xl">
            ACCNAD Accounting System v2.0 • Press 'Esc' to close
        </div>
      </div>
    </div>
  );
};

export default SystemLogModal;
