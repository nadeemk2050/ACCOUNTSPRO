import React, { useState, useEffect, useRef } from 'react';

// Convert YYYY-MM-DD to DD/MM/YYYY for display
const toDisplayDate = (isoDate) => {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
};

// Smart date parser: understands "feb", "mar", "april", "15-mar", "15-mar-25", etc.
const parseSmartDate = (input, baseDateStr) => {
    if (!input || !input.trim()) return null;
    const cleanText = input.trim().toLowerCase();

    // If it's already ISO format (YYYY-MM-DD), return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanText)) return cleanText;
    // If it's already DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanText)) {
        const [d, m, y] = cleanText.split('/');
        return `${y}-${m}-${d}`;
    }

    // Support slash, dot, space, or dash separators
    let clean = cleanText.replace(/[./\s]/g, '-');

    // Month name support
    const monthMap = {
        jan: 1, january: 1,
        feb: 2, february: 2,
        mar: 3, march: 3,
        apr: 4, april: 4,
        may: 5,
        jun: 6, june: 6,
        jul: 7, july: 7,
        aug: 8, august: 8,
        sep: 9, sept: 9, september: 9,
        oct: 10, october: 10,
        nov: 11, november: 11,
        dec: 12, december: 12
    };

    // Try to find and replace month names with numbers
    for (const [name, num] of Object.entries(monthMap)) {
        if (clean.includes(name)) {
            clean = clean.replace(name, num.toString());
            break;
        }
    }

    const parts = clean.split('-').filter(p => p !== '');
    const base = new Date(baseDateStr || Date.now());
    const yyyy = base.getFullYear();
    const mm = base.getMonth(); // 0-indexed

    let d = 1, m = mm, y = yyyy;

    if (parts.length === 1) {
        // "15" -> 15th of current month
        // "feb" or "5" — if it's a word, might be just month name
        const p0 = parseInt(parts[0]);
        if (isNaN(p0)) return null;
        d = p0;
    } else if (parts.length === 2) {
        // "15-2" or "20-apr" or "feb-15"
        const p0 = parseInt(parts[0]);
        const p1 = parseInt(parts[1]);
        if (!isNaN(p0) && !isNaN(p1)) {
            d = p0; m = p1 - 1;
        } else if (!isNaN(p0)) {
            d = p0; m = mm;
        } else if (!isNaN(p1)) {
            d = p1; m = p0 - 1;
        }
    } else if (parts.length === 3) {
        // "15-2-25" or "20-apr-2025"
        const p0 = parseInt(parts[0]);
        const p1 = parseInt(parts[1]);
        let p2 = parseInt(parts[2]);
        if (!isNaN(p0) && !isNaN(p1)) {
            d = p0; m = p1 - 1;
            if (!isNaN(p2)) {
                if (p2 < 100) y = 2000 + p2; else y = p2;
            }
        }
    }

    const newDate = new Date(y, m, d, 12, 0, 0);
    if (isNaN(newDate.getTime())) return null;
    return newDate.toISOString().split('T')[0];
};

const DateInput = ({ value, onChange, className = "", onEnter, ...props }) => {
    const [displayValue, setDisplayValue] = useState("");
    const [isFirstChar, setIsFirstChar] = useState(true);
    const inputRef = useRef(null);

    useEffect(() => {
        if (value) {
            setDisplayValue(toDisplayDate(value));
        } else {
            setDisplayValue("");
        }
    }, [value]);

    const handleChange = (e) => {
        let input = e.target.value;

        // Detect if user is typing letters (month names) — bypass numeric-only filter
        const hasLetters = /[a-zA-Z]/.test(input);

        // If it's the first character typed after focus, replace the whole value
        if (isFirstChar && input.length > 0) {
            const lastChar = input.slice(-1);
            if (/[0-9]/.test(lastChar)) {
                input = lastChar;
            }
            setIsFirstChar(false);
        }

        if (hasLetters) {
            // Allow month name input — just store as-is for smart parsing on blur
            setDisplayValue(input);
            return;
        }

        input = input.replace(/[^0-9/]/g, "");

        // Auto-insert slashes
        if (input.length === 2 || input.length === 5) {
            if (!input.endsWith("/") && !e.nativeEvent.inputType?.includes("delete")) {
                input += "/";
            }
        }

        if (input.length > 10) input = input.substring(0, 10);
        setDisplayValue(input);
    };

    const handleFocus = (e) => {
        setIsFirstChar(true);
    };

    const finalizeDate = () => {
        if (!displayValue) return;

        const raw = displayValue.trim();

        // Try smart parsing first (handles month names, partial dates)
        const smartResult = parseSmartDate(raw, value);
        if (smartResult) {
            onChange({ target: { value: smartResult } });
            setDisplayValue(toDisplayDate(smartResult));
            return;
        }

        // Fallback: manual DD/MM/YYYY parsing (legacy behavior)
        let day, month, year;
        const parts = raw.split('/');
        let refDate = new Date();
        if (value) refDate = new Date(value);
        const refMonth = (refDate.getMonth() + 1).toString().padStart(2, '0');
        const refYear = refDate.getFullYear().toString();

        if (parts.length === 1 && parts[0].length > 0) {
            day = parts[0].padStart(2, '0');
            month = refMonth;
            year = refYear;
        } else if (parts.length === 2) {
            day = parts[0].padStart(2, '0');
            month = parts[1].padStart(2, '0');
            year = refYear;
        } else if (parts.length === 3) {
            day = parts[0].padStart(2, '0');
            month = parts[1].padStart(2, '0');
            year = parts[2];
            if (year.length === 2) year = "20" + year;
            if (year.length === 0) year = refYear;
        } else {
            return;
        }

        const isoDate = `${year}-${month}-${day}`;
        const dateObj = new Date(isoDate);
        if (!isNaN(dateObj.getTime())) {
            onChange({ target: { value: isoDate } });
            setDisplayValue(`${day}/${month}/${year}`);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || (e.ctrlKey && e.key.toLowerCase() === 'a')) {
            e.preventDefault();
            finalizeDate();
            if (onEnter) onEnter();
        }
    };

    return (
        <input
            ref={inputRef}
            type="text"
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={finalizeDate}
            onKeyDown={handleKeyDown}
            placeholder="DD/MM/YYYY"
            className={className}
            {...props}
        />
    );
};

export default DateInput;
