/* Parity test: the RELEASED dashboard finance maths (git HEAD) vs the new
   shared engine computeLedgerBalances(), which now powers the Cash/Bank
   Balances, Receivables and Payables breakdown reports.
   Both are extracted from the REAL sources — nothing is re-typed by hand.
   Run:  node scratch/ledger-balance-test.mjs                                */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const DIR = 'C:/app2026/accountspro';
const NEW_SRC = fs.readFileSync(DIR + '/src/App.jsx', 'utf8');
const OLD_SRC = execSync('git show HEAD:src/App.jsx', { cwd: DIR, maxBuffer: 128 * 1024 * 1024 }).toString('utf8');

const cut = (src, a, b, label) => {
    const i = src.indexOf(a);
    if (i < 0) throw new Error('[' + label + '] start marker not found');
    const j = src.indexOf(b, i + a.length);
    if (j < 0) throw new Error('[' + label + '] end marker not found');
    return src.slice(i, j);
};

// --- the NEW shared engine, straight out of the current file ---
const engineSrc = cut(NEW_SRC, 'const computeLedgerBalances = ({', 'const getEmbeddedBagsFromJournal', 'engine');

// --- the OLD dashboard maths, straight out of the released HEAD file ---
const oldRaw = cut(OLD_SRC, '            const accBalMap = {};', '            const effMap = {};', 'old');
const oldBody = oldRaw.split('\n').map(l => (l.startsWith('            ') ? l.slice(12) : l)).join('\n');

// --- the real supplier-base helper, so both sides share ONE implementation ---
const psbSrc = cut(NEW_SRC, 'const purchaseSupplierBase = (d, baseVal, addlExpBase) => {', '// --- LIVE CURRENCY INPUT COMPONENT ---', 'psb');
const purchaseSupplierBase = new Function(psbSrc + '\n return purchaseSupplierBase;')();

const isVoucherDeleted = (v) => !!v && (v.deleted === true || v.is_deleted === true || ['deleted', 'cancelled', 'canceled'].includes(String(v.status || '').toLowerCase()));

const oldBalances = new Function(
    'invDocs', 'payDocs', 'jvDocs', 'targetDate', 'currentAccounts', 'currentParties',
    'purchaseSupplierBase', 'isVoucherDeleted',
    oldBody + '\n return { accBalMap, partyBalMap };'
);
const newEngine = new Function('purchaseSupplierBase', 'isVoucherDeleted', engineSrc + '\n return computeLedgerBalances;')(purchaseSupplierBase, isVoucherDeleted);

const wrap = (arr) => arr.map(v => ({ data: () => v }));

const ACCOUNTS = ['A1', 'A2', 'A3', 'A4'].map((id, i) => ({ id, name: 'Acc ' + id, openingBalance: [0, 1000, -250, 4000][i] }));
const PARTIES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((id, i) => ({ id, name: 'Party ' + id, openingBalance: [0, 500, -800, 1200, 0, -60][i] }));
const DATE = '2026-06-30';

let pass = 0, fail = 0;
const failures = [];

const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.0000001;

const compare = (label, oldRes, newRes) => {
    const keys = new Set([...Object.keys(oldRes.accBalMap), ...Object.keys(newRes.accBal)]);
    const pkeys = new Set([...Object.keys(oldRes.partyBalMap), ...Object.keys(newRes.partyBal)]);
    const bad = [];
    keys.forEach(k => { if (!near(oldRes.accBalMap[k], newRes.accBal[k])) bad.push(`accBal[${k}] old=${oldRes.accBalMap[k] || 0} new=${newRes.accBal[k] || 0}`); });
    pkeys.forEach(k => { if (!near(oldRes.partyBalMap[k], newRes.partyBal[k])) bad.push(`partyBal[${k}] old=${oldRes.partyBalMap[k] || 0} new=${newRes.partyBal[k] || 0}`); });
    if (bad.length) { fail++; failures.push({ label, bad }); }
    else pass++;
};

const check = (label, inv, pay, jv, accounts = ACCOUNTS, parties = PARTIES, asOf = DATE) => {
    const oldRes = oldBalances(wrap(inv), wrap(pay), wrap(jv), asOf, accounts, parties, purchaseSupplierBase, isVoucherDeleted);
    const newRes = newEngine({ invDocs: wrap(inv), payDocs: wrap(pay), jvDocs: wrap(jv), accounts, parties, asOfDate: asOf });
    compare(label, oldRes, newRes);
};

