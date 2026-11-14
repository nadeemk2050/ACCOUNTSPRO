/**
 * changelog.js
 * ---------------------------------------------------------------------------
 * The single source of truth for the "What's New" tab in FAQ & Support.
 *
 * RULES (please follow these every release):
 *   1. Add the new entry at the TOP of the array (newest first).
 *   2. Keep `items` short and in plain language — the reader is an accountant,
 *      not a programmer. Say what changed on screen, not which function changed.
 *   3. `kind` must be one of: 'new' | 'fix' | 'improve' | 'security'.
 *   4. While a build is finished locally but NOT yet released, set
 *      `pending: true` so the card shows an "IN TESTING" chip. Remove the flag
 *      (or delete the flag) at the moment of release.
 *   5. ⚠️ AFTER RUNNING THE VERSION BUMP SCRIPT, CHECK THIS FILE. `_bump.cjs`
 *      does a blind text replace of the old version number, so the previous
 *      release's entry gets renamed to the new version. Restore it before
 *      building. (Happened on the 2.8.29 release.)
 *
 * Nothing here touches company data. It is a static text file.
 */

export const CHANGE_KINDS = {
    new: { label: 'New', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    improve: { label: 'Improved', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
    fix: { label: 'Fixed', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
    security: { label: 'Safety', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200' }
};

export const CHANGELOG = [
    {
        version: '2.8.29',
        date: '2026-11-14',
        title: 'Duplicate a voucher with Alt+2, and an accurate log counter',
        
        items: [
            { kind: 'new', text: 'Duplicate voucher (Tally style): press Alt+2 inside Payment, Receipt, Contra, Purchase, Sales or Journal. The voucher re-opens with the same lines, the same party and the same dates — only the Reference No. is blank, so you change it and save. Perfect for making many similar vouchers quickly.' },
            { kind: 'security', text: 'The duplicate is always saved as a brand-new voucher. The original voucher, its jumbo bag records and its effect on the ledgers are never touched. If you leave the old Reference No. in place the app still refuses it as a duplicate.' },
            { kind: 'fix', text: 'The Logs count on the Business Overview now shows the real number of audit log entries instead of always showing 0.' }
        ]
    },
    {
        version: '2.8.28',
        date: '2026-11-14',
        title: 'Correct item amounts when the supplier pays the expenses',
        items: [
            { kind: 'fix', text: 'In Purchase and Sales vouchers, an expense marked as "paid by the other party" was being added twice to the item rate. For example 770 x 1.05 showed 938.50 instead of 808.50. The item amount and the total are now always correct.' },
            { kind: 'fix', text: 'Opening a voucher that was saved before this release repairs the stored figures automatically, so old affected vouchers show the right amount too.' },
            { kind: 'improve', text: 'A negotiated or manually typed total is never recalculated — if you saved 86,506 it stays 86,506.' }
        ]
    },
    {
        version: '2.8.27',
        date: '2026-11-13',
        title: 'Clearer Yes / No confirmations with keyboard shortcuts',
        items: [
            { kind: 'improve', text: 'Every "Are you sure?" message inside the app now says Yes / No instead of OK / Cancel, and it can be answered with the Y and N keys — no mouse needed while you are typing vouchers.' },
            { kind: 'security', text: 'Deleting a voucher, purging soft-deleted records and deleting an account all use the new confirmation, so the safe answer is always the default.' }
        ]
    },
    {
        version: '2.8.26',
        date: '2026-11-12',
        title: 'AI & Chatbot knowledge brain (developer only)',
        items: [
            { kind: 'new', text: 'The Support Assistant can now be taught. A new "AI & Chatbot KB" button appears in the Management Hub for the developer account, where the tone of voice, what the assistant may answer, what it must ignore and the restricted languages can all be edited without touching any code.' },
            { kind: 'improve', text: 'The profile area now shows a DEVELOPER badge when the developer e-mail is logged in, so it is obvious which account can see the extra tools.' }
        ]
    },
    {
        version: '2.8.25',
        date: '2026-11-11',
        title: 'FAQ & Support centre with step-by-step guidance',
        items: [
            { kind: 'new', text: 'One window with four tabs: Features (every capability in the app), FAQ (the normal "how do I…" questions), Assistant (a chat box) and Suggestions (send an idea).' },
            { kind: 'new', text: 'Guided walkthrough: pick a feature, press "Show me how" and the app walks you through it step by step, opening the correct screen for each step. It only points — it never saves or deletes anything.' },
            { kind: 'new', text: 'The chat box works offline with no internet and no AI cost: if the answer already exists it replies instantly; only a genuinely unknown question is sent to the AI, and the answer is remembered so next time it costs nothing.' }
        ]
    },
    {
        version: '2.8.24',
        date: '2026-11-10',
        title: 'Saved line amounts stay exactly as saved',
        items: [
            { kind: 'fix', text: 'Re-opening a Purchase or Sales voucher no longer recalculates a line and changes the amount you had already saved. The stored total is treated as authoritative.' }
        ]
    },
    {
        version: '2.8.23',
        date: '2026-11-09',
        title: 'Voucher browsing arrows are now opt-in',
        items: [
            { kind: 'improve', text: 'The back / forward arrows for jumping between vouchers are switched OFF by default for every company. Turn them on in Rules if you want them.' }
        ]
    },
    {
        version: '2.8.22',
        date: '2026-11-08',
        title: 'Move between vouchers, and a shortcut cheat-sheet',
        items: [
            { kind: 'new', text: 'Alt + Left / Alt + Right walks backwards and forwards through the vouchers of the same type and date, so you can review the previous payment without leaving the screen.' },
            { kind: 'new', text: 'A shortcut help icon next to the voucher title lists every keyboard shortcut (Alt + R for Reference No., Alt + C, F2 for Date, Ctrl + A to save and more).' },
            { kind: 'new', text: 'New rule in Rules: "Add voucher navigation arrows in Payment, Receipt and Contra", plus an Automatic option for the generated Reference No. with manual override.' }
        ]
    },
    {
        version: '2.8.21',
        date: '2026-11-07',
        title: 'Faster, safer cloud sync and login',
        items: [
            { kind: 'fix', text: 'Logging in no longer fails with "quota exceeded": local storage cleans itself up when it is full instead of blocking the sign-in.' },
            { kind: 'improve', text: 'Cloud download of a company is verified after it finishes, so you see the correct number of vouchers instead of a partial download.' },
            { kind: 'improve', text: 'The shared company registry is written far less often, which makes multi-computer live sync noticeably quicker.' }
        ]
    }
];

/** The newest entry — used for the small "latest" summary line. */
export const LATEST_ENTRY = CHANGELOG[0] || null;

/** Entries that have actually been released (pending ones are excluded). */
export const RELEASED_ENTRIES = CHANGELOG.filter((e) => !e.pending);

/** Total number of bullet points, handy for the tab badge. */
export const TOTAL_CHANGE_COUNT = CHANGELOG.reduce((sum, e) => sum + (e.items?.length || 0), 0);

/** Plain-text version of the whole changelog (developer convenience). */
export const changelogToText = () =>
    CHANGELOG.map((entry) => {
        const head = `v${entry.version}${entry.pending ? ' (in testing)' : ''} — ${entry.title} — ${entry.date}`;
        const body = (entry.items || []).map((it) => `  • [${it.kind}] ${it.text}`).join('\n');
        return `${head}\n${body}`;
    }).join('\n\n');
