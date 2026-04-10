import React, { useState, useEffect, useRef } from 'react';

// Convert YYYY-MM-DD to DD/MM/YYYY for display
const toDisplayDate = (isoDate) => {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
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
        
        // If it's the first character typed after focus, replace the whole value
        if (isFirstChar && input.length > 0) {
            // Check if we just added one character
            const lastChar = input.slice(-1);
            if (/[0-9]/.test(lastChar)) {
                input = lastChar;
            }
            setIsFirstChar(false);
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
        
        // If complete date, convert and sync (optional, usually blur is better for Tally)
    };

    const handleFocus = (e) => {
        setIsFirstChar(true);
        // Optional: select all to give feedback
        // e.target.select(); 
    };

    const finalizeDate = () => {
        if (!displayValue) return;

        let day, month, year;
        const parts = displayValue.split('/');
        const today = new Date();
        const currentYear = today.getFullYear().toString();
        const currentMonth = (today.getMonth() + 1).toString().padStart(2, '0');

        // Reference date from the current value if available, else today
        let refDate = new Date();
        if (value) refDate = new Date(value);
        const refMonth = (refDate.getMonth() + 1).toString().padStart(2, '0');
        const refYear = refDate.getFullYear().toString();

        if (parts.length === 1 && parts[0].length > 0) {
            // "5" -> 05/refMonth/refYear
            day = parts[0].padStart(2, '0');
            month = refMonth;
            year = refYear;
        } else if (parts.length === 2) {
            // "5/10" -> 05/10/refYear
            day = parts[0].padStart(2, '0');
            month = parts[1].padStart(2, '0');
            year = refYear;
        } else if (parts.length === 3) {
            day = parts[0].padStart(2, '0');
            month = parts[1].padStart(2, '0');
            year = parts[2];
            if (year.length === 2) year = "20" + year; // 24 -> 2024
            if (year.length === 0) year = refYear;
        } else {
            return;
        }

        // Final validation
        const isoDate = `${year}-${month}-${day}`;
        const dateObj = new Date(isoDate);
        if (!isNaN(dateObj.getTime())) {
            onChange({ target: { value: isoDate } });
            setDisplayValue(`${day}/${month}/${year}`);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
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
