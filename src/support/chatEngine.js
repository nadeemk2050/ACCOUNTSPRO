/**
 * chatEngine.js
 * ---------------------------------------------------------------------------
 * The "brain" of the support assistant — and it is deliberately small.
 *
 * WHAT IT IS
 *   A deterministic conversation layer on top of the saved FAQ / feature data.
 *   No AI, no API key, no network, no token cost. It runs in microseconds.
 *
 * WHAT IT CAN DO
 *   - understand short social input (hi, thanks, yes, no, bye, "2")
 *   - answer a question it already knows, and name the topic first
 *   - offer the closest matches when it is only "fairly" sure
 *   - admit honestly when it does not know, and point to the Suggestions tab
 *   - offer a guided walkthrough (it never performs the steps itself)
 *
 * WHAT IT CANNOT DO
 *   - invent an answer it does not have
 *   - read or change a voucher, a party, a balance or any company data
 *   That limitation is a safety feature, not a weakness: a support bot that can
 *   "do things" is a support bot that can break things.
 */

import { primeSearchIndex, route, searchFeatures, tokenize, normalize } from './faqSearch';
import { ALL_FEATURES } from './featureCatalogue';
import { FAQ_DATA } from './faqData';

/* ── vocabulary ──────────────────────────────────────────────────────────── */

