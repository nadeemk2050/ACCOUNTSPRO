import { useState } from 'react';
import { VALUATION_OPTIONS, valuationLabel, valuationShortLabel } from './stockValuation';

/**
 * StockValuationBadge — the little tab shown next to "Stock Summary Grand Total"
 * on the main dashboard. It displays which valuation method the closing stock
 * figure is based on (FIFO / Last Purchase-Prod Rate / Last Sold Price) and lets
 * the user switch it in place.
 *
 * All state is local to this component so App does not re-render while the
 * popup opens or closes; the chosen method is lifted one level only when it
 * actually changes.
 *
 * ⚠️ Keep this file BYTE-IDENTICAL between the ACCPRO apps.
 */
export default function StockValuationBadge({ value, onChange }) {
    const [open, setOpen] = useState(false);

    const stop = (e) => { e.stopPropagation(); };

    return (
        <span className="relative inline-flex items-center ml-2 align-middle">
            <button
                type="button"
                onClick={(e) => { stop(e); setOpen(o => !o); }}
                title={`Stock valuation method: ${valuationLabel(value)} — click to change`}
                className="px-1.5 py-[1px] text-[8px] font-black uppercase tracking-wider rounded border border-[#005994]/40 bg-[#eaf4ff] text-[#00457c] hover:bg-[#dbeafe]"
            >
                {valuationShortLabel(value)}
            </button>

            {open && (
                <>
                    {/* click-away shield — sits under the menu, over the page */}
                    <span className="fixed inset-0 z-[9998]" onClick={(e) => { stop(e); setOpen(false); }} />
                    <span className="absolute left-0 top-full mt-1 z-[9999] min-w-[168px] bg-white border border-[#005994]/30 shadow-lg rounded overflow-hidden">
                        {VALUATION_OPTIONS.map(o => (
                            <button
                                key={o.value}
                                type="button"
                                onClick={(e) => { stop(e); onChange(o.value); setOpen(false); }}
                                className={`block w-full text-left px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide hover:bg-[#eaf4ff] ${o.value === value ? 'bg-[#f6fcff] text-[#00457c]' : 'text-slate-600'}`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </span>
                </>
            )}
        </span>
    );
}
