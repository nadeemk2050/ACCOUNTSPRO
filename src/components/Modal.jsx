import React, { useState, useEffect, useRef } from 'react';
import { X, Maximize, Minimize2, ArrowRight } from 'lucide-react';

export const Modal = ({
    isOpen,
    onClose,
    onBack,
    title,
    children,
    maxWidth = "max-w-md",
    zIndex = 50,
    defaultMaximized = false,
    centerTitle = false,
    removePadding = false,
    noContentScroll = false,
    hideHeader = false,
    headerClassName = "",
    footer = null,
    footerClassName = ""
}) => {
    if (!isOpen) return null;

    // ... (rest of the component logic)
    const [isMaximized, setIsMaximized] = useState(defaultMaximized);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (isOpen) {
            setPosition({ x: 0, y: 0 });
            setIsMaximized(defaultMaximized);
        }
    }, [isOpen, defaultMaximized]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isOpen && e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
            if (isOpen && (e.altKey && e.key === 'ArrowLeft')) {
                e.stopPropagation();
                if (onBack) onBack();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onBack]);

    const handleMouseDown = (e) => {
        if (isMaximized) return;
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.no-drag')) return;
        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            setPosition({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            });
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const modalStyle = isMaximized
        ? { transform: 'none' }
        : { transform: `translate(${position.x}px, ${position.y}px)` };

    const containerClasses = isMaximized
        ? "fixed inset-0 w-full h-full rounded-none border-0 m-0"
        : `relative w-full ${maxWidth} rounded-xl shadow-2xl max-h-[90vh] flex flex-col`;

    return (
        <div
            className={`fixed inset-0 flex items-center justify-center ${(removePadding || isMaximized) ? 'p-0' : 'p-4'} bg-black/40 backdrop-blur-[2px] overflow-hidden`}
            style={{ zIndex: zIndex }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={modalStyle}
                className={`bg-white transition-all duration-75 flex flex-col ${containerClasses} overflow-hidden`}
            >
                {/* Header - Draggable */}
                {!hideHeader && (
                    <div
                        className={`relative flex justify-between items-center p-4 border-b border-gray-100 bg-slate-50 select-none ${isMaximized ? '' : 'cursor-move'} ${headerClassName}`}
                        onMouseDown={handleMouseDown}
                    >
                        <div className="flex items-center gap-2 z-10">
                            {onBack && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onBack(); }}
                                    className={`p-1.5 rounded transition-colors ${headerClassName ? 'hover:bg-white/10 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
                                    title="Back (Alt+Left)"
                                >
                                    <ArrowRight size={18} className="rotate-180" />
                                </button>
                            )}

                            {!centerTitle && <h3 className={`text-xl font-bold ${headerClassName ? 'text-white' : 'text-blue-900'} text-3d-elegant`}>{title}</h3>}
                        </div>

                        {centerTitle && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <h3 className={`text-xl font-bold ${headerClassName ? 'text-white' : 'text-blue-900'} text-3d-elegant`}>{title}</h3>
                            </div>
                        )}

                        <div className="flex items-center gap-2 no-drag z-10">
                            <button
                                onClick={(e) => { e.stopPropagation(); onClose(); }}
                                className={`p-1.5 rounded transition-colors ${headerClassName ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-red-100 text-slate-400 hover:text-red-500'}`}
                                title="Close (Esc)"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                )}

                <div className={`${removePadding ? '' : 'p-4'} ${noContentScroll ? 'overflow-hidden' : 'overflow-y-auto'} flex-1 flex flex-col`}>
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className={`p-4 border-t border-gray-100 ${footerClassName}`}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};


export default Modal;
