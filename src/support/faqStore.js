/**
 * faqStore.js
 * ---------------------------------------------------------------------------
 * The "learned brain".
 *
 * The shipped FAQ list (faqData.js) is static — it is compiled into the bundle
 * and can never be written to at runtime. So answers that come back from the
 * AI are stored here instead, on the device, and merged into the search index
 * at the moment the Support page opens.
 *
 * Effect: the second time the same question is asked, it is answered locally
 * with zero network calls and zero cost.
 *
 * Stored fields: id, q, a, keywords, aliases, source ('ai'), ts, hits.
 * Nothing here is company data — only question/answer text.
 */

import { safeGetItem, safeSetItem, safeRemoveItem } from '../safeStorage';

export const LEARNED_KEY = 'accpro_support_learned_faqs_v1';
export const LEARNED_MAX = 400;

const clean = (v = '', max = 4000) => String(v || '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

const normKey = (q = '') =>
    String(q || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

export function loadLearnedFaqs() {
    try {
        const raw = safeGetItem(LEARNED_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((x) => x && x.q && x.a) : [];
    } catch {
        return [];
    }
}

const persist = (list) => {
    try {
        safeSetItem(LEARNED_KEY, JSON.stringify(list.slice(0, LEARNED_MAX)));
        return true;
    } catch {
        return false;
    }
};

/**
 * Store one AI answer. A repeated question updates the existing entry instead
 * of adding a duplicate (this is what keeps the list from growing forever).
 */
export function saveLearnedFaq({ q, a, keywords = [], source = 'ai' } = {}) {
    const question = clean(q, 300);
    const answer = clean(a, 3000);
    if (question.length < 4 || answer.length < 10) return null;

    const list = loadLearnedFaqs();
    const key = normKey(question);
    const existing = list.find((x) => normKey(x.q) === key);

    if (existing) {
        existing.a = answer;
        existing.keywords = keywords.length ? keywords : existing.keywords || [];
        existing.ts = Date.now();
        existing.hits = (existing.hits || 1) + 1;
        persist(list);
        return existing;
    }

    const item = {
        id: `lf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        q: question,
        a: answer,
        keywords: (keywords || []).map((k) => clean(k, 40).toLowerCase()).filter(Boolean).slice(0, 8),
        aliases: [],
        featureId: '',
        screenId: '',
        category: 'learned',
        source,
        ts: Date.now(),
        hits: 1,
    };
    persist([item, ...list]);
    return item;
}

export function deleteLearnedFaq(id) {
    return persist(loadLearnedFaqs().filter((x) => x.id !== id));
}

export function clearLearnedFaqs() {
    try {
        safeRemoveItem(LEARNED_KEY);
        return true;
    } catch {
        return false;
    }
}

export const learnedCount = () => loadLearnedFaqs().length;

/** The shipped FAQ list followed by everything learned on this device. */
export function allFaqs(baseFaqs = []) {
    const learned = loadLearnedFaqs();
    if (!learned.length) return baseFaqs;
    return [...baseFaqs, ...learned];
}

/** Plain text of the learned list, so it can be moved to another PC by email. */
export function learnedToText() {
    const list = loadLearnedFaqs();
    if (!list.length) return '';
    return list
        .map((x, i) => `${i + 1}. ${x.q}\n${x.a}\n`)
        .join('\n');
}
