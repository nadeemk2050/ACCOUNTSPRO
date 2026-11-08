import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, EyeOff } from 'lucide-react';

export const STOCK_GROUP_COLOR_KEYS = [
    'colorOpeningQty',
    'colorOpeningValue',
    'colorInwardQty',
    'colorInwardValue',
    'colorOutwardQty',
    'colorOutwardValue',
    'colorClosingQty',
    'colorClosingValue'
];

export const FLAG_TO_COLOR_KEY = {
    shouldQuantities: 'colorOpeningQty',
    shouldValues: 'colorOpeningValue',
    addInwardQty: 'colorInwardQty',
    addInwardValue: 'colorInwardValue',
    addOutwardQty: 'colorOutwardQty',
    addOutwardValue: 'colorOutwardValue',
    addClosingQty: 'colorClosingQty',
    addClosingValue: 'colorClosingValue'
};

export const GROUP_TAB_COLOR_OPTIONS = [
    {
        value: 'original',
        label: '1. Same as Original',
        shortLabel: 'Same as Original',
        swatchBg: '#f4ece1',
        swatchBorder: '#cbb89d',
        cellBgClass: null, // uses default group row cream shade
        cardAccentClass: '',
        isBlank: false
    },
    {
        value: 'light_green',
        label: '2. Light Green',
        shortLabel: 'Light Green',
        swatchBg: '#dcfce7',
        swatchBorder: '#4ade80',
        cellBgClass: 'bg-[#dcfce7]',
        cardAccentClass: 'ring-2 ring-emerald-300/70',
        isBlank: false
    },
    {
        value: 'light_purple',
        label: '3. Background Light Purple',
        shortLabel: 'Light Purple',
        swatchBg: '#f3e8ff',
        swatchBorder: '#c084fc',
        cellBgClass: 'bg-[#f3e8ff]',
        cardAccentClass: 'ring-2 ring-purple-300/70',
        isBlank: false
    },
    {
        value: 'light_grey',
        label: '4. Background Light Grey',
        shortLabel: 'Light Grey',
        swatchBg: '#e2e8f0',
        swatchBorder: '#94a3b8',
        cellBgClass: 'bg-[#e2e8f0]',
        cardAccentClass: 'ring-2 ring-slate-300',
        isBlank: false
    },
    {
        value: 'full_blank',
        label: '5. Make It Full Blank (Hide Everything)',
        shortLabel: 'Full Blank (Hidden)',
        swatchBg: '#ffffff',
        swatchBorder: '#94a3b8',
        cellBgClass: 'bg-white',
        cardAccentClass: 'ring-2 ring-slate-300 border-dashed',
        isBlank: true
    }
];

export const getGroupTabColorConfig = (val) => {
    const clean = String(val || 'original').trim().toLowerCase();
    // Backward compatibility if any doc had 'light_blue' saved during testing
    if (clean === 'light_blue') return GROUP_TAB_COLOR_OPTIONS[1];
    return GROUP_TAB_COLOR_OPTIONS.find(o => o.value === clean) || GROUP_TAB_COLOR_OPTIONS[0];
};

export const ColorSwatchBox = ({ option, size = 'md' }) => {
    const cfg = option || GROUP_TAB_COLOR_OPTIONS[0];
    const dims = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
    if (cfg.isBlank) {
        return (
            <span
                className={`inline-flex items-center justify-center ${dims} rounded border border-dashed border-slate-400 bg-white shrink-0 shadow-inner`}
                title={cfg.label}
            >
                <EyeOff size={size === 'sm' ? 9 : 10} className="text-slate-400" />
            </span>
        );
    }
    return (
        <span
            className={`inline-block ${dims} rounded border shrink-0 shadow-inner`}
            style={{ backgroundColor: cfg.swatchBg, borderColor: cfg.swatchBorder }}
            title={cfg.label}
        />
    );
};

export const GroupColorSelect = ({ value, onChange, className = '', compact = false }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const selected = getGroupTabColorConfig(value);

    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    return (
        <div
            ref={containerRef}
            className={`relative ${className}`}
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                onClick={() => setOpen(prev => !prev)}
                className={`w-full flex items-center justify-between gap-2 ${
                    compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
                } border border-slate-300 rounded-lg font-bold text-slate-800 bg-white hover:border-[#005994] focus:outline-none focus:ring-2 focus:ring-[#005994]/20 focus:border-[#005994] transition-all text-left shadow-xs`}
            >
                <span className="flex items-center gap-2 min-w-0 truncate">
                    <ColorSwatchBox option={selected} size={compact ? 'sm' : 'md'} />
                    <span className="truncate">{selected.label}</span>
                </span>
                <ChevronDown size={compact ? 12 : 14} className={`text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute left-0 right-0 mt-1 z-[999999] bg-white rounded-xl border border-slate-200 shadow-2xl py-1 max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                    {GROUP_TAB_COLOR_OPTIONS.map((opt) => {
                        const isSelected = opt.value === selected.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-bold text-left transition-colors ${
                                    isSelected
                                        ? 'bg-[#005994]/10 text-[#005994]'
                                        : 'text-slate-700 hover:bg-slate-100'
                                }`}
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    <ColorSwatchBox option={opt} size="sm" />
                                    <span className="truncate">{opt.label}</span>
                                </span>
                                {isSelected && <Check size={13} className="text-[#005994] shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
