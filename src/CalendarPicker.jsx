import React, { useState, useEffect, useRef } from 'react';

// Month names
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Convert YYYY-MM-DD to DD/MM/YYYY for display
const toDisplayDate = (isoDate) => {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
};

// Parse smart date text
const parseSmartDate = (input, baseDateStr) => {
    if (!input || !input.trim()) return null;
    const cleanText = input.trim().toLowerCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanText)) return cleanText;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanText)) {
        const [d, m, y] = cleanText.split('/');
        return `${y}-${m}-${d}`;
    }
    let clean = cleanText.replace(/[./\s]/g, '-');
    const monthMap = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };
    for (const [name, num] of Object.entries(monthMap)) {
        if (clean.includes(name)) { clean = clean.replace(name, num.toString()); break; }
    }
    const parts = clean.split('-').filter(p => p !== '');
    const base = new Date(baseDateStr || Date.now());
    const yyyy = base.getFullYear();
    const mm = base.getMonth();
    let d = 1, m = mm, y = yyyy;
    if (parts.length === 1) {
        const p0 = parseInt(parts[0]);
        if (isNaN(p0)) return null;
        d = p0;
    } else if (parts.length === 2) {
        const p0 = parseInt(parts[0]), p1 = parseInt(parts[1]);
        if (!isNaN(p0) && !isNaN(p1)) { d = p0; m = p1 - 1; }
        else if (!isNaN(p0)) { d = p0; }
        else if (!isNaN(p1)) { d = p1; m = p0 - 1; }
    } else if (parts.length === 3) {
        const p0 = parseInt(parts[0]), p1 = parseInt(parts[1]), p2 = parseInt(parts[2]);
        if (!isNaN(p0) && !isNaN(p1)) { d = p0; m = p1 - 1; if (!isNaN(p2)) y = p2 < 100 ? 2000 + p2 : p2; }
    }
    const newDate = new Date(y, m, d, 12, 0, 0);
    if (isNaN(newDate.getTime())) return null;
    return newDate.toISOString().split('T')[0];
};

/**
 * Beautiful Smart Calendar Picker
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   onSubmit: (isoDate: string) => void
 *   baseDate: string (YYYY-MM-DD) — currently selected date
 */
const CalendarPicker = ({ isOpen, onClose, onSubmit, baseDate }) => {
    const [viewYear, setViewYear] = useState(2026);
    const [viewMonth, setViewMonth] = useState(5); // 0-indexed
    const [selectedDate, setSelectedDate] = useState(null); // Date object
    const [textInput, setTextInput] = useState('');
    const [showTextInput, setShowTextInput] = useState(false);
    const panelRef = useRef(null);
    const textRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            const base = baseDate ? new Date(baseDate + 'T12:00:00') : new Date();
            if (!isNaN(base.getTime())) {
                setViewYear(base.getFullYear());
                setViewMonth(base.getMonth());
                setSelectedDate(base);
            } else {
                const now = new Date();
                setViewYear(now.getFullYear());
                setViewMonth(now.getMonth());
                setSelectedDate(now);
            }
            setTextInput('');
            setShowTextInput(false);
        }
    }, [isOpen, baseDate]);

    // Build calendar grid
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0=Sun

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const prevMonth = () => {
        if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
        else setViewMonth(viewMonth - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
        else setViewMonth(viewMonth + 1);
    };

    const handleDateClick = (day) => {
        const picked = new Date(viewYear, viewMonth, day, 12, 0, 0);
        setSelectedDate(picked);
        const iso = picked.toISOString().split('T')[0];
        onSubmit(iso);
    };

    const handleToday = () => {
        const now = new Date();
        const iso = now.toISOString().split('T')[0];
        setSelectedDate(now);
        setViewYear(now.getFullYear());
        setViewMonth(now.getMonth());
        onSubmit(iso);
    };

    const handleTextSubmit = () => {
        const res = parseSmartDate(textInput, baseDate || todayStr);
        if (res) {
            const parsed = new Date(res + 'T12:00:00');
            setSelectedDate(parsed);
            setViewYear(parsed.getFullYear());
            setViewMonth(parsed.getMonth());
            onSubmit(res);
        } else {
            textRef.current?.select();
        }
    };

    const handleTextKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleTextSubmit(); }
    };

    // Check if a date is selected
    const isSelected = (day) => {
        if (!selectedDate) return false;
        return selectedDate.getDate() === day &&
            selectedDate.getMonth() === viewMonth &&
            selectedDate.getFullYear() === viewYear;
    };
    const isToday = (day) => {
        const d = new Date(viewYear, viewMonth, day);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return ds === todayStr;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
            <div ref={panelRef} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-[320px] animate-in zoom-in-95 duration-150 overflow-hidden" onClick={e => e.stopPropagation()}>
                
                {/* HEADER */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 text-white">
                    <div className="flex items-center justify-between">
                        <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-lg font-bold">&#8249;</button>
                        <div className="text-center">
                            <div className="text-sm font-bold uppercase tracking-wider opacity-80">{MONTHS[viewMonth]}</div>
                            <div className="text-2xl font-black">{viewYear}</div>
                        </div>
                        <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-lg font-bold">&#8250;</button>
                    </div>
                </div>

                {/* CALENDAR GRID */}
                <div className="px-4 pb-2 pt-3">
                    {/* Day headers */}
                    <div className="grid grid-cols-7 mb-1">
                        {DAYS.map(d => (
                            <div key={d} className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider py-1">{d}</div>
                        ))}
                    </div>

                    {/* Date cells */}
                    <div className="grid grid-cols-7">
                        {/* Empty cells before first day */}
                        {Array.from({ length: startDayOfWeek }).map((_, i) => (
                            <div key={`empty-${i}`} className="p-1" />
                        ))}
                        {/* Day cells */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const sel = isSelected(day);
                            const tod = isToday(day);
                            return (
                                <button
                                    key={day}
                                    onClick={() => handleDateClick(day)}
                                    className={`
                                        w-full aspect-square rounded-xl text-sm font-bold transition-all
                                        ${sel
                                            ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-105'
                                            : tod
                                                ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                                                : 'text-slate-700 hover:bg-slate-100'
                                        }
                                    `}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* FOOTER */}
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2">
                    {/* Quick actions */}
                    <div className="flex items-center gap-2">
                        <button onClick={handleToday} className="flex-1 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-colors">
                            Today
                        </button>
                        {selectedDate && (
                            <div className="text-xs font-bold text-slate-500 px-2">
                                {toDisplayDate(selectedDate.toISOString().split('T')[0])}
                            </div>
                        )}
                    </div>

                    {/* Smart text input toggle */}
                    {showTextInput ? (
                        <div className="flex gap-2 items-center">
                            <input
                                ref={textRef}
                                type="text"
                                placeholder="e.g. 15-mar, apr, 20-jun-25"
                                className="flex-1 px-3 py-2 text-sm border border-blue-200 rounded-xl outline-none focus:border-blue-400 font-bold text-center"
                                value={textInput}
                                onChange={e => setTextInput(e.target.value)}
                                onKeyDown={handleTextKey}
                                autoFocus
                            />
                            <button onClick={handleTextSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors">
                                Go
                            </button>
                            <button onClick={() => setShowTextInput(false)} className="p-2 text-slate-400 hover:text-slate-600">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => { setShowTextInput(true); setTimeout(() => textRef.current?.focus(), 50); }} className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-blue-600 border border-dashed border-slate-200 rounded-xl hover:border-blue-200 transition-colors">
                            &#9998; Type smart date (feb, 15-mar, 20-apr-25...)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CalendarPicker;
