import React, { useState, useEffect } from 'react';

// Convert YYYY-MM-DD to DD/MM/YYYY for display
const toDisplayDate = (isoDate) => {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
};

// --- DATE INPUT COMPONENT (DD/MM/YYYY FORMAT) ---
const DateInput = ({ value, onChange, className = "", ...props }) => {
    const [displayValue, setDisplayValue] = useState("");

    useEffect(() => {
        if (value) {
            setDisplayValue(toDisplayDate(value));
        } else {
            setDisplayValue("");
        }
    }, [value]);

    const handleChange = (e) => {
        let input = e.target.value.replace(/[^0-9/]/g, "");
        
        // Auto-insert slashes
        if (input.length === 2 || input.length === 5) {
            if (!input.endsWith("/")) input += "/";
        }
        
        // Limit to DD/MM/YYYY format
        if (input.length > 10) input = input.substring(0, 10);
        
        setDisplayValue(input);
        
        // If complete date, convert to ISO and call onChange
        if (input.length === 10) {
            const [day, month, year] = input.split("/");
            if (day && month && year && day.length === 2 && month.length === 2 && year.length === 4) {
                const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                // Validate date
                const dateObj = new Date(isoDate);
                if (!isNaN(dateObj.getTime())) {
                    onChange({ target: { value: isoDate } });
                }
            }
        }
    };

    const handleBlur = () => {
        // Try to parse partial dates
        if (displayValue && displayValue.length > 0 && displayValue.length < 10) {
            const parts = displayValue.split("/");
            if (parts.length >= 2) {
                const day = parts[0]?.padStart(2, '0') || '01';
                const month = parts[1]?.padStart(2, '0') || '01';
                const year = parts[2] || new Date().getFullYear().toString();
                const completeDate = `${day}/${month}/${year}`;
                setDisplayValue(completeDate);
                const isoDate = `${year}-${month}-${day}`;
                onChange({ target: { value: isoDate } });
            }
        }
    };

    return (
        <input
            type="text"
            value={displayValue}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="DD/MM/YYYY"
            className={className}
            {...props}
        />
    );
};

export default DateInput;
