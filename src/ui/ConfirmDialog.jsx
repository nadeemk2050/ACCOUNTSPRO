import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';

/**
 * ConfirmDialog
 * ---------------------------------------------------------------------------
 * A replacement for window.confirm().
 *
 * WHY
 *   The browser's own confirm() cannot be styled: it always shows
 *   "<site> says", the buttons are always OK / Cancel, and it cannot react to a
 *   key press. This dialog is ours, so it can say Yes / No and answer to Y / N.
 *
 * HOW TO USE
 *   1. <ConfirmHost /> is mounted once near the root of the app.
 *   2. Anywhere:
 *        if (!(await confirmAction('Are you sure you want to save the changes?'))) return;
 *      The call site must be inside an async function.
 *
 * KEYS
 *   Y  → Yes      N → No      Enter → Yes      Esc → No
 *   The listener runs in the capture phase and stops propagation, so a voucher
 *   screen's own shortcuts cannot react to the same key press.
 */

/* ── tiny channel between the caller and the mounted host ────────────────── */

let pendingResolve = null;
let setRequestState = null;

/**
 * @param {string|{title?:string,message?:string,yesLabel?:string,noLabel?:string,danger?:boolean}} input
 * @returns {Promise<boolean>}
 */
export function confirmAction(input) {
    const opts =
        typeof input === 'string'
            ? { message: input }
            : { ...(input || {}) };

    return new Promise((resolve) => {
        if (!setRequestState) {
            // Host not mounted — never block the user; fall back to the browser.
            resolve(window.confirm(opts.message || 'Are you sure?'));
            return;
        }
        // If something was already waiting, cancel it first.
        if (pendingResolve) {
            const prev = pendingResolve;
            pendingResolve = null;
            prev(false);
        }
        pendingResolve = resolve;
        setRequestState({
            title: opts.title || 'Please confirm',
            message: opts.message || 'Are you sure?',
            yesLabel: opts.yesLabel || 'Yes',
            noLabel: opts.noLabel || 'No',
            danger: !!opts.danger,
        });
    });
}

/* ── the host ────────────────────────────────────────────────────────────── */

export function ConfirmHost() {
    const [req, setReq] = useState(null);
    const yesRef = useRef(null);
    const mySetter = useRef(null);

    useEffect(() => {
        // Register this host. Two hosts can be mounted at once (the licence gate
        // and the app), so only the most recent one answers, and a host that
        // unmounts must not clear a newer registration.
        const mine = setReq;
        mySetter.current = mine;
        setRequestState = mine;
        return () => {
            if (setRequestState === mine) setRequestState = null;
        };
    }, []);

    const answer = (value) => {
        const resolve = pendingResolve;
        pendingResolve = null;
        setReq(null);
        if (resolve) resolve(value);
    };

    useEffect(() => {
        if (!req) return undefined;

        const onKey = (e) => {
            const k = String(e.key || '').toLowerCase();
            if (k === 'y' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                answer(true);
                return;
            }
            if (k === 'n' || e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                answer(false);
            }
        };

        window.addEventListener('keydown', onKey, true);
        const t = setTimeout(() => yesRef.current?.focus(), 30);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [req]);

    if (!req) return null;

    return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
                {/* header */}
                <div className={`flex items-center gap-2 px-3 py-2 text-white ${req.danger ? 'bg-gradient-to-r from-rose-600 to-rose-700' : 'bg-gradient-to-r from-[#005ea8] to-[#00457c]'}`}>
                    <AlertCircle size={15} />
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] leading-none">{req.title}</div>
                </div>

                {/* message */}
                <div className="px-4 py-4">
                    <p className="text-[13px] font-semibold leading-relaxed text-slate-700">{req.message}</p>
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        Press <span className="rounded bg-slate-100 px-1 text-slate-600">Y</span> for {req.yesLabel} ·{' '}
                        <span className="rounded bg-slate-100 px-1 text-slate-600">N</span> for {req.noLabel}
                    </p>
                </div>

                {/* buttons */}
                <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
                    <button
                        type="button"
                        onClick={() => answer(false)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-100"
                    >
                        <X size={11} /> {req.noLabel}
                    </button>
                    <button
                        ref={yesRef}
                        type="button"
                        onClick={() => answer(true)}
                        className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white ${req.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#005994] hover:bg-[#00457c]'}`}
                    >
                        <Check size={11} /> {req.yesLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmHost;