/* ── 1. hand-built corpus: one case per resolution branch ─────────────────── */
check('purchase / party accrual', [{ type: 'purchase', date: DATE, partyId: 'P1', grandTotal: 1000 }], [], []);
check('purchase + addlExp credited to an ACCOUNT', [{ type: 'purchase', date: DATE, partyId: 'P1', grandTotal: 1000, addlExpTotal: 100, addlExpCreditId: 'A1', addlExpMode: 'others' }], [], []);
check('purchase + addlExp credited to a PARTY', [{ type: 'purchase', date: DATE, partyId: 'P2', grandTotal: 400, addlExpTotal: 50, addlExpCreditId: 'P3', addlExpMode: 'supplier' }], [], []);
check('purchase legacy (no addlExpMode) + addlExp to account', [{ type: 'purchase', date: DATE, partyId: 'P2', grandTotal: 700, addlExpTotal: 70, addlExpCreditId: 'A2' }], [], []);
check('sales accrual + deleted voucher skipped', [{ type: 'sales', date: DATE, partyId: 'P2', grandTotal: 2000 }, { type: 'sales', date: DATE, partyId: 'P3', grandTotal: 999, deleted: true }], [], []);
check('future-dated voucher skipped', [{ type: 'purchase', date: '2027-01-01', partyId: 'P1', grandTotal: 5000 }], [], []);
check('EMPTY-date voucher skipped', [{ type: 'purchase', date: '', partyId: 'P1', grandTotal: 5000 }], [], []);
check('receipt in (party leg)', [], [{ type: 'in', date: DATE, accountId: 'A1', amount: 500, transactionCategory: 'party', partyId: 'P1' }], []);
check('payment out with NO transactionCategory (partyId fallback)', [], [{ type: 'out', date: DATE, accountId: 'A2', amount: 400, partyId: 'P4' }], []);
check('payment out targeting an EXPENSE id', [], [{ type: 'out', date: DATE, accountId: 'A2', amount: 300, expenseId: 'E1' }], []);
check('contra (accountId + toAccountId)', [], [{ type: 'contra', date: DATE, accountId: 'A1', toAccountId: 'A2', amount: 200 }], []);
check('multi split with targetId+category', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ targetId: 'P5', category: 'party', amount: 250 }] }], []);
check('LEGACY split storing partyId only', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ partyId: 'P6', amount: 150 }] }], []);
check('LEGACY split storing accountId only', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ accountId: 'A3', amount: 77 }] }], []);
check('split with a MISMATCHED category', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ targetId: 'P1', category: 'account', amount: 33 }] }], []);
check('split whose id is in NEITHER master', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ targetId: 'ZZ', category: 'party', amount: 44 }] }], []);
check('FX split (exchangeRate 3.685)', [], [{ type: 'out', isMulti: true, date: DATE, accountId: 'A1', exchangeRate: 3.685, splits: [{ targetId: 'P3', category: 'party', amount: 100 }] }], []);
check('JV multi rows with categories', [], [], [{ isMulti: true, date: DATE, rows: [{ id: 'P1', category: 'party', type: 'dr', amount: 500 }, { id: 'A1', category: 'account', type: 'cr', amount: 500 }] }]);
check('JV multi row with NO category', [], [], [{ isMulti: true, date: DATE, rows: [{ id: 'A2', type: 'dr', amount: 60 }, { id: 'P4', type: 'cr', amount: 60 }] }]);
check('JV single with drType/crType', [], [], [{ date: DATE, drId: 'A3', drType: 'account', crId: 'P3', crType: 'party', amount: 900 }]);
check('JV single with NO types', [], [], [{ date: DATE, drId: 'P2', crId: 'A4', amount: 120 }]);
check('everything at once', [
    { type: 'purchase', date: DATE, partyId: 'P1', grandTotal: 1000, addlExpTotal: 100, addlExpCreditId: 'A1', addlExpMode: 'others' },
    { type: 'sales', date: DATE, partyId: 'P2', grandTotal: 2000 },
    { type: 'purchase_apt', date: DATE, partyId: 'P3', taxableValue: 300, grandTotal: 300 },
    { type: 'debit_note', date: DATE, partyId: 'P4', grandTotal: 90 }
], [
    { type: 'in', date: DATE, accountId: 'A1', amount: 500, transactionCategory: 'party', partyId: 'P1' },
    { type: 'out', date: DATE, accountId: 'A2', amount: 400, partyId: 'P4' },
    { type: 'contra', date: DATE, accountId: 'A1', toAccountId: 'A2', amount: 200 },
    { type: 'out', isMulti: true, date: DATE, accountId: 'A1', splits: [{ partyId: 'P6', amount: 150 }, { accountId: 'A3', amount: 77 }] }
], [
    { isMulti: true, date: DATE, rows: [{ id: 'P1', category: 'party', type: 'dr', amount: 500 }, { id: 'A1', category: 'account', type: 'cr', amount: 500 }] },
    { date: DATE, drId: 'P2', crId: 'A4', amount: 120 }
]);

