/**
 * Finished-package label (company-wide wording).
 *
 * The whole app talks about "Bags" — but some companies pack pipes, rolls, drums…
 * The owner can rename that single word once and every screen uses it.
 *
 * Kept in a tiny external store (not context) so any module — vouchers, reports,
 * dashboards — can read/observe it with `usePackageLabel()` without prop drilling.
 * Persisted on the company document (`rules.packageLabel`) by the caller.
 */
import { useEffect, useState } from 'react';

export const DEFAULT_PACKAGE_LABEL = 'Bags';

let currentLabel = DEFAULT_PACKAGE_LABEL;
const subscribers = new Set();

const normalize = (value) => {
    const v = String(value == null ? '' : value).trim();
    return v || DEFAULT_PACKAGE_LABEL;
};

/** Current label, for non-React code paths. */
export const getPackageLabel = () => currentLabel;

/** Plural form, e.g. "Pipes". */
export const getPackageLabelPlural = () => currentLabel;

/** Single unit form: "Bag" -> "Pipe" (naive singularisation, good enough for a label). */
export const getPackageLabelSingular = () => {
    const l = currentLabel;
    if (/ies$/i.test(l)) return l.replace(/ies$/i, 'y');
    if (/(ses|xes|ches|shes)$/i.test(l)) return l.replace(/es$/i, '');
    if (/s$/i.test(l) && !/ss$/i.test(l)) return l.replace(/s$/i, '');
    return l;
};

/** Upper-case short form used in chips/badges ("BAGS" -> "PIPES"). */
export const getPackageLabelUpper = () => currentLabel.toUpperCase();

/** Push a new label into the store and re-render every subscribed component. */
export const setPackageLabel = (value) => {
    const next = normalize(value);
    if (next === currentLabel) return currentLabel;
    currentLabel = next;
    subscribers.forEach((fn) => {
        try { fn(next); } catch (e) { /* ignore subscriber errors */ }
    });
    return currentLabel;
};

/**
 * Reads the label saved on a company document.
 * Falls back to the LOCAL per-company cache when the freshly loaded profile does not carry
 * the field yet (e.g. a stale cached company doc arriving right after a save) — this is what
 * used to make the name flip back to "Bags" by itself ~1 minute after being changed.
 */
export const packageLabelFromProfile = (profile, companyId) => {
    const fromDoc = profile?.rules?.packageLabel ?? profile?.packageLabel;
    if (fromDoc) return normalize(fromDoc);
    const cached = readCachedPackageLabel(companyId);
    return cached ? normalize(cached) : DEFAULT_PACKAGE_LABEL;
};

/* ── PER-COMPANY LOCAL CACHE ────────────────────────────────────────────── */
const CACHE_PREFIX = 'accpro_pkg_label_v1_';

/** Last known wording for a company (survives reloads / stale profile loads). */
export const readCachedPackageLabel = (companyId) => {
    try {
        return localStorage.getItem(CACHE_PREFIX + String(companyId || '')) || '';
    } catch (e) {
        return '';
    }
};

/** Remembers the wording for one company only (keyed by company id). */
export const cachePackageLabelLocally = (companyId, label) => {
    try {
        localStorage.setItem(CACHE_PREFIX + String(companyId || ''), normalize(label));
    } catch (e) { /* storage full / private mode — ignore */ }
};

/* ── COMPANY SCOPING ───────────────────────────────────────────────────────
   The wording belongs to ONE company. The store remembers which company it is
   currently holding, and resets to the default the moment the open company
   changes — so a name saved for company A can never bleed into company B. */
let currentCompanyId = null;

/** Which company the current label belongs to ('' = none open yet). */
export const getPackageLabelCompany = () => currentCompanyId;

/**
 * Points the store at `companyId` and applies that company's saved wording.
 * Switching company always clears the previous wording first.
 */
export const syncPackageLabelForCompany = (companyId, profile) => {
    const key = String(companyId || '');
    if (key !== currentCompanyId) {
        currentCompanyId = key;
        setPackageLabel(DEFAULT_PACKAGE_LABEL); // never carry A's name into B
    }
    const label = packageLabelFromProfile(profile, key);
    setPackageLabel(label);
    return label;
};

/** React hook — subscribes the component to label changes. */
export const usePackageLabel = () => {
    const [label, setLabel] = useState(currentLabel);
    useEffect(() => {
        const fn = (v) => setLabel(v);
        subscribers.add(fn);
        fn(currentLabel);
        return () => subscribers.delete(fn);
    }, []);
    return label;
};
