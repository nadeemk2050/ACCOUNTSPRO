/**
 * suggestionCheck.js
 * ---------------------------------------------------------------------------
 * Before a suggestion is saved we check whether ACCPRO can already do it.
 *
 * This is a plain keyword/coverage matcher (the same engine as the FAQ).
 * No AI, no network, no cost — and it never over-claims: when it is not sure it
 * says "related" or "new", it does not pretend to understand.
 *
 * Verdicts
 *   existing : the idea looks like a feature that already exists
 *   related  : something similar exists, worth checking first
 *   new      : nothing close was found — treat as a genuine new idea
 */

import { primeSearchIndex, searchFaq, searchFeatures, tokenize } from './faqSearch';
import { ALL_FEATURES } from './featureCatalogue';
import { FAQ_DATA } from './faqData';

let primed = false;

const prime = () => {
    if (primed) return;
    primeSearchIndex({ faqs: FAQ_DATA, features: ALL_FEATURES });
    primed = true;
};

/**
 * @param {string} text the suggestion typed by the user
 * @returns {{ verdict: 'existing'|'related'|'new', features: object[], faqs: object[], matchedIds: string[] }}
 */
export function analyzeSuggestion(text = '') {
    prime();
    const q = String(text || '').trim();
    if (tokenize(q).length < 2) return { verdict: 'new', features: [], faqs: [], matchedIds: [] };

    const featureHits = searchFeatures(q, { limit: 4 });
    const faqHits = searchFaq(q, { limit: 3 });

    const bestFeature = featureHits[0];
    const bestFaq = faqHits[0];
    const bestCoverage = Math.max(bestFeature?.coverage || 0, bestFaq?.coverage || 0);
    const bestScore = Math.max(bestFeature?.score || 0, bestFaq?.score || 0);

    let verdict = 'new';
    if (bestCoverage >= 0.6 && bestScore >= 8) verdict = 'existing';
    else if (bestCoverage >= 0.35) verdict = 'related';

    const topFeatures = verdict === 'new' ? [] : featureHits.filter((h) => h.coverage >= 0.3).slice(0, 3).map((h) => h.item);
    const topFaqs = verdict === 'new' ? [] : faqHits.filter((h) => h.coverage >= 0.3).slice(0, 2).map((h) => h.item);

    const matchedIds = [
        ...topFeatures.map((f) => f.id),
        ...topFaqs.map((f) => f.id),
    ];

    return { verdict, features: topFeatures, faqs: topFaqs, matchedIds };
}