/* ── 2. fuzz: 300 random books ────────────────────────────────────────────── */
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const TYPES_INV = ['sales', 'sales_reg_apt', 'purchase', 'purchase_apt', 'credit_note', 'debit_note', 'sales_return', 'purchase_return', 'quotation', ''];
const ACCT = ['A1', 'A2', 'A3', 'A4', 'E1', 'ZZ'];
const PARTY = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'ZZ'];
const CATS = ['party', 'account', 'expense', 'capital', 'asset', 'income', undefined, null];
const DATES = ['2026-01-15', '2026-06-30', '2026-12-31', '2027-03-01', '', undefined];

for (let n = 0; n < 300; n++) {
    const inv = [], pay = [], jv = [];
    for (let i = 0, k = rnd(9); i < k; i++) {
        const d = { type: pick(TYPES_INV), date: pick(DATES), partyId: pick(PARTY), grandTotal: rnd(100000) / 100 };
        if (rnd(2)) d.addlExpTotal = rnd(5000) / 100;
        if (rnd(2)) d.addlExpCreditId = pick([...ACCT, ...PARTY]);
        if (rnd(3) === 0) d.addlExpMode = pick(['supplier', 'others', '', null]);
        if (rnd(3) === 0) d.exchangeRate = pick([1, 3.685, 0.9]);
        if (rnd(6) === 0) d.deleted = true;
        inv.push(d);
    }
    for (let i = 0, k = rnd(9); i < k; i++) {
        const v = { type: pick(['in', 'out', 'contra', '']), date: pick(DATES), accountId: pick(ACCT), amount: rnd(200000) / 100 };
        if (rnd(2)) v.exchangeRate = pick([1, 3.685]);
        if (rnd(2)) v.isMulti = true;
        if (v.isMulti) {
            v.splits = [];
            for (let s = 0, sk = rnd(4); s < sk; s++) {
                const sp = { amount: rnd(50000) / 100 };
                if (rnd(3) === 0) sp.targetId = pick([...ACCT, ...PARTY, 'ZZ']);
                if (rnd(3) === 0) sp.partyId = pick(PARTY);
                if (rnd(3) === 0) sp.accountId = pick(ACCT);
                if (rnd(2)) sp.category = pick(CATS);
                v.splits.push(sp);
            }
        } else {
            if (rnd(2)) v.transactionCategory = pick(CATS);
            if (rnd(2)) v.partyId = pick(PARTY);
            if (rnd(3) === 0) v.expenseId = pick(['E1', 'E2']);
            if (rnd(4) === 0) v.toAccountId = pick(ACCT);
            if (rnd(5) === 0) v.capitalId = pick(['C1']);
            if (rnd(5) === 0) v.assetId = pick(['AS1']);
            if (rnd(5) === 0) v.incomeId = pick(['I1']);
        }
        if (rnd(8) === 0) v.deleted = true;
        pay.push(v);
    }
    for (let i = 0, k = rnd(6); i < k; i++) {
        const v = { date: pick(DATES), amount: rnd(300000) / 100 };
        if (rnd(2)) {
            v.isMulti = true;
            v.rows = [];
            for (let r = 0, rk = rnd(4); r < rk; r++) {
                const row = { id: pick([...ACCT, ...PARTY, 'ZZ']), type: pick(['dr', 'cr']), amount: rnd(50000) / 100 };
                if (rnd(2)) row.category = pick(CATS);
                v.rows.push(row);
            }
        } else {
            v.drId = pick([...ACCT, ...PARTY, 'ZZ']);
            v.crId = pick([...ACCT, ...PARTY, 'ZZ']);
            if (rnd(2)) v.drType = pick(CATS);
            if (rnd(2)) v.crType = pick(CATS);
        }
        if (rnd(8) === 0) v.deleted = true;
        jv.push(v);
    }
    check('fuzz#' + n, inv, pay, jv);
}

/* ── report ───────────────────────────────────────────────────────────────── */
console.log(`\n  ${pass} passed, ${fail} failed  (${pass + fail} cases)`);
if (failures.length) {
    failures.slice(0, 5).forEach(f => { console.log(`\n  ✗ ${f.label}`); f.bad.slice(0, 6).forEach(b => console.log('      ' + b)); });
}
process.exit(fail ? 1 : 0);
