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
        version: '2.8.33',
        date: '2026-11-15',
        title: 'Sales invoice total: real value + VAT',
        items: [
            { kind: 'fix', text: 'Sales voucher with the expenses INCLUDED in the rates: the invoice total is now the real item value plus VAT - 5,577 + 278.850 = 5,855.850. The expense is no longer taken out of the voucher; it is only shown for reference (EXP chip and the small amount box under the rate).' },
            { kind: 'fix', text: 'When the expense is NOT included in the rate, the total is the real value + VAT + the total expenses - 5,577 + 278.850 + 250 = 6,105.850.' },
            { kind: 'improve', text: 'Saving keeps the real item amount, so the voucher, the printed invoice and the ledger always show the same figures.' }
        ]
    },
    {
        version: '2.8.32',
        date: '2026-11-15',
        title: 'VAT is charged on the real item value',
        items: [
            { kind: 'fix', text: 'Sales voucher with expenses included in the rates: VAT was calculated on the reduced (virtual) amount. It is now calculated on the real amount shown in the amount column - 5,577 x 5% = 278.850 instead of 5,327 x 5% = 266.350.' },
            { kind: 'fix', text: 'Typing the VAT amount directly now converts it back to a percentage using the same real amount, so the figure stays exact.' }
        ]
    },
    {
        version: '2.8.31',
        date: '2026-11-15',
        title: 'Correct amount when expenses are included in the sales rates',
        items: [
            { kind: 'fix', text: 'Sales voucher with the expenses INCLUDED in the rates: the line amount was reduced twice. 4,620 x 1.6 showed 7,142 in the amount box and 6,892 in the small amount box under it. The amount box now keeps what you typed (7,392) and the small box shows the real invoice value after the expense (7,142).' },
            { kind: 'fix', text: 'Sub total, VAT and the invoice total are now built on the same net figure, before and after saving: sub total 7,142, VAT 5% 357.100, invoice total 7,499.100.' },
            { kind: 'fix', text: 'Re-opening a saved sales voucher no longer takes the expense out a second time, and the printed PDF carries exactly the amounts you see on screen.' },
            { kind: 'improve', text: 'Purchase vouchers are unchanged: an expense payable to the supplier is still added into the item cost (770 x 1.05 shows 808.50).' }
        ]
    },
    {
        version: '2.8.30',
        date: '2026-11-15',
        title: 'Enter opens the next line, in every voucher',
        items: [
            { kind: 'new', text: 'Journal Voucher now opens with a Debit line and a Credit line straight away, so a voucher can be finished without adding the second line by hand.' },
            { kind: 'new', text: 'Type an amount on one side and the other side is filled with the same amount automatically. That filled amount is only a suggestion - type over it whenever you want, and whatever is still missing is placed on the next line you open.' },
            { kind: 'new', text: 'Press Enter on the last line of a Journal, Payment, Receipt or Contra voucher and a new line opens ready for the next account. Press Enter again on that still-empty line and it closes itself, so the whole voucher can be made from the keyboard.' },
            { kind: 'improve', text: 'In Purchase and Sales vouchers Enter now walks each item line field by field (Units, Qty, Rate, Amount), then opens the next item line, then carries on through the rest of the voucher, the narration and finally the Save button.' },
            { kind: 'fix', text: 'Pressing Enter inside a voucher can no longer submit the page. Enter always moves to the next field.' }
        ]
    },
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