const INTENT_WORDS = {
    greeting: ['hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'salam', 'assalam', 'asalam', 'salaam', 'good morning', 'good evening', 'good afternoon'],
    thanks: ['thanks', 'thank', 'thx', 'shukriya', 'shukria', 'jazak', 'great', 'perfect', 'excellent', 'nice', 'helpful'],
    bye: ['bye', 'goodbye', 'exit', 'quit', 'stop', 'finish', 'close'],
    affirm: ['yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'go ahead', 'do it', 'guide me', 'show me', 'please do', 'haan', 'han', 'ha', 'walk me'],
    deny: ['no', 'nope', 'not now', 'later', 'nah', 'nahi', 'no thanks', 'dont', "don't"],
    help: ['what can you do', 'what do you do', 'what can i ask', 'how does this work', 'who are you', 'what is this', 'capabilities', 'help me'],
};

const SAFETY_Q = /(can you|will you|do you|are you able).*(save|delete|change|edit|remove|post|create)/i;
const AI_Q = /(are you (an )?ai|is this ai|chatgpt|openai|artificial intelligence|machine learning|api)/i;

/**
 * Word matcher.
 *  - multi-word phrases must appear as a phrase
 *  - single words must appear as a WHOLE word (so "had" never matches "ha")
 *  - long words also match inside a longer word ("thanks" in "thanks!")
 */
const has = (norm, list) => {
    const toks = norm.split(/\s+/).filter(Boolean);
    return list.some((w) => {
        if (w.includes(' ')) return norm.includes(w);
        if (toks.includes(w)) return true;
        return w.length >= 5 && norm.includes(w);
    });
};
const words = (text) => tokenize(text).length;

/* ── state ───────────────────────────────────────────────────────────────── */

export const createChatState = () => ({
    pendingGuide: null, // a feature the bot offered to walk through
    lastOptions: [],    // clickable options from the previous turn
    lastFaqId: '',
    turns: 0,
});

/* ── canned replies ──────────────────────────────────────────────────────── */

const WELCOME = {
    type: 'greeting',
    text:
        "Hello — I'm the ACCPRO support assistant. Ask me how to do something and I'll answer from the saved help library.\n\n" +
        'I can also open the right screen and point at each step. I never save, delete or change anything.',
    options: [
        { label: 'How do I add a new ledger?', query: 'how do I add a new ledger' },
        { label: 'How do I make a payment voucher?', query: 'how do I make a payment voucher' },
        { label: 'How is closing stock calculated?', query: 'how is closing stock calculated' },
        { label: 'What can you do?', query: 'what can you do' },
    ],
};

const HELP_REPLY = {
    type: 'help',
    text:
        'I answer from ' +
        FAQ_DATA.length +
        ' saved answers covering ' +
        ALL_FEATURES.length +
        ' features — masters, vouchers, registers, reports, stock, backup, rules and troubleshooting.\n\n' +
        'Ask in your own words. If I find the answer I will show it and can walk you through the screen step by step.',
    options: [
        { label: 'Masters & ledgers', query: 'how do I create a ledger' },
        { label: 'Payment / Receipt / Contra', query: 'how do I make a payment voucher' },
        { label: 'Purchase & sales voucher', query: 'how do I make a purchase voucher' },
        { label: 'Reports', query: 'how do I see my reports' },
        { label: 'Stock & FIFO', query: 'how is closing stock calculated' },
        { label: 'Backup & cloud sync', query: 'how do I take a backup' },
    ],
};

const SAFETY_REPLY = {
    type: 'safety',
    text:
        'No — and that is on purpose. I have no access to your books at all.\n\n' +
        'I can only explain how something works and open the screen for you. Every voucher, master and balance is entered by you, and nothing I do is ever saved.',
    options: [
        { label: 'What can you do?', query: 'what can you do' },
        { label: "I'd like to suggest something", action: 'suggest' },
    ],
};

const AI_REPLY = {
    type: 'about',
    text:
        "No AI is used, and nothing is sent anywhere.\n\nI'm a local matcher: your question is compared with the saved help text already inside the app. That is why I answer instantly, work with no internet, and cost nothing. If a question is not in the library I say so instead of guessing.",
    options: [
        { label: 'What can you do?', query: 'what can you do' },
    ],
};

const CLARIFY_REPLY = {
    type: 'clarify',
    text: "I didn't catch that. Try a short question like \"add ledger\", \"payment voucher\" or \"backup\".",
    options: WELCOME.options.slice(0, 3),
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

const featureOf = (faq) => {
    if (!faq || !faq.featureId) return null;
    return ALL_FEATURES.find((f) => f.id === faq.featureId) || null;
};

/* ── filler words ────────────────────────────────────────────────────────── */

/**
 * Words that carry no meaning for matching: politeness and Hinglish/Urdu
 * helpers. Removing them lifts coverage for real user phrasing such as
 * "ledger kaise banaye" → "ledger".
 * Kept local to the chat so the FAQ search behaviour is untouched.
 */
const FILLER = new Set([
    'kaise', 'kese', 'kaisay', 'kaisey', 'kaisai', 'kidhar', 'kahan', 'kab',
    'banaye', 'banate', 'banana', 'banao', 'banau', 'bana', 'banti', 'banta',
    'karna', 'karne', 'karo', 'karta', 'karti', 'kar', 'kya', 'kiya', 'kia',
    'le', 'lo', 'lena', 'lene', 'leta', 'leti', 'dena', 'de', 'diya', 'dete',
    'likhe', 'likhna', 'likho', 'dale', 'dalna', 'daale', 'kholna', 'kholo',
    'hai', 'he', 'hain', 'ho', 'hota', 'hoti', 'chahiye', 'chahta', 'chahti',
    'mujhe', 'mera', 'meri', 'apna', 'apni', 'hum', 'hume', 'aap', 'tum',
    'please', 'pls', 'plz', 'kindly', 'sir', 'madam', 'ji', 'bhai',
    'tell', 'say', 'need', 'want', 'wanna', 'can', 'could', 'would', 'should',
    'the', 'a', 'an', 'is', 'are', 'was', 'be', 'my', 'our', 'your',
    'of', 'for', 'in', 'on', 'at', 'to', 'from', 'with', 'by',
    'do', 'does', 'did', 'i', 'we', 'you', 'me', 'us', 'it', 'its',
    'how', 'what', 'where', 'when', 'which', 'who', 'why',
    'and', 'or', 'but', 'if', 'this', 'that', 'these', 'those', 'there',
    'any', 'some', 'just', 'also', 'now', 'then', 'so', 'very', 'get', 'got',
]);

const stripFillers = (text) => {
    const kept = tokenize(text).filter((t) => !FILLER.has(t));
    return kept.join(' ');
};

/* ── typo tolerance (chat only) ──────────────────────────────────────────── */

let VOCAB = null;
const buildVocab = () => {
    if (VOCAB) return VOCAB;
    const set = new Set();
    const add = (values) => (values || []).forEach((v) => tokenize(v).forEach((t) => t.length > 2 && set.add(t)));
    ALL_FEATURES.forEach((f) => {
        add([f.name, f.what]);
        add(f.tags);
    });
    FAQ_DATA.forEach((f) => {
        add([f.q]);
        add(f.keywords);
        add(f.aliases);
    });
    VOCAB = set;
    return VOCAB;
};

/** Bounded edit distance — cheap because the strings are short. */
const editDistance = (a, b, max) => {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) prev[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        cur[0] = i;
        let rowMin = cur[0];
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        const swap = prev;
        prev = cur;
        cur = swap;
    }
    return prev[b.length];
};

/** Correct each unknown word against the known vocabulary. */
const correctTokens = (text) => {
    const vocab = buildVocab();
    const toks = tokenize(text);
    let changed = false;
    const fixed = toks.map((t) => {
        if (t.length < 4 || vocab.has(t)) return t;
        const max = t.length >= 7 ? 2 : 1;
        let best = t;
        let bestD = max + 1;
        for (const w of vocab) {
            const d = editDistance(t, w, max);
            if (d < bestD) {
                bestD = d;
                best = w;
                if (d === 1) break;
            }
        }
        if (best !== t) changed = true;
        return best;
    });
    return changed ? fixed.join(' ') : '';
};

const canGuide = (feature) => !!feature && (feature.steps || []).length > 0;

const dedupe = (list) => {
    const seen = new Set();
    return list.filter((x) => {
        if (!x || seen.has(x)) return false;
        seen.add(x);
        return true;
    });
};

/** Turn a set of scored hits into clickable options. */
const toOptions = (hits, limit = 3) =>
    dedupe(hits.slice(0, limit).map((h) => h.item.name || h.item.q))
        .map((label) => ({ label, query: label }));

/* ── the one entry point ─────────────────────────────────────────────────── */

/**
 * A single clean hit should be answered, not questioned. "backup" matches one
 * question with full coverage — that is good enough for a chat reply. Two or
 * more equally good hits stay as "did you mean", which is the honest answer.
 */
const promote = (res) => {
    if (!res || res.kind !== 'suggest') return res;
    const best = res.results && res.results[0];
    if (!best || best.coverage < 0.99) return res;
    const next = res.results[1];
    if (next && best.score < next.score * 1.5) return res;
    return { kind: 'confident', best, results: res.results };
};

let primed = false;
const ensureIndex = () => {
    if (primed) return;
    primeSearchIndex({ faqs: FAQ_DATA, features: ALL_FEATURES });
    primed = true;
};

/**
 * @param {string} text  what the user typed
 * @param {object} state chat state from createChatState()
 * @returns {{ reply: object, state: object }}
 */
export function askBot(text, state = createChatState()) {
    ensureIndex();
    const raw = String(text || '').trim();
    const norm = normalize(raw);
    const state0 = { ...state, turns: (state.turns || 0) + 1 };

    /* 1. empty */
    if (!raw) return { reply: CLARIFY_REPLY, state: state0 };

    /* 2. trust questions first — they must never be answered by a keyword match */
    if (AI_Q.test(raw)) return { reply: AI_REPLY, state: { ...state0, pendingGuide: null } };
    if (SAFETY_Q.test(raw)) return { reply: SAFETY_REPLY, state: { ...state0, pendingGuide: null } };

    /* 3. pending walkthrough offer */
    if (state.pendingGuide) {
        if (has(norm, INTENT_WORDS.affirm)) {
            return {
                reply: {
                    type: 'guide',
                    text: `Opening ${state.pendingGuide.where || 'the screen'} — follow the steps in the small card, and stop whenever you like.`,
                    guideFeature: state.pendingGuide,
                },
                state: { ...state0, pendingGuide: null, lastOptions: [] },
            };
        }
        if (has(norm, INTENT_WORDS.deny)) {
            return {
                reply: {
                    type: 'text',
                    text: 'Fine — read the steps above whenever you are ready. Ask me anything else.',
                    options: [
                        { label: 'What can you do?', query: 'what can you do' },
                        { label: "I'd like to suggest something", action: 'suggest' },
                    ],
                },
                state: { ...state0, pendingGuide: null },
            };
        }
    }

    /* 4. a number picks from the last options */
    if (/^\d{1,2}$/.test(raw)) {
        const pick = state.lastOptions[Number(raw) - 1];
        if (pick) return askBot(pick.query || pick.label, { ...state0, lastOptions: [] });
        return { reply: CLARIFY_REPLY, state: state0 };
    }

    /* 5. social / meta intents (short inputs only, so they never hijack a real question) */
    const short = words(raw) <= 3;
    const core = stripFillers(raw) || raw;
    if (short && INTENT_WORDS.greeting.includes(norm)) return { reply: WELCOME, state: { ...state0, lastOptions: WELCOME.options } };
    if (INTENT_WORDS.help.includes(norm)) return { reply: HELP_REPLY, state: { ...state0, lastOptions: HELP_REPLY.options } };
    if (short && has(norm, INTENT_WORDS.thanks)) {
        return {
            reply: {
                type: 'thanks',
                text: 'Happy to help. Anything else you want me to explain?',
                options: [
                    { label: 'What can you do?', query: 'what can you do' },
                    { label: "I'd like to suggest something", action: 'suggest' },
                ],
            },
            state: { ...state0, pendingGuide: null },
        };
    }
    if (short && has(norm, INTENT_WORDS.bye)) {
        return {
            reply: { type: 'bye', text: 'Okay — close this page whenever you like. I am here if you need me.' },
            state: { ...state0, pendingGuide: null, lastOptions: [] },
        };
    }
    if (short && has(norm, INTENT_WORDS.deny)) {
        return {
            reply: {
                type: 'text',
                text: 'No problem. Ask me anything whenever you like.',
                options: [{ label: 'What can you do?', query: 'what can you do' }],
            },
            state: { ...state0, pendingGuide: null },
        };
    }
    if (short && has(norm, INTENT_WORDS.affirm)) {
        return {
            reply: {
                type: 'text',
                text: 'Good. What would you like me to explain?',
                options: WELCOME.options,
            },
            state: { ...state0, pendingGuide: null, lastOptions: WELCOME.options },
        };
    }

    /* 6. the real work: match against the saved answers */
    const RANK = { confident: 3, suggest: 2, miss: 1 };
    let r = promote(route(raw, { limit: 5 }));

    // try the de-filled version ("ledger kaise banaye" -> "ledger")
    if (r.kind !== 'confident' && core !== raw) {
        const r2 = promote(route(core, { limit: 5 }));
        if (RANK[r2.kind] > RANK[r.kind] || (r2.kind === r.kind && (r2.best?.score || 0) > (r.best?.score || 0))) r = r2;
    }

    // still unsure? correct likely typos ("paymnt vouchr")
    if (r.kind !== 'confident') {
        const fixed = correctTokens(core);
        if (fixed) {
            const r3 = promote(route(fixed, { limit: 5 }));
            if (RANK[r3.kind] > RANK[r.kind]) r = r3;
        }
    }

    if (r.kind === 'confident') {
        const faq = r.best.item;
        const feature = featureOf(faq);
        const related = r.results
            .filter((x) => x.item !== faq && x.coverage >= 0.35)
            .slice(0, 3)
            .map((x) => ({ label: x.item.q, query: x.item.q }));

        return {
            reply: {
                type: 'answer',
                text: faq.a,
                faq,
                feature,
                guideFeature: canGuide(feature) ? feature : null,
                options: related,
            },
            state: {
                ...state0,
                pendingGuide: canGuide(feature) ? feature : null,
                lastOptions: related,
                lastFaqId: faq.id,
            },
        };
    }

    if (r.kind === 'suggest') {
        const options = r.results.slice(0, 3).map((x) => ({ label: x.item.q, query: x.item.q }));
        return {
            reply: {
                type: 'options',
                text: "I'm not certain I understood. Did you mean one of these?",
                options,
                allowAi: true,
            },
            state: { ...state0, pendingGuide: null, lastOptions: options },
        };
    }

    /* 7. honest miss — nearest features instead of a made-up answer */
    const near = searchFeatures(raw, { limit: 3 });
    const options = toOptions(near, 3);
    return {
        reply: {
            type: 'miss',
            text:
                "I don't have a saved answer for that yet — and I would rather say so than guess.\n\n" +
                'If one of these is close, I can open its steps. Otherwise please add your idea in the Suggestions tab and it can be added to the help library.',
            options,
            suggestAction: true,
        },
        state: { ...state0, pendingGuide: null, lastOptions: options },
    };
}

/** The greeting shown when the chat is first opened. */
export const welcomeReply = () => WELCOME;

/** Chips shown above the composer when the conversation is empty. */
export const starterChips = () => WELCOME.options;
