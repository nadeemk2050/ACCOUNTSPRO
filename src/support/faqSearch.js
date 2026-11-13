/**
 * faqSearch.js
 * ---------------------------------------------------------------------------
 * Offline, dependency-free matcher for the Support Center.
 *
 * WHY NOT A VECTOR DATABASE
 *  The whole knowledge base is a few dozen KB of text. Embeddings + a vector
 *  store would add infrastructure, latency and cost for no benefit at this
 *  size. A tuned keyword/alias scorer answers the same questions instantly,
 *  works with no internet, and costs nothing to run.
 *
 * HOW IT DECIDES "THIS IS AN EASY, KNOWN QUESTION"
 *  - tokens are cleaned and stop-words removed
 *  - each token scores: 4 in `keywords`, 2 in the question, 1 in the answer
 *  - an exact phrase hit in the question adds a bonus
 *  - a match on the screen the user is currently on adds a bonus
 *  - `coverage` = share of the user's meaningful words that were recognised
 *    → high coverage + decent score = answer directly, never call an AI
 */

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those',
    'to', 'in', 'on', 'at', 'of', 'for', 'from', 'with', 'by', 'about', 'into', 'as',
    'and', 'or', 'but', 'if', 'so', 'than', 'then', 'there', 'here',
    'how', 'what', 'when', 'where', 'which', 'who', 'why', 'can', 'could', 'should', 'would',
    'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had', 'not', 'no', 'yes',
    'please', 'help', 'need', 'want', 'get', 'use', 'using', 'make', 'made',
]);

/** Lowercase, strip punctuation, normalise Arabic letter variants. */
export const normalize = (text) => {
    if (!text) return '';
    let s = String(text).toLowerCase();
    s = s
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // tashkeel + tatweel
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[’'`]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return s;
};

export const tokenize = (text) =>
    normalize(text)
        .split(' ')
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

const toTokenSet = (values) => {
    const set = new Set();
    (values || []).forEach((v) => tokenize(v).forEach((t) => set.add(t)));
    return set;
};

/* ── Build the index once at module load ─────────────────────────────────── */

const buildIndex = (items, getQuestion, getAnswer, getKeywords, getAliases) =>
    items.map((item) => ({
        item,
        qTokens: toTokenSet([getQuestion(item)]),
        aTokens: toTokenSet([getAnswer(item)]),
        kTokens: toTokenSet([...(getKeywords(item) || []), ...(getAliases(item) || [])]),
        qNorm: normalize(getQuestion(item)),
    }));

/**
 * Generic scorer. Returns [{ item, score, coverage }] sorted best first.
 */
const scoreAll = (index, query, { screenId, limit = 8, screenIdOf } = {}) => {
    const qTokens = tokenize(query);
    const qNorm = normalize(query);
    if (qTokens.length === 0 || !qNorm) return [];

    const results = [];
    index.forEach((row) => {
        let score = 0;
        let matched = 0;

        qTokens.forEach((token) => {
            let hit = 0;
            if (row.kTokens.has(token)) hit = 4;
            else if (row.qTokens.has(token)) hit = 2;
            else if (row.aTokens.has(token)) hit = 1;

            // partial word support: "ledgr" / "ledgers" / "ledger"
            if (!hit) {
                const near = (set) => {
                    for (const t of set) {
                        if (t.length > 3 && token.length > 3 && (t.startsWith(token) || token.startsWith(t))) return true;
                    }
                    return false;
                };
                if (near(row.kTokens)) hit = 3;
                else if (near(row.qTokens)) hit = 1.5;
            }

            if (hit > 0) {
                score += hit;
                matched += 1;
            }
        });

        if (matched === 0) return;

        // whole-phrase bonus
        if (qNorm.length > 6 && row.qNorm.includes(qNorm)) score += 6;

        // context bonus: the user is standing on the matching screen
        if (screenId && screenIdOf && screenIdOf(row.item) === screenId) score += 4;

        const coverage = matched / qTokens.length;
        results.push({ item: row.item, score, coverage });
    });

    results.sort((a, b) => (b.score === a.score ? b.coverage - a.coverage : b.score - a.score));
    return results.slice(0, limit);
};

/* ── Public API ──────────────────────────────────────────────────────────── */

export const CONFIDENT_COVERAGE = 0.6;
export const CONFIDENT_SCORE = 8;

/** Ask the FAQ list. */
export const searchFaq = (query, opts = {}) => {
    if (!FAQ_INDEX) return [];
    return scoreAll(FAQ_INDEX, query, {
        ...opts,
        screenIdOf: (faq) => faq.screenId,
    });
};

/** Ask the feature catalogue. */
export const searchFeatures = (query, opts = {}) => {
    if (!FEATURE_INDEX) return [];
    return scoreAll(FEATURE_INDEX, query, {
        ...opts,
        screenIdOf: (f) => f.screenId,
    });
};

/**
 * The routing decision the whole design hangs on.
 *  confident  → show the saved answer, cost 0, works offline
 *  suggest    → show "did you mean" options, cost 0
 *  miss       → nothing good enough; only here would an AI be involved
 */
export const route = (query, opts = {}) => {
    const results = searchFaq(query, { ...opts, limit: 5 });
    const best = results[0];
    if (!best) return { kind: 'miss', results: [] };
    if (best.coverage >= CONFIDENT_COVERAGE && best.score >= CONFIDENT_SCORE) {
        return { kind: 'confident', best, results };
    }
    if (best.coverage >= 0.35) return { kind: 'suggest', best, results };
    return { kind: 'miss', results };
};

/* ── Late-bound indexes (avoid circular imports) ─────────────────────────── */

let FAQ_INDEX = null;
let FEATURE_INDEX = null;

export const primeSearchIndex = ({ faqs = [], features = [] }) => {
    if (faqs.length) {
        FAQ_INDEX = buildIndex(
            faqs,
            (f) => f.q,
            (f) => f.a,
            (f) => f.keywords,
            (f) => f.aliases
        );
    }
    if (features.length) {
        FEATURE_INDEX = buildIndex(
            features,
            (f) => f.name,
            (f) => `${f.what} ${(f.steps || []).join(' ')}`,
            (f) => f.tags,
            (f) => [f.where]
        );
    }
};

export default { searchFaq, searchFeatures, route, primeSearchIndex, normalize, tokenize };
