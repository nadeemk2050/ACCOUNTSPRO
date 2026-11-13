/**
 * aiGateway.js
 * ---------------------------------------------------------------------------
 * The ONLY place in the whole support module that talks to the internet.
 *
 * WHEN IT RUNS
 *   Never on its own. It is called only when:
 *     - the local search found nothing (a real "miss"), and
 *     - the AI fallback is switched on.
 *
 * WHAT IS SENT
 *   The question text, plus a list of ACCPRO feature names and existing help
 *   questions so the model answers in the right context.
 *   NO company data, NO vouchers, NO parties, NO balances, NO company id.
 *
 * KEY HANDLING — read this before changing anything
 *   Front-end bundles are public. Any key compiled into the app can be read by
 *   anyone who opens the browser dev tools. So the key is resolved in this
 *   order and is never written into source code:
 *     1. a key typed by the user on their own device (localStorage)
 *     2. import.meta.env.VITE_SUPPORT_AI_KEY   (from .env.local, git-ignored)
 *   For a public release the correct setup is a small server proxy that holds
 *   the key (Firebase Cloud Function). The interface below stays the same.
 */

import { safeGetItem, safeSetItem, safeRemoveItem } from '../safeStorage';
import { ALL_FEATURES } from './featureCatalogue';
import { FAQ_DATA } from './faqData';

const KEY_STORE = 'accpro_support_ai_key';
const ENABLE_STORE = 'accpro_support_ai_enabled';
const CACHE_STORE = 'accpro_support_ai_cache_v1';

export const AI_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const AI_MODEL = 'deepseek-flash';
const TIMEOUT_MS = 45000;
const CACHE_MAX = 200;

/* ── key + switch ────────────────────────────────────────────────────────── */

/* Vite replaces this exact expression at build time. Do not add optional chaining. */
const BUILD_KEY = (() => {
    try {
        return String(import.meta.env.VITE_SUPPORT_AI_KEY || '').trim();
    } catch {
        return '';
    }
})();

export const getAiKey = () => {
    try {
        const local = safeGetItem(KEY_STORE);
        if (local && local.trim()) return local.trim();
    } catch {
        /* ignore */
    }
    return BUILD_KEY;
};

/** True when the key ships with the app, so no user ever has to type one. */
export const hasBuiltInKey = () => BUILD_KEY.length > 10;

export const setAiKey = (key = '') => {
    try {
        const k = String(key || '').trim();
        if (k) safeSetItem(KEY_STORE, k);
        else safeRemoveItem(KEY_STORE);
        return true;
    } catch {
        return false;
    }
};

/**
 * Enabled by default for everyone.
 * It is only off when (a) there is no key at all, or (b) this device switched
 * it off on purpose in the AI panel.
 */
export const isAiEnabled = () => {
    if (!getAiKey()) return false;
    try {
        if (safeGetItem(ENABLE_STORE) === '0') return false;
    } catch {
        /* ignore */
    }
    return true;
};

export const setAiEnabled = (on) => {
    try {
        safeSetItem(ENABLE_STORE, on ? '1' : '0');
        return true;
    } catch {
        return false;
    }
};

export const aiKeySource = () => {
    try {
        const local = safeGetItem(KEY_STORE);
        if (local && local.trim()) return 'device';
    } catch {
        /* ignore */
    }
    return BUILD_KEY ? 'build' : 'none';
};

/* ── tiny response cache (same question twice = free) ─────────────────────── */

