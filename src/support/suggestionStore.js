/**
 * suggestionStore.js
 * ---------------------------------------------------------------------------
 * Saves advice / suggestions / recommendations typed by the user.
 *
 * RULES (deliberate)
 *  - Device-local only. Nothing is sent anywhere, no network call, no AI.
 *  - It stores ONLY what the user typed: name, email, the suggestion text and
 *    the date. It never touches a voucher, a party, a balance or a company.
 *  - Quota-proof: goes through safeStorage, so a full disk can never break it.
 *
 * Because it is device-local, the list is per computer/browser. That is why the
 * UI always offers "Copy all" and "Download file" so the ideas can be sent to
 * the developer by email or WhatsApp without any server being involved.
 */

import { safeGetItem, safeSetItem, safeRemoveItem } from '../safeStorage';

export const SUGGESTIONS_KEY = 'accpro_support_suggestions_v1';
export const SUGGESTION_MAX = 200;

const clean = (v = '', max = 2000) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

export const isValidEmail = (email = '') =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());

/** Read the saved list. Never throws. */
export function loadSuggestions() {
    try {
        const raw = safeGetItem(SUGGESTIONS_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((s) => s && s.id && s.text) : [];
    } catch {
        return [];
    }
}

function persist(list) {
    try {
        safeSetItem(SUGGESTIONS_KEY, JSON.stringify(list));
        return true;
    } catch {
        return false;
    }
}

/**
 * Add one suggestion.
 * @returns {{ ok: boolean, item?: object, error?: string }}
 */
export function saveSuggestion({ name, email, text, category = '', verdict = '', matchedIds = [] } = {}) {
    const n = clean(name, 80);
    const m = clean(email, 120).toLowerCase();
    const t = clean(text, 1500);

    if (!n) return { ok: false, error: 'Please enter your name.' };
    if (!isValidEmail(m)) return { ok: false, error: 'Please enter a valid email address.' };
    if (t.length < 15) return { ok: false, error: 'Please describe the idea in a little more detail (15 characters or more).' };

    const item = {
        id: `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        name: n,
        email: m,
        text: t,
        category: clean(category, 40),
        verdict: clean(verdict, 20),
        matchedIds: Array.isArray(matchedIds) ? matchedIds.slice(0, 8) : [],
        status: 'new',
    };

    const list = [item, ...loadSuggestions()].slice(0, SUGGESTION_MAX);
    if (!persist(list)) return { ok: false, error: 'Could not save on this device (storage is full). Please copy the text instead.' };
    return { ok: true, item };
}

export function deleteSuggestion(id) {
    const list = loadSuggestions().filter((s) => s.id !== id);
    return persist(list);
}

export function clearSuggestions() {
    try {
        safeRemoveItem(SUGGESTIONS_KEY);
        return true;
    } catch {
        return false;
    }
}

/** Plain-text block of every saved suggestion — for email / WhatsApp. */
export function suggestionsToText(list = loadSuggestions()) {
    if (!list.length) return '';
    const head = `ACCPRO — suggestions (${list.length})\nExported: ${new Date().toLocaleString()}\n`;
    const body = list
        .map((s, i) => {
            const parts = [
                `${i + 1}. ${s.date} — ${s.name} <${s.email}>`,
                s.category ? `   Area: ${s.category}` : '',
                `   ${s.text}`,
                s.verdict === 'existing' ? `   (matched existing: ${(s.matchedIds || []).join(', ')})` : '',
            ];
            return parts.filter(Boolean).join('\n');
        })
        .join('\n\n');
    return `${head}\n${body}\n`;
}

/** Trigger a .txt download of the list. Browser only. */
export function downloadSuggestions(list = loadSuggestions()) {
    try {
        const blob = new Blob([suggestionsToText(list)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `accpro-suggestions-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    } catch {
        return false;
    }
}