const normQ = (q = '') =>
    String(q || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

const readCache = () => {
    try {
        const raw = safeGetItem(CACHE_STORE);
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === 'object' ? obj : {};
    } catch {
        return {};
    }
};

const writeCache = (cache) => {
    try {
        const entries = Object.entries(cache).slice(0, CACHE_MAX);
        safeSetItem(CACHE_STORE, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        /* cache is optional — never fail a request because of it */
    }
};

/* ── prompt ──────────────────────────────────────────────────────────────── */

let contextCache = null;
const buildContext = () => {
    if (contextCache) return contextCache;
    const features = ALL_FEATURES.map((f) => f.name).join('; ');
    const questions = FAQ_DATA.map((f) => f.q).join(' | ');
    contextCache = { features, questions };
    return contextCache;
};

const SYSTEM_PROMPT = () => {
    const { features, questions } = buildContext();
    return [
        'You are the built-in support assistant of ACCPRO, an offline-first accounting application used by small businesses in the Gulf (UAE, Saudi, India).',
        '',
        'The app contains these modules: company setup, masters (ledgers, parties/customers, suppliers, items, groups, units, currencies, tax rates), vouchers (payment, receipt, contra, journal, stock journal, purchase, sales, credit note, debit note, orders), registers, reports (ledger, day book, P&L, balance sheet, closing stock, FIFO valuation), stock with lots and bags, manufacturing (BOM), backup/restore, cloud sync between PCs, users and roles, system rules, licences.',
        '',
        'Answer the user question about how to use this app.',
        'Rules:',
        '- Describe only what such an app can do. If the question is not about using ACCPRO, set known to false.',
        '- Be concrete and short: the menu path, then 3 to 6 numbered steps, maximum 120 words.',
        '- Plain text only. No markdown tables, no emoji, no headings.',
        '- Never say that you performed an action, saved, deleted or changed anything.',
        '- If the user asks for data from their own books, explain that you cannot see company data and tell them where in the app to look.',
        '',
        'Existing feature names (context only):',
        features,
        '',
        'Existing help questions (context and style guide):',
        questions,
        '',
        'Reply with JSON only, exactly this shape:',
        '{"answer":"the answer text","keywords":["3 to 6 short lowercase search words"],"known":true}',
    ].join('\n');
};

/* ── the call ────────────────────────────────────────────────────────────── */

/**
 * @param {string} question
 * @returns {Promise<{ok:boolean, answer?:string, keywords?:string[], cached?:boolean, error?:string}>}
 */
export async function askAi(question, attempt = 0) {
    const q = String(question || '').trim();
    if (q.length < 4) return { ok: false, error: 'Question is too short.' };

    const key = getAiKey();
    if (!key) return { ok: false, error: 'No AI key configured on this device.' };

    const cacheKey = normQ(q);
    const cache = readCache();
    if (cache[cacheKey] && cache[cacheKey].answer) {
        return { ok: true, answer: cache[cacheKey].answer, keywords: cache[cacheKey].keywords || [], cached: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT() },
                    { role: 'user', content: q },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 1400,
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const hint =
                res.status === 401
                    ? 'The AI key was rejected.'
                    : res.status === 402
                        ? 'The AI account has no credit.'
                        : res.status === 429
                            ? 'Too many AI requests — please wait a moment.'
                            : `AI request failed (${res.status}).`;
            return { ok: false, error: `${hint} ${text.slice(0, 160)}`.trim() };
        }

        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content || '';
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = { answer: String(raw || '').trim(), keywords: [], known: true };
        }

        const answer = String(parsed?.answer || '').trim();
        const keywords = Array.isArray(parsed?.keywords) ? parsed.keywords.map((k) => String(k).toLowerCase()).slice(0, 8) : [];

        if (!answer) return { ok: false, error: 'The AI returned an empty answer.' };

        cache[cacheKey] = { answer, keywords, ts: Date.now() };
        writeCache(cache);

        return { ok: true, answer, keywords, known: parsed?.known !== false };
    } catch (err) {
        const aborted = err?.name === 'AbortError';
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        // one quiet retry for a dropped connection — very common on mobile data
        if (!aborted && !offline && attempt < 1) return askAi(q, attempt + 1);

        let msg;
        if (aborted) msg = 'The AI request timed out. Please try again.';
        else if (offline) msg = 'This device appears to be offline. Reconnect and try again.';
        else if (err?.name === 'TypeError')
            msg =
                'The AI service could not be reached. Usually this means the request was blocked — by the app security policy (connect-src), by an ad/script blocker, or by the network.';
        else msg = `Could not reach the AI service (${err?.message || 'unknown error'}).`;

        return { ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

/** Cheap connectivity / key check used by the settings panel. */
export async function testAi() {
    const res = await askAi('What is a contra voucher and when is it used?');
    return res.ok ? { ok: true, sample: res.answer.slice(0, 180) } : res;
}
