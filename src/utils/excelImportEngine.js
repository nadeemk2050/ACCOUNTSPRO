/**
 * AccPro Enterprise Excel Import Engine & Validation Middleware
 * Implements Rules 1 through 7 for transactional vouchers:
 * - Rule 1: Duplicate Reference Mitigation
 * - Rule 2: Missing Master Handling & Interactive Resolution
 * - Rule 3: Currency & FX Rate Normalization
 * - Rule 4: Mandatory Fields & Sanity Checks
 * - Rule 5: Account Aliasing & Fuzzy Name Matching (>85%)
 * - Rule 6: Transaction Date Boundary Lock
 * - Rule 7: Atomic Batch Isolation & Audit Logging + Rollback
 */

import { db } from '../firebase.js';
import {
    collection, doc, writeBatch, setDoc, getDoc, updateDoc,
    serverTimestamp, getDocs, query, where, deleteDoc
} from 'firebase/firestore';
import * as fsShim from 'firebase/firestore';

// Bulk-write window: while active, per-document cloud pushes are queued by the local shim
// so a large import is not competing with hundreds of simultaneous network writes.
const beginBulk = typeof fsShim.beginBulkWrite === 'function' ? fsShim.beginBulkWrite : () => {};
const endBulk = typeof fsShim.endBulkWrite === 'function' ? fsShim.endBulkWrite : () => {};

/** Wraps a document parser so it can run directly on nodes already in memory (no re-parse). */
const voucherDocFor = (nodes) => ({
    getElementsByTagName: (tag) => (tag === 'VOUCHER' ? nodes : [])
});

export const BATCH_HISTORY_KEY = 'accpro_excel_batch_history';

// Master-name normalisation: matching ignores CAPITAL/small letters and ALL spaces/punctuation,
// so "OMAN 001", "oman001" and "oman-001" are treated as the SAME master name.
export const normalizeMasterName = (name = '') => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parses numeric Excel dates (e.g. 46054) or date strings to YYYY-MM-DD
 */
export function parseExcelDate(val) {
    if (!val && val !== 0) return null;
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        if (isNaN(date.getTime())) return null;
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    if (/^\d{8}$/.test(str)) {
        const y = str.slice(0, 4);
        const m = str.slice(4, 6);
        const d = str.slice(6, 8);
        return `${y}-${m}-${d}`;
    }

    const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (dmy) {
        let yr = parseInt(dmy[3], 10);
        if (yr < 100) yr += 2000;
        return `${yr}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return null;
}

/**
 * Levenshtein distance & similarity index (0.0 to 1.0)
 */
export function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const a = String(str1).trim().toLowerCase();
    const b = String(str2).trim().toLowerCase();
    if (a === b) return 1.0;

    // Clean punctuation and double spaces for clean matching
    const cleanA = a.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanB = b.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanA === cleanB) return 0.98;

    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
        return Math.max(0.87, Math.min(cleanA.length, cleanB.length) / Math.max(cleanA.length, cleanB.length));
    }

    const matrix = [];
    for (let i = 0; i <= cleanB.length; i++) matrix[i] = [i];
    for (let j = 0; j <= cleanA.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= cleanB.length; i++) {
        for (let j = 1; j <= cleanA.length; j++) {
            if (cleanB.charAt(i - 1) === cleanA.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    const distance = matrix[cleanB.length][cleanA.length];
    const maxLen = Math.max(cleanA.length, cleanB.length);
    if (maxLen === 0) return 1.0;
    return (maxLen - distance) / maxLen;
}

/**
 * Searches all system masters for exact or fuzzy match (>85%)
 */
export function matchMaster(name, masters) {
    if (!name) return { match: null, type: null, score: 0, isExact: false };
    const query = String(name).trim().toLowerCase();

    const masterLists = [
        { type: 'party', items: masters.parties || [] },
        { type: 'account', items: masters.accounts || [] },
        { type: 'expense', items: masters.expenses || [] },
        { type: 'direct_expense', items: masters.directExpenseAccounts || [] },
        { type: 'capital', items: masters.capitalAccounts || [] },
        { type: 'asset', items: masters.assetAccounts || [] },
        { type: 'income', items: masters.incomeAccounts || [] },
        { type: 'product', items: masters.products || [] },
        { type: 'tax', items: masters.taxRates || [] },
    ];

    // 1. Check exact match (ignoring CAPITAL/small letters and spaces/punctuation,
    //    so "OMAN 001" and "oman001" resolve to the existing master)
    const normQuery = normalizeMasterName(query);
    for (const group of masterLists) {
        for (const item of group.items) {
            const itemName = String(item.name || '').trim().toLowerCase();
            if (itemName === query || (normQuery && normalizeMasterName(itemName) === normQuery)) {
                return { match: item, type: group.type, score: 1.0, isExact: true };
            }
        }
    }

    // 2. Check fuzzy match (> 85%)
    let bestMatch = null;
    let bestType = null;
    let bestScore = 0;

    for (const group of masterLists) {
        for (const item of group.items) {
            const itemName = String(item.name || '').trim().toLowerCase();
            const score = calculateSimilarity(query, itemName);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
                bestType = group.type;
            }
        }
    }

    if (bestScore >= 0.85) {
        return { match: bestMatch, type: bestType, score: bestScore, isExact: false };
    }

    return { match: null, type: null, score: bestScore, isExact: false };
}

/**
 * Parses raw ArrayBuffer of uploaded Excel file into normalized voucher rows
 */
export async function parseExcelFile(arrayBuffer, options = {}) {
    const XLSX = await import('xlsx'); // Perf: on-demand only — keeps xlsx out of the boot bundle
    const voucherMode = options.voucherMode || 'payment'; // 'payment' | 'receipt'
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (!rawRows || rawRows.length === 0) {
        throw new Error('The selected Excel file is empty.');
    }

    // Locate header row (search first 15 rows for key terms)
    let headerIndex = -1;
    let formatType = 'standard'; // 'tally_columnar' or 'standard'

    for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
        const row = rawRows[i] || [];
        const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');

        if (rowStr.includes('particulars') && (rowStr.includes('gross total') || rowStr.includes('voucher no'))) {
            headerIndex = i;
            formatType = 'tally_columnar';
            break;
        } else if ((rowStr.includes('date') || rowStr.includes('txn date')) && (rowStr.includes('amount') || rowStr.includes('debit') || rowStr.includes('total'))) {
            headerIndex = i;
            formatType = 'standard';
            break;
        }
    }

    if (headerIndex === -1) {
        headerIndex = 0; // fallback to first row
    }

    const headers = (rawRows[headerIndex] || []).map(h => String(h || '').trim());
    const dataRows = rawRows.slice(headerIndex + 1);

    const parsedVouchers = [];

    if (formatType === 'tally_columnar') {
        // Find indices for standard Tally columnar headers
        const dateIdx = headers.findIndex(h => /^date$/i.test(h));
        const particIdx = headers.findIndex(h => /^particulars$/i.test(h));
        const vchTypeIdx = headers.findIndex(h => /voucher\s*type/i.test(h));
        const vchNoIdx = headers.findIndex(h => /voucher\s*no/i.test(h));
        const narrIdx = headers.findIndex(h => /^narration$/i.test(h));
        const grossIdx = headers.findIndex(h => /gross\s*total/i.test(h));

        // Account breakdown columns start after Gross Total
        const breakdownCols = [];
        const startCol = grossIdx !== -1 ? grossIdx + 1 : 12;
        for (let c = startCol; c < headers.length; c++) {
            const h = headers[c];
            if (h && !/^total$/i.test(h)) {
                breakdownCols.push({ index: c, name: h });
            }
        }

        dataRows.forEach((r, idx) => {
            if (!r || r.length === 0) return;
            const rowParticulars = String(r[particIdx] || '').trim();
            if (/grand\s*total/i.test(rowParticulars) || /^total/i.test(rowParticulars)) return; // Skip total row

            const rawDate = r[dateIdx];
            const parsedDate = parseExcelDate(rawDate);
            const vchNo = String(r[vchNoIdx] || '').trim();
            const grossTotal = parseFloat(r[grossIdx]) || 0;
            const narration = String(r[narrIdx] || '').trim();
            const vchType = String(r[vchTypeIdx] || 'Payment').trim();

            // Check non-empty breakdown columns
            const nonNullBreakdowns = [];
            breakdownCols.forEach(col => {
                const val = parseFloat(r[col.index]);
                if (val && val > 0) {
                    nonNullBreakdowns.push({ name: col.name, amount: val });
                }
            });

            let paidFrom = '';
            let paidTo = rowParticulars;
            let splits = [];

            if (nonNullBreakdowns.length === 1) {
                // Standard 1-to-1: Single paying cashier/account
                paidFrom = nonNullBreakdowns[0].name;
                splits = [{
                    targetName: paidTo,
                    amount: nonNullBreakdowns[0].amount || grossTotal,
                    description: narration
                }];
            } else if (nonNullBreakdowns.length > 1) {
                // Multi-split voucher (e.g. Waliul paid multiple expense heads)
                paidFrom = rowParticulars; // Source is the Particulars header
                splits = nonNullBreakdowns.map(b => ({
                    targetName: b.name,
                    amount: b.amount,
                    description: narration
                }));
            } else {
                // Fallback
                splits = [{
                    targetName: paidTo,
                    amount: grossTotal,
                    description: narration
                }];
            }

            parsedVouchers.push({
                rowNumber: headerIndex + 2 + idx,
                rawDate,
                date: parsedDate,
                vchNo: vchNo || `VCH-${idx + 1}`,
                vchType,
                paidFrom,
                paidTo,
                amount: grossTotal,
                narration,
                splits,
                currency: 'BASE',
                exchangeRate: 1.0,
                format: 'tally_columnar'
            });
        });
    } else {
        // Standard Tabular Format
        const findCol = (regexList) => {
            for (let c = 0; c < headers.length; c++) {
                for (const reg of regexList) {
                    if (reg.test(headers[c])) return c;
                }
            }
            return -1;
        };

        const dateIdx = findCol([/^date$/i, /txn\s*date/i, /vch\s*date/i]);
        const vchNoIdx = findCol([/voucher\s*no/i, /vch\s*no/i, /ref\s*no/i, /doc\s*no/i]);
        const drLedgerIdx = findCol([/dr\s*ledger/i, /debit\s*ledger/i, /debit\s*account/i, /dr\s*account/i, /dr\s*party/i]);
        const crLedgerIdx = findCol([/cr\s*ledger/i, /credit\s*ledger/i, /credit\s*account/i, /cr\s*account/i, /cr\s*party/i]);
        const particIdx = findCol([/particulars/i, /account/i, /ledger/i, /party/i]);
        const debitAmtIdx = findCol([/debit\s*amount/i, /^debit$/i, /^dr$/i]);
        const creditAmtIdx = findCol([/credit\s*amount/i, /^credit$/i, /^cr$/i]);
        const paidFromIdx = findCol([
            /paid\s*from/i, /received\s*in/i, /deposit\s*to/i, /bank/i, /cash/i, /account/i,
            voucherMode === 'receipt' ? /dr\s*ledger/i : /cr\s*ledger/i
        ]);
        const paidToIdx = findCol([
            /paid\s*to/i, /received\s*from/i, /customer/i, /party/i, /supplier/i, /vendor/i, /particulars/i,
            voucherMode === 'receipt' ? /cr\s*ledger/i : /dr\s*ledger/i
        ]);
        const amountIdx = findCol([/^amount$/i, /gross/i, /total/i, /debit/i, /credit/i, /received/i, /paid/i]);
        const narrIdx = findCol([/narration/i, /remark/i, /description/i, /notes/i]);
        const curIdx = findCol([/currency/i, /curr/i, /ccy/i]);
        const rateIdx = findCol([/exchange\s*rate/i, /rate/i, /fx/i]);
        const defaultVchType = voucherMode === 'journal' ? 'Journal' : (voucherMode === 'receipt' ? 'Receipt' : 'Payment');

        dataRows.forEach((r, idx) => {
            if (!r || r.length === 0) return;
            const rawDate = r[dateIdx];
            const parsedDate = parseExcelDate(rawDate);
            const vchNo = String(r[vchNoIdx] || '').trim();
            const narration = String(r[narrIdx] || '').trim();
            const currency = curIdx !== -1 ? String(r[curIdx] || 'BASE').trim().toUpperCase() : 'BASE';
            const exchangeRate = rateIdx !== -1 ? (parseFloat(r[rateIdx]) || 1.0) : 1.0;

            if (voucherMode === 'journal') {
                let drRows = [];
                let crRows = [];
                let totalDr = 0;
                let totalCr = 0;

                if (drLedgerIdx !== -1 && crLedgerIdx !== -1) {
                    const drName = String(r[drLedgerIdx] || '').trim();
                    const crName = String(r[crLedgerIdx] || '').trim();
                    const amt = parseFloat(r[amountIdx]) || 0;
                    if (drName && amt > 0) drRows.push({ targetName: drName, amount: amt, description: narration, type: 'dr' });
                    if (crName && amt > 0) crRows.push({ targetName: crName, amount: amt, description: narration, type: 'cr' });
                    totalDr = amt;
                    totalCr = amt;
                } else if (debitAmtIdx !== -1 || creditAmtIdx !== -1) {
                    const partic = String(r[particIdx] || '').trim();
                    const drAmt = debitAmtIdx !== -1 ? (parseFloat(r[debitAmtIdx]) || 0) : 0;
                    const crAmt = creditAmtIdx !== -1 ? (parseFloat(r[creditAmtIdx]) || 0) : 0;
                    if (partic && drAmt > 0) {
                        drRows.push({ targetName: partic, amount: drAmt, description: narration, type: 'dr' });
                        totalDr = drAmt;
                    }
                    if (partic && crAmt > 0) {
                        crRows.push({ targetName: partic, amount: crAmt, description: narration, type: 'cr' });
                        totalCr = crAmt;
                    }
                } else {
                    const pTo = String(r[paidToIdx] || '').trim();
                    const pFrom = String(r[paidFromIdx] || '').trim();
                    const amt = parseFloat(r[amountIdx]) || 0;
                    if (pTo && amt > 0) drRows.push({ targetName: pTo, amount: amt, description: narration, type: 'dr' });
                    if (pFrom && amt > 0) crRows.push({ targetName: pFrom, amount: amt, description: narration, type: 'cr' });
                    totalDr = amt;
                    totalCr = amt;
                }

                const amount = Math.max(totalDr, totalCr);
                if (!parsedDate && drRows.length === 0 && crRows.length === 0) return;

                parsedVouchers.push({
                    rowNumber: headerIndex + 2 + idx,
                    rawDate,
                    date: parsedDate,
                    vchNo: vchNo || `JV-${idx + 1}`,
                    vchType: 'Journal',
                    paidFrom: crRows.map(r => r.targetName).join(', '),
                    paidTo: drRows.map(r => r.targetName).join(', '),
                    amount,
                    totalDr,
                    totalCr,
                    drRows,
                    crRows,
                    narration,
                    splits: [...drRows, ...crRows],
                    currency: currency || 'BASE',
                    exchangeRate,
                    format: 'standard',
                    isMultiSplit: drRows.length > 1 || crRows.length > 1
                });
            } else {
                const amount = parseFloat(r[amountIdx]) || 0;
                const paidFrom = String(r[paidFromIdx] || '').trim();
                const paidTo = String(r[paidToIdx] || '').trim();

                if (!parsedDate && !paidTo && amount === 0) return; // Skip empty row

                parsedVouchers.push({
                    rowNumber: headerIndex + 2 + idx,
                    rawDate,
                    date: parsedDate,
                    vchNo: vchNo || `VCH-${idx + 1}`,
                    vchType: defaultVchType,
                    paidFrom,
                    paidTo,
                    amount,
                    narration,
                    splits: [{ targetName: paidTo, amount, description: narration }],
                    currency: currency || 'BASE',
                    exchangeRate,
                    format: 'standard'
                });
            }
        });
    }

    return {
        formatType,
        headers,
        vouchers: parsedVouchers
    };
}

/**
 * Intelligent Multi-Line Voucher Consolidator
 * Automatically merges multiple rows sharing the same Voucher Number into a single Multi-Split voucher
 * Supports: Cashier giving to multiple receivers, or Cashier receiving from multiple givers!
 */
export function groupMultiLineVouchers(vouchers, options = {}) {
    const voucherMode = options.voucherMode || 'payment';
    const groupedMap = new Map();

    vouchers.forEach((v, idx) => {
        const cleanRef = String(v.vchNo || '').trim().toUpperCase();
        // Group by Voucher Number and Date
        const key = cleanRef ? `${cleanRef}_${v.date || ''}` : `temp_idx_${idx}`;

        if (!groupedMap.has(key)) {
            groupedMap.set(key, {
                ...v,
                splits: [...(v.splits || [])],
                drRows: v.drRows ? [...v.drRows] : [],
                crRows: v.crRows ? [...v.crRows] : [],
                totalDr: v.totalDr || 0,
                totalCr: v.totalCr || 0,
                isMultiSplit: (v.splits || []).length > 1 || (v.drRows && (v.drRows.length > 1 || v.crRows?.length > 1))
            });
        } else {
            // Existing voucher: consolidate this row as an additional split!
            const existing = groupedMap.get(key);

            if (voucherMode === 'journal') {
                if (!existing.drRows) existing.drRows = [];
                if (!existing.crRows) existing.crRows = [];
                if (v.drRows) existing.drRows.push(...v.drRows);
                if (v.crRows) existing.crRows.push(...v.crRows);

                existing.totalDr = Number(existing.drRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toFixed(3));
                existing.totalCr = Number(existing.crRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toFixed(3));
                existing.amount = Math.max(existing.totalDr, existing.totalCr);

                existing.paidTo = existing.drRows.map(r => r.targetName).filter(Boolean).join(', ');
                existing.paidFrom = existing.crRows.map(r => r.targetName).filter(Boolean).join(', ');
                existing.splits = [...existing.drRows, ...existing.crRows];
                existing.isMultiSplit = existing.drRows.length > 1 || existing.crRows.length > 1;
            } else {
                existing.amount = Number(((existing.amount || 0) + (v.amount || 0)).toFixed(3));

                // Adopt source account if previous was empty
                if (!existing.paidFrom && v.paidFrom) existing.paidFrom = v.paidFrom;

                // Merge splits
                (v.splits || []).forEach(s => {
                    existing.splits.push({ ...s });
                });

                // If single target was present, combine display
                if (v.paidTo && existing.paidTo && !existing.paidTo.includes(v.paidTo)) {
                    existing.paidTo = `${existing.paidTo}, ${v.paidTo}`;
                }

                existing.isMultiSplit = true;
            }

            // Append narration if unique
            if (v.narration && !existing.narration.includes(v.narration)) {
                existing.narration = existing.narration ? `${existing.narration}; ${v.narration}` : v.narration;
            }
        }
    });

    return Array.from(groupedMap.values());
}

/**
 * Parses Tally native XML (Data Interchange)
 */
/** Tally exports its XML as UTF-16 (usually LE with BOM) — decode by BOM/heuristic instead of assuming UTF-8. */
export async function readXmlFileText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let encoding = 'utf-8';
    let offset = 0;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
    else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { offset = 3; }
    else {
        const n = Math.min(bytes.length, 512);
        let evenNulls = 0, oddNulls = 0;
        for (let i = 0; i < n; i++) { if (bytes[i] === 0) { if (i % 2 === 0) evenNulls++; else oddNulls++; } }
        if (oddNulls > n / 8) encoding = 'utf-16le';
        else if (evenNulls > n / 8) encoding = 'utf-16be';
    }
    return new TextDecoder(encoding, { fatal: false }).decode(bytes.subarray(offset));
}

/**
 * Tally writes "&#4;" (and other XML 1.0 illegal control chars) as an empty-field marker and DOMParser
 * rejects them, so they are stripped before parsing. Multiple concatenated <ENVELOPE> blocks
 * (Tally appends when exporting twice into one file) are wrapped in a synthetic root.
 */
export function sanitizeTallyXml(xmlText) {
    let out = String(xmlText || '').replace(/^\uFEFF/, '');
    out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    out = out.replace(/&#(?:x([0-9a-fA-F]{1,5})|(\d{1,6}));/g, (m, hex, dec) => {
        const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        const illegal = cp <= 0x08 || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) || cp === 0xfffe || cp === 0xffff;
        return illegal ? '' : m;
    });
    const envelopeCount = (out.match(/<ENVELOPE[\s>]/gi) || []).length;
    if (envelopeCount !== 1) {
        return '<TALLYBUNDLE>' + out.replace(/<\?xml[^>]*\?>/gi, '') + '</TALLYBUNDLE>';
    }
    return out;
}

/* ── MULTI-CURRENCY (FOREX) SUPPORT ─────────────────────────────────────────
   Tally writes a forex ledger leg as ONE text value inside <AMOUNT>:

       -cad5000.00 @ AED 2.95/cad = -AED 14750.000
        └ foreign ┘  rate (base/foreign)   └ base ┘

   A plain parseFloat() on that string yields NaN → the voucher was imported as
   zero. The helpers below read BOTH values (foreign + base) plus the currency
   code and the rate, so the voucher can be created with its real amounts. */
const FX_AMOUNT_RE = /^(-)?\s*([A-Za-z]{2,6})?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*@\s*([A-Za-z]{2,6})?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*\/\s*([A-Za-z]{2,6})\s*=\s*(-)?\s*([A-Za-z]{2,6})?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/;
const FX_RATE_RE = /^\s*([A-Za-z]{2,6})?\s*(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*=\s*([A-Za-z]{2,6})?\s*(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*([A-Za-z0-9._\/]+))?\s*$/;
const tallyNum = (t) => Number(String(t == null ? '' : t).replace(/,/g, '')) || 0;

/**
 * Reads a Tally <AMOUNT> value that may be a forex expression.
 * Returns { isForeign, base, foreign, currency, baseCurrency, rate } — `base`/`foreign` keep the sign.
 */
export function parseTallyFxAmount(text) {
    const raw = String(text == null ? '' : text).trim();
    const plain = raw === '' ? NaN : Number(raw.replace(/,/g, ''));
    if (Number.isFinite(plain)) {
        return { isForeign: false, base: plain, foreign: plain, currency: '', baseCurrency: '', rate: 1 };
    }
    const m = raw.match(FX_AMOUNT_RE);
    if (!m) {
        const fallback = parseFloat(raw.replace(/[^0-9.\-]/g, '')) || 0;
        return { isForeign: false, base: fallback, foreign: fallback, currency: '', baseCurrency: '', rate: 1 };
    }
    const [, fSign, fCcy, fAmt, bCcy1, rateTxt, perCcy, bSign, bCcy2, bAmt] = m;
    const rate = tallyNum(rateTxt) || 1;
    const foreign = tallyNum(fAmt) * (fSign ? -1 : 1);
    let base = tallyNum(bAmt) * (bSign ? -1 : 1);
    if (!base) base = roundTally(foreign * rate);
    return {
        isForeign: true,
        base,
        foreign,
        currency: String(perCcy || fCcy || '').toUpperCase(),
        baseCurrency: String(bCcy2 || bCcy1 || '').toUpperCase(),
        rate
    };
}

/**
 * Reads a Tally <RATE> that may be a forex expression: "cad5.00 = AED 14.450/kgs".
 * Returns { isForeign, foreign, base, unit, rate }.
 */
export function parseTallyFxRate(text) {
    const raw = String(text == null ? '' : text).trim();
    const m = raw.match(FX_RATE_RE);
    if (!m) {
        const plain = parseFloat(raw.replace(/[^0-9.\-]/g, '')) || 0;
        return { isForeign: false, foreign: plain, base: plain, unit: '', rate: 1 };
    }
    const [, ccy1, r1, ccy2, r2, unit] = m;
    const foreign = tallyNum(r1);
    const base = tallyNum(r2);
    return {
        isForeign: !!(ccy1 || ccy2),
        foreign,
        base,
        unit: String(unit || '').trim(),
        rate: foreign ? base / foreign : 1
    };
}

const roundTally = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Maps a Tally currency code (e.g. "CAD") to the app's currency master.
 * Falls back to the raw code so the forex information is never lost.
 */
function resolveImportCurrency(code, context, baseSymbol) {
    const raw = String(code || '').trim();
    if (!raw || raw.toUpperCase() === 'BASE') return { id: 'BASE', symbol: baseSymbol };
    const up = raw.toUpperCase();
    const list = Array.isArray(context?.currencies) ? context.currencies : [];
    const hit = list.find(c => String(c.symbol || '').trim().toUpperCase() === up)
        || list.find(c => String(c.name || '').trim().toUpperCase().startsWith(up))
        || list.find(c => String(c.id || '').trim().toUpperCase() === up);
    return hit
        ? { id: hit.id, symbol: hit.symbol || up }
        : { id: up, symbol: up };
}

/**
 * Classifies a Tally voucher type name. Real-world names vary (Payment / Bank Payment / B.P.V /
 * C.P.V / R.C.P ...), so known "other" types are excluded and anything unrecognised is kept.
 */
export function classifyVoucherType(name) {
    const s = String(name || '').trim();
    if (!s) return 'unknown';
    if (/stock\s*journal/i.test(s)) return 'stock_journal';
    if (/\bsales\b/i.test(s)) return 'sales';
    if (/purchase/i.test(s)) return 'purchase';
    if (/contra/i.test(s)) return 'contra';
    if (/credit\s*note/i.test(s)) return 'credit_note';
    if (/debit\s*note/i.test(s)) return 'debit_note';
    if (/delivery\s*note|receipt\s*note|material\s*(in|out)/i.test(s)) return 'note';
    if (/physical\s*stock|manufactur|payroll|attendance|rejection|memorandum/i.test(s)) return 'other_process';
    if (/journal|reversing/i.test(s)) return 'journal';
    if (/receipt|r\.?\s*c\.?\s*p\b/i.test(s)) return 'receipt';
    if (/b\.?\s*p\.?\s*v|bank\s*payment/i.test(s)) return 'payment';
    if (/c\.?\s*p\.?\s*v|cash\s*payment/i.test(s)) return 'payment';
    if (/payment|^p\.?\s*v\.?$/i.test(s)) return 'payment';
    return 'other';
}

/**
 * Parses Tally native XML (Data Interchange)
 */
export function parseXMLFile(xmlText, options = {}) {
    const voucherMode = options.voucherMode || 'payment';
    let xmlDoc;
    if (options.doc) {
        // Single-pass mode: the caller already parsed the document and filtered the nodes.
        xmlDoc = options.doc;
    } else {
        if (isDbcRegisterXml(xmlText)) {
            throw new Error('This is a Tally ERP 9 REGISTER export (Day Book / Register columns). Open it with the PURCHASE importer, or export "Vouchers" from Tally Prime as XML (Data Interchange) for payment / receipt / journal.');
        }
        const parser = new DOMParser();
        const sanitized = sanitizeTallyXml(xmlText);
        xmlDoc = parser.parseFromString(sanitized, 'text/xml');

        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error('Invalid XML file: ' + parseError[0].textContent);
        }
    }

    const voucherNodes = xmlDoc.getElementsByTagName('VOUCHER');
    if (!voucherNodes || voucherNodes.length === 0) {
        throw new Error('No <VOUCHER> elements found in this XML document.');
    }

    // Voucher-type awareness: a Tally register export contains every voucher type, so keep only the
    // ones matching the importer in use and report exactly what was detected / skipped.
    const modeKind = voucherMode === 'receipt' ? 'receipt' : (voucherMode === 'journal' ? 'journal' : 'payment');
    const typeCounts = {};
    for (let i = 0; i < voucherNodes.length; i++) {
        const t = voucherNodes[i].getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
                  voucherNodes[i].getAttribute('VCHTYPE') || '';
        if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const detectedVoucherTypes = Object.keys(typeCounts);

    const parsedVouchers = [];
    const skippedTypes = [];
    let skippedVoucherCount = 0;

    for (let i = 0; i < voucherNodes.length; i++) {
        const vNode = voucherNodes[i];
        const vchType = vNode.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
                        vNode.getAttribute('VCHTYPE') || (voucherMode === 'receipt' ? 'Receipt' : 'Payment');

        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== modeKind) {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            continue;
        }

        const rawDate = vNode.getElementsByTagName('DATE')[0]?.textContent?.trim();
        const parsedDate = parseExcelDate(rawDate);
        const vchNo = vNode.getElementsByTagName('VOUCHERNUMBER')[0]?.textContent?.trim() || `VCH-${i + 1}`;
        const narration = vNode.getElementsByTagName('NARRATION')[0]?.textContent?.trim() || '';

        const ledgerNodes = Array.from(vNode.getElementsByTagName('ALLLEDGERENTRIES.LIST'))
            .concat(Array.from(vNode.getElementsByTagName('LEDGERENTRIES.LIST')));

        let paidFrom = '';
        let paidTo = '';
        let totalAmount = 0;
        let totalDr = 0;
        let totalCr = 0;
        let totalForeign = 0;
        let totalDrForeign = 0;
        let totalCrForeign = 0;
        let voucherCurrency = '';
        let voucherRate = 1;
        let baseCurrencyCode = '';
        const splits = [];
        const drRows = [];
        const crRows = [];

        // Tally ERP 9 and Tally Prime both nest BANKALLOCATIONS.LIST / BILLALLOCATIONS.LIST (which carry
        // their own <AMOUNT>, <DATE> etc.) inside the ledger entry — so read the DIRECT children first,
        // otherwise the bank/bill allocation amount would be picked up instead of the ledger amount.
        const readTag = (node, tag) => {
            const direct = Array.from(node.children || []).find(c => c.tagName === tag);
            const el = direct || node.getElementsByTagName(tag)[0];
            return el ? (el.textContent || '').trim() : '';
        };

        /** Reads one ledger leg. `fxAmount` keeps BOTH values of a multi-currency leg. */
        const readLeg = (lNode) => {
            const fx = parseTallyFxAmount(readTag(lNode, 'AMOUNT'));
            const baseAbs = Math.abs(fx.base);
            // Voucher-currency (foreign) value — same as base for single-currency legs.
            const foreignAbs = fx.isForeign ? Math.abs(fx.foreign) : baseAbs;
            if (fx.isForeign) {
                if (!voucherCurrency) voucherCurrency = fx.currency;
                if (fx.rate > 0) voucherRate = fx.rate;
                if (!baseCurrencyCode) baseCurrencyCode = fx.baseCurrency;
            }
            return {
                ledgerName: readTag(lNode, 'LEDGERNAME'),
                isDeemedPositive: readTag(lNode, 'ISDEEMEDPOSITIVE'),
                rawBase: fx.base,
                baseAbs,
                foreignAbs,
                isForeign: fx.isForeign,
                currency: fx.currency,
                rate: fx.rate
            };
        };

        ledgerNodes.forEach(lNode => {
            const leg = readLeg(lNode);
            const ledgerName = leg.ledgerName;
            const rawAmt = leg.rawBase;
            const isDeemedPositive = leg.isDeemedPositive;
            const absAmt = leg.baseAbs;
            const foreignAmt = leg.foreignAbs;
            const fxMeta = { baseAmount: absAmt, foreignAmount: foreignAmt, currency: leg.currency, exchangeRate: leg.rate, isForeign: leg.isForeign };

            if (voucherMode === 'journal') {
                if (isDeemedPositive === 'Yes' || (rawAmt < 0 && isDeemedPositive !== 'No')) {
                    drRows.push({ targetName: ledgerName, amount: foreignAmt, description: narration, type: 'dr', ...fxMeta });
                    totalDr += absAmt;
                    totalDrForeign += foreignAmt;
                } else {
                    crRows.push({ targetName: ledgerName, amount: foreignAmt, description: narration, type: 'cr', ...fxMeta });
                    totalCr += absAmt;
                    totalCrForeign += foreignAmt;
                }
            } else if (voucherMode === 'payment') {
                if (isDeemedPositive === 'No' || (rawAmt > 0 && isDeemedPositive !== 'Yes')) {
                    if (!paidFrom) paidFrom = ledgerName;
                } else {
                    splits.push({ targetName: ledgerName, amount: foreignAmt, description: narration, ...fxMeta });
                    totalAmount += absAmt;
                    totalForeign += foreignAmt;
                }
            } else {
                if (isDeemedPositive === 'Yes' || (rawAmt < 0 && isDeemedPositive !== 'No')) {
                    if (!paidFrom) paidFrom = ledgerName;
                } else {
                    splits.push({ targetName: ledgerName, amount: foreignAmt, description: narration, ...fxMeta });
                    totalAmount += absAmt;
                    totalForeign += foreignAmt;
                }
            }
        });

        if (voucherMode === 'journal') {
            paidTo = drRows.map(r => r.targetName).filter(Boolean).join(', ');
            paidFrom = crRows.map(r => r.targetName).filter(Boolean).join(', ');
            totalAmount = Math.max(totalDr, totalCr);
            totalForeign = Math.max(totalDrForeign, totalCrForeign);
        } else if (splits.length === 0 && ledgerNodes.length >= 2) {
            const first = readLeg(ledgerNodes[0]);
            const second = readLeg(ledgerNodes[1]);
            paidFrom = first.ledgerName;
            splits.push({
                targetName: second.ledgerName,
                amount: second.foreignAbs,
                description: narration,
                baseAmount: second.baseAbs,
                foreignAmount: second.foreignAbs,
                currency: second.currency,
                exchangeRate: second.rate,
                isForeign: second.isForeign
            });
            totalAmount = second.baseAbs;
            totalForeign = second.foreignAbs;
        }

        if (voucherMode !== 'journal') {
            paidTo = splits.map(s => s.targetName).filter(Boolean).join(', ');
        }

        parsedVouchers.push({
            rowNumber: i + 1,
            rawDate,
            date: parsedDate,
            vchNo,
            vchType,
            paidFrom,
            paidTo,
            amount: totalAmount || (splits[0]?.baseAmount || splits[0]?.amount || 0),
            totalDr,
            totalCr,
            drRows,
            crRows,
            narration,
            splits: voucherMode === 'journal' ? [...drRows, ...crRows] : splits,
            currency: voucherCurrency || 'BASE',
            exchangeRate: voucherCurrency ? voucherRate : 1.0,
            // Forex figures so the voucher is created with BOTH currencies (base + foreign).
            foreignAmount: totalForeign || totalAmount,
            foreignTotal: totalForeign || totalAmount,
            baseTotal: totalAmount,
            baseCurrency: baseCurrencyCode || '',
            isForeign: !!voucherCurrency,
            format: 'tally_xml',
            isMultiSplit: voucherMode === 'journal' ? (drRows.length > 1 || crRows.length > 1) : splits.length > 1
        });
    }

    return {
        formatType: 'tally_xml',
        headers: ['Date', 'Voucher No', 'Voucher Type', 'Paid From', 'Particulars', 'Amount', 'Narration'],
        vouchers: parsedVouchers,
        expectedVoucherKind: modeKind,
        detectedVoucherTypes,
        detectedVoucherTypeCounts: typeCounts,
        skippedVoucherCount,
        skippedVoucherTypes: skippedTypes,
        typeMismatch: parsedVouchers.length === 0 && detectedVoucherTypes.length > 0
    };
}

/**
 * Universal Ingestion Loader
 * Seamlessly handles .xlsx, .xls, .csv, and .xml files with automatic Multi-Line Voucher Consolidation
 */
export async function parseUniversalFile(file, options = {}) {
    const fileName = (file.name || '').toLowerCase();
    let parsed;

    if (fileName.endsWith('.xml')) {
        const text = await readXmlFileText(file);
        parsed = parseXMLFile(text, options);
    } else {
        // .xlsx, .xls, .csv (SheetJS automatically parses CSV and Excel)
        const buffer = await file.arrayBuffer();
        parsed = await parseExcelFile(buffer, options);
    }

    // Automatically consolidate multi-row vouchers sharing the same voucher number
    parsed.vouchers = groupMultiLineVouchers(parsed.vouchers, options);
    return parsed;
}

/**
 * Validates parsed vouchers against AccPro rules (Rules 1-6)
 */
export function validateImportBatch(vouchers, context) {
    const {
        existingVouchers = [],
        masters = {},
        companyProfile = {}
    } = context;

    // Hash set of existing refNos in database
    const existingRefNoSet = new Set(
        existingVouchers.map(v => String(v.refNo || '').trim().toUpperCase()).filter(Boolean)
    );

    // Track internal file duplicates
    const fileRefNoCount = new Map();
    vouchers.forEach(v => {
        const ref = String(v.vchNo || '').trim().toUpperCase();
        if (ref) {
            fileRefNoCount.set(ref, (fileRefNoCount.get(ref) || 0) + 1);
        }
    });

    const lockDate = companyProfile?.rules?.lockDate || null;
    const cleanRows = [];
    const quarantinedRows = [];

    vouchers.forEach((v, index) => {
        const issues = [];
        let status = 'VALID'; // 'VALID' | 'WARNING' | 'CRITICAL'

        // Rule 4: Mandatory Fields & Sanity Checks
        if (!v.date) {
            issues.push({
                rule: 'RULE_4_MANDATORY',
                type: 'CRITICAL',
                message: 'Invalid or missing transaction Date.',
                field: 'date'
            });
        }
        if (!v.paidTo && (!v.splits || v.splits.length === 0 || !v.splits[0].targetName)) {
            issues.push({
                rule: 'RULE_4_MANDATORY',
                type: 'CRITICAL',
                message: 'Particulars / Paid To ledger name is missing.',
                field: 'paidTo'
            });
        }
        if (v.amount <= 0) {
            issues.push({
                rule: 'RULE_4_SANITY',
                type: 'CRITICAL',
                message: `Amount must be greater than zero (found ${v.amount}).`,
                field: 'amount'
            });
        }

        // Rule 6: Transaction Date Boundary Lock
        if (v.date && lockDate && v.date <= lockDate) {
            issues.push({
                rule: 'RULE_6_PERIOD_LOCK',
                type: 'CRITICAL',
                message: `Transaction date (${v.date}) falls within locked period (Lock Date: ${lockDate}).`,
                field: 'date'
            });
        }

        // Rule 1: Duplicate Reference Mitigation
        const refUpper = String(v.vchNo || '').trim().toUpperCase();
        const isSystemDuplicate = existingRefNoSet.has(refUpper);
        const isFileDuplicate = (fileRefNoCount.get(refUpper) || 0) > 1;

        if (isSystemDuplicate) {
            issues.push({
                rule: 'RULE_1_DUPLICATE_REF',
                type: 'CRITICAL',
                message: `Duplicate Voucher No "${v.vchNo}" already exists in system database.`,
                field: 'vchNo',
                actionRequired: 'auto_renumber_or_skip'
            });
        } else if (isFileDuplicate) {
            issues.push({
                rule: 'RULE_1_FILE_DUPLICATE',
                type: 'WARNING',
                message: `Voucher No "${v.vchNo}" appears multiple times in this Excel file.`,
                field: 'vchNo',
                actionRequired: 'confirm_multi_line'
            });
        }

        // Rule 3: Currency & FX Rate Normalization
        if (v.currency && v.currency !== 'BASE') {
            if (!v.exchangeRate || v.exchangeRate <= 0) {
                issues.push({
                    rule: 'RULE_3_MISSING_FX',
                    type: 'WARNING',
                    message: `Foreign currency (${v.currency}) is missing valid exchange rate.`,
                    field: 'exchangeRate',
                    actionRequired: 'manual_fx_entry'
                });
            }
        }

        // Rule 2 & Rule 5: Master Matching & Fuzzy Resolution
        const resolvedSplits = [];
        const resolvedDrRows = [];
        const resolvedCrRows = [];
        let matchedPaidFrom = null;

        if (v.vchType === 'Journal') {
            // Check Imbalance
            const drSum = (v.drRows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const crSum = (v.crRows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            if (Math.abs(drSum - crSum) > 0.01) {
                issues.push({
                    rule: 'RULE_4_UNBALANCED_JOURNAL',
                    type: 'CRITICAL',
                    message: `Journal voucher is unbalanced: Total Debit (${drSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}) != Total Credit (${crSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}). Difference: ${Math.abs(drSum - crSum).toFixed(2)}.`,
                    field: 'amount'
                });
            }

            // Resolve Dr rows
            (v.drRows || []).forEach(dr => {
                const match = matchMaster(dr.targetName, masters);
                if (match.match) {
                    resolvedDrRows.push({
                        ...dr,
                        matchedMaster: match.match,
                        category: match.type,
                        targetId: match.match.id,
                        targetName: match.match.name
                    });
                    if (!match.isExact) {
                        issues.push({
                            rule: 'RULE_5_FUZZY_MATCH',
                            type: 'INFO',
                            message: `Debit Ledger "${dr.targetName}" fuzzy-matched with "${match.match.name}" (${Math.round(match.score * 100)}% match).`,
                            field: 'drRows',
                            suggestion: match.match,
                            originalName: dr.targetName
                        });
                    }
                } else {
                    resolvedDrRows.push({
                        ...dr,
                        matchedMaster: null,
                        category: 'expense',
                        targetId: null
                    });
                    issues.push({
                        rule: 'RULE_2_MISSING_MASTER',
                        type: 'CRITICAL',
                        message: `Debit Ledger "${dr.targetName}" does not exist in masters.`,
                        field: 'drRows',
                        missingType: 'expense',
                        missingName: dr.targetName
                    });
                }
            });

            // Resolve Cr rows
            (v.crRows || []).forEach(cr => {
                const match = matchMaster(cr.targetName, masters);
                if (match.match) {
                    resolvedCrRows.push({
                        ...cr,
                        matchedMaster: match.match,
                        category: match.type,
                        targetId: match.match.id,
                        targetName: match.match.name
                    });
                    if (!match.isExact) {
                        issues.push({
                            rule: 'RULE_5_FUZZY_MATCH',
                            type: 'INFO',
                            message: `Credit Ledger "${cr.targetName}" fuzzy-matched with "${match.match.name}" (${Math.round(match.score * 100)}% match).`,
                            field: 'crRows',
                            suggestion: match.match,
                            originalName: cr.targetName
                        });
                    }
                } else {
                    resolvedCrRows.push({
                        ...cr,
                        matchedMaster: null,
                        category: 'party',
                        targetId: null
                    });
                    issues.push({
                        rule: 'RULE_2_MISSING_MASTER',
                        type: 'CRITICAL',
                        message: `Credit Ledger "${cr.targetName}" does not exist in masters.`,
                        field: 'crRows',
                        missingType: 'party',
                        missingName: cr.targetName
                    });
                }
            });
        } else {
            // Match Source Cashier / Bank
            if (v.paidFrom) {
                const matchFrom = matchMaster(v.paidFrom, masters);
                if (matchFrom.match) {
                    matchedPaidFrom = matchFrom;
                    if (!matchFrom.isExact) {
                        issues.push({
                            rule: 'RULE_5_FUZZY_MATCH',
                            type: 'INFO',
                            message: `Paid From "${v.paidFrom}" fuzzy-matched with "${matchFrom.match.name}" (${Math.round(matchFrom.score * 100)}% match).`,
                            field: 'paidFrom',
                            suggestion: matchFrom.match
                        });
                    }
                } else {
                    issues.push({
                        rule: 'RULE_2_MISSING_MASTER',
                        type: 'CRITICAL',
                        message: `Paying Bank/Cashier "${v.paidFrom}" does not exist in Accounts master.`,
                        field: 'paidFrom',
                        missingType: 'account',
                        missingName: v.paidFrom
                    });
                }
            }

            // Match Target Splits (Party / Expense)
            for (const split of (v.splits || [])) {
                const matchTo = matchMaster(split.targetName, masters);
                if (matchTo.match) {
                    resolvedSplits.push({
                        ...split,
                        matchedMaster: matchTo.match,
                        category: matchTo.type,
                        targetId: matchTo.match.id,
                        targetName: matchTo.match.name
                    });
                    if (!matchTo.isExact) {
                        issues.push({
                            rule: 'RULE_5_FUZZY_MATCH',
                            type: 'INFO',
                            message: `Paid To "${split.targetName}" fuzzy-matched with "${matchTo.match.name}" (${Math.round(matchTo.score * 100)}% match).`,
                            field: 'paidTo',
                            suggestion: matchTo.match,
                            originalName: split.targetName
                        });
                    }
                } else {
                    resolvedSplits.push({
                        ...split,
                        matchedMaster: null,
                        category: 'party',
                        targetId: null
                    });
                    issues.push({
                        rule: 'RULE_2_MISSING_MASTER',
                        type: 'CRITICAL',
                        message: `Entity "${split.targetName}" does not exist in database masters.`,
                        field: 'paidTo',
                        missingType: 'party',
                        missingName: split.targetName
                    });
                }
            }
        }

        const hasCritical = issues.some(i => i.type === 'CRITICAL');
        const hasWarning = issues.some(i => i.type === 'WARNING');
        status = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'VALID';

        const rowItem = {
            id: `row_${index + 1}_${v.vchNo || Date.now()}`,
            ...v,
            status,
            issues,
            isResolved: !hasCritical,
            matchedPaidFrom,
            resolvedSplits,
            resolvedDrRows,
            resolvedCrRows
        };

        if (hasCritical || hasWarning) {
            quarantinedRows.push(rowItem);
        } else {
            cleanRows.push(rowItem);
        }
    });

    return {
        totalParsed: vouchers.length,
        cleanRows,
        quarantinedRows,
        stats: {
            validCount: cleanRows.length,
            quarantinedCount: quarantinedRows.length,
            totalAmount: vouchers.reduce((sum, v) => sum + (v.amount || 0), 0)
        }
    };
}

/**
 * Creates a missing Master on the fly (Rule 2)
 */
export async function createMissingMaster({ name, type = 'party', partyRole = 'supplier', dataOwnerId, user, effectiveName, percentage }) {
    if (!name || !name.trim()) throw new Error('Master name cannot be empty');
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');

    const collectionName = type === 'account' ? 'accounts' : 
        type === 'expense' ? 'expenses' : 
        type === 'direct_expense' ? 'direct_expenses' :
        type === 'income' ? 'income_accounts' :
        type === 'capital' ? 'capital_accounts' :
        type === 'asset' ? 'asset_accounts' :
        type === 'product' ? 'products' :
        type === 'tax' ? 'tax_rates' : 'parties';

    const cleanName = name.trim();
    const cleanKey = normalizeMasterName(cleanName);

    // DUPLICATE GUARD: never create a master whose name already exists (matching ignores
    // CAPITAL/small letters and spaces/punctuation) — hand back the existing record instead.
    try {
        const existingSnap = await getDocs(query(collection(db, collectionName), where('userId', '==', targetUid)));
        const dupDoc = existingSnap.docs.find(d => normalizeMasterName(d.data()?.name) === cleanKey);
        if (dupDoc) return { id: dupDoc.id, ...dupDoc.data(), collectionName, alreadyExisted: true };
    } catch (e) { /* offline / missing index — fall through and create */ }

    const newDoc = {
        name: cleanName,
        userId: targetUid,
        createdAt: serverTimestamp(),
        createdByName: effectiveName || 'Import Engine',
        createdBy: user?.uid || 'system',
        balance: 0
    };

    if (type === 'party') {
        const isCustomer = partyRole === 'customer';
        newDoc.type = isCustomer ? 'customer' : 'supplier';
        newDoc.partyType = isCustomer ? 'customer' : 'supplier';
        newDoc.category = isCustomer ? 'Sundry Debtors' : 'Sundry Creditors';
    } else if (type === 'account') {
        newDoc.type = 'cash';
        newDoc.accountType = 'cash';
    } else if (type === 'expense') {
        newDoc.group = 'Administrative Expenses';
    } else if (type === 'direct_expense') {
        newDoc.group = 'Direct Expenses';
    } else if (type === 'income') {
        newDoc.group = 'Indirect Incomes';
    } else if (type === 'capital') {
        newDoc.group = 'Capital Account';
    } else if (type === 'asset') {
        newDoc.group = 'Fixed Assets';
    } else if (type === 'product') {
        // Mirror the product master shape used by "Manage Items" (MasterModal)
        newDoc.name_lowercase = cleanName.toLowerCase();
        newDoc.hscode = '';
        newDoc.group = 'Primary';
        newDoc.openingStock = 0;
        newDoc.openingRate = 0;
        newDoc.openingBalance = 0;
        newDoc.currentStock = 0;
    } else if (type === 'tax') {
        // Mirror the tax_rates master shape used by "Manage Tax Rates"
        newDoc.name_lowercase = cleanName.toLowerCase();
        newDoc.percentage = Number(percentage) || 0;
        delete newDoc.balance;
    }

    const docRef = doc(collection(db, collectionName));
    await setDoc(docRef, newDoc);

    return {
        id: docRef.id,
        ...newDoc,
        collectionName
    };
}

/**
 * Executes Atomic Batch Import (Rule 7)
 */
export async function executeBatchImport(rowsToImport, context) {
    beginBulk();
    try {
        return await runBatchImport(rowsToImport, context);
    } finally {
        endBulk();
    }
}

async function runBatchImport(rowsToImport, context = {}) {
    const {
        user,
        dataOwnerId,
        effectiveName,
        companyProfile,
        currencySymbol = 'AED',
        voucherType = 'out', // 'out' for Payment, 'in' for Receipt
        docLabel = 'Payment',
        onRowStatus,
        chunkSize = 1,
        control,
        onBatchStart,
        lookups = {}
    } = context;

    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!rowsToImport || rowsToImport.length === 0) throw new Error('No rows to import');

    const findIdIn = (list, name) => {
        const key = normalizeMasterName(name);
        if (!key) return '';
        const hit = (list || []).find(x => normalizeMasterName(x.name) === key);
        return hit?.id || '';
    };
    const findAnyId = (name) => findIdIn(lookups.parties, name)
        || findIdIn(lookups.accounts, name)
        || findIdIn(lookups.expenses, name)
        || findIdIn(lookups.directExpenseAccounts, name)
        || findIdIn(lookups.incomeAccounts, name)
        || findIdIn(lookups.capitalAccounts, name)
        || findIdIn(lookups.assetAccounts, name);

    const batchImportId = `BATCH_IMP_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const timestampISO = new Date().toISOString();

    const BATCH_CHUNK_SIZE = 400; // safe under 500 limit
    let totalImported = 0;
    const balanceDiffs = new Map(); // path -> netChange

    const trackChange = (ref, amount, deltaType, category) => {
        const path = ref.path;
        if (!balanceDiffs.has(path)) balanceDiffs.set(path, { ref, netChange: 0, category });
        let change = 0;
        if (category === 'account') {
            change = (deltaType === 'in') ? amount : -amount;
        } else if (category === 'expense') {
            change = (deltaType === 'out') ? amount : -amount;
        } else if (category === 'income' || category === 'capital') {
            change = (deltaType === 'in') ? amount : -amount;
        } else {
            // Party / Asset / Others
            change = (deltaType === 'out') ? amount : -amount;
        }
        balanceDiffs.get(path).netChange += change;
    };

    const targetCol = (cat) => (cat === 'account' || cat === 'contra') ? 'accounts' :
        (cat === 'expense' ? 'expenses' : (cat === 'direct_expense' ? 'direct_expenses' : (cat === 'income' ? 'income_accounts' : (cat === 'capital' ? 'capital_accounts' : (cat === 'asset' ? 'asset_accounts' : 'parties')))));

    // Process rows in chunks. chunkSize = 1 gives true one-by-one progress in the UI.
    const CHUNK = Math.min(BATCH_CHUNK_SIZE, Math.max(1, Number(chunkSize) || 1));
    const reportStatus = typeof onRowStatus === 'function' ? onRowStatus : null;
    // Run controls: Pause All / Stop All / Cancel All and per-row stop-resume-cancel
    const ctl = control || {};
    const isStoppedNow = () => (typeof ctl.isStopped === 'function' ? !!ctl.isStopped() : false);
    const isRowSkipped = (id) => (typeof ctl.isRowSkipped === 'function' ? !!ctl.isRowSkipped(id) : false);
    const waitWhilePaused = async () => {
        if (typeof ctl.isPaused !== 'function' || !ctl.isPaused()) return !isStoppedNow();
        while (ctl.isPaused()) {
            if (isStoppedNow()) return false;
            await new Promise(r => setTimeout(r, 150));
        }
        return !isStoppedNow();
    };
    let cancelledCount = 0;
    if (typeof onBatchStart === 'function') onBatchStart(batchImportId);
    for (let i = 0; i < rowsToImport.length; i += CHUNK) {
        const chunk = rowsToImport.slice(i, i + CHUNK).filter(r => {
            if (isStoppedNow() || isRowSkipped(r.id)) {
                cancelledCount++;
                if (reportStatus) reportStatus(r.id, 'cancelled');
                return false;
            }
            return true;
        });
        if (chunk.length === 0) continue;
        if (!(await waitWhilePaused())) {
            chunk.forEach(r => { cancelledCount++; if (reportStatus) reportStatus(r.id, 'cancelled'); });
            continue;
        }
        if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'processing', i, rowsToImport.length));
        const batch = writeBatch(db);

        for (const row of chunk) {
            if (voucherType === 'journal' || row.vchType === 'Journal') {
                const docRef = doc(collection(db, 'journal_vouchers'));
                const drRows = (row.resolvedDrRows || row.drRows || []).map(r => ({
                    type: 'dr',
                    category: r.category || 'expense',
                    id: r.targetId || r.matchedMaster?.id || '',
                    amount: Number(r.amount) || 0,
                    description: r.description || row.narration || ''
                }));
                const crRows = (row.resolvedCrRows || row.crRows || []).map(r => ({
                    type: 'cr',
                    category: r.category || 'party',
                    id: r.targetId || r.matchedMaster?.id || '',
                    amount: Number(r.amount) || 0,
                    description: r.description || row.narration || ''
                }));

                const jvDoc = {
                    date: row.date,
                    refNo: row.vchNo,
                    description: row.narration || `Imported via ${row.format || 'Excel'}`,
                    narration: row.narration || `Imported via ${row.format || 'Excel'}`,
                    type: 'journal',
                    userId: targetUid,
                    ownerId: targetUid,
                    isMulti: true,
                    // Rows are stored in the VOUCHER currency (foreign for FX rows) — the voucher
                    // total is always BASE currency, exactly like a hand-entered JV.
                    amount: Number(row.baseTotal) > 0 ? Number(row.baseTotal) : row.amount * (row.exchangeRate || 1),
                    foreignAmount: Number(row.foreignAmount) || row.amount,
                    foreignTotal: Number(row.foreignAmount) || row.amount,
                    rows: [...drRows, ...crRows],
                    // Ledger statements query journal vouchers by drId / crId, so mirror the first leg
                    drId: drRows[0]?.id || null,
                    drType: drRows[0]?.category || 'expense',
                    crId: crRows[0]?.id || null,
                    crType: crRows[0]?.category || 'party',
                    drName: drRows.map(r => row.resolvedDrRows?.find(x => (x.targetId || x.matchedMaster?.id) === r.id)?.targetName).filter(Boolean).join(', ') || (row.drRows || []).map(r => r.targetName).join(', ') || 'Various',
                    crName: crRows.map(r => row.resolvedCrRows?.find(x => (x.targetId || x.matchedMaster?.id) === r.id)?.targetName).filter(Boolean).join(', ') || (row.crRows || []).map(r => r.targetName).join(', ') || 'Various',
                    currencyId: row.currency ? resolveImportCurrency(row.currency, context, currencySymbol).id : 'BASE',
                    exchangeRate: row.exchangeRate || 1.0,
                    currencySymbol: row.currency ? resolveImportCurrency(row.currency, context, currencySymbol).symbol : currencySymbol,
                    batchImportId,
                    isImported: true,
                    importedAt: timestampISO,
                    importedBy: user.uid,
                    importedByName: effectiveName,
                    createdAt: serverTimestamp(),
                    createdBy: user.uid,
                    createdByName: effectiveName
                };
                batch.set(docRef, jvDoc);
                // Accumulate balance impacts for Journal
                drRows.forEach(r => {
                    if (r.id) {
                        trackChange(doc(db, targetCol(r.category), r.id), r.amount, 'in', r.category); // Dr
                    }
                });
                crRows.forEach(r => {
                    if (r.id) {
                        trackChange(doc(db, targetCol(r.category), r.id), r.amount, 'out', r.category); // Cr
                    }
                });

                totalImported++;
                continue;
            }

            const docRef = doc(collection(db, 'payments'));
            const sourceAccountId = row.matchedPaidFrom?.match?.id || row.paidFromId || findIdIn(lookups.accounts, row.paidFrom);

            const splits = (row.resolvedSplits || []).map((s, idx) => ({
                id: idx + 1,
                category: s.category || 'party',
                targetId: s.targetId || s.matchedMaster?.id || findAnyId(s.targetName) || '',
                targetName: s.targetName || s.matchedMaster?.name || '',
                amount: s.amount || row.amount,
                description: s.description || row.narration || ''
            }));

            // The Ledger module locates payment vouchers through partyId (party ledgers) and
            // accountId / toAccountId (account ledgers), so those must be written explicitly.
            const primaryPartySplit = splits.find(s => s.category === 'party' && s.targetId);
            const primaryAccountSplit = splits.find(s => s.category === 'account' && s.targetId);

            const paymentDoc = {
                date: row.date,
                refNo: row.vchNo,
                type: voucherType,
                accountId: sourceAccountId,
                toAccountId: primaryAccountSplit?.targetId || null,
                partyId: primaryPartySplit?.targetId || null,
                partyName: primaryPartySplit?.targetName || null,
                transactionCategory: 'multi',
                amount: row.amount,
                totalAmount: row.amount,
                // Multi-currency: splits hold the voucher-currency value, the voucher holds both totals.
                foreignAmount: Number(row.foreignAmount) || row.amount,
                foreignTotal: Number(row.foreignAmount) || row.amount,
                narration: row.narration || `Imported via ${row.format || 'Excel'}`,
                description: row.narration || '',
                isMulti: true,
                splits,
                currencyId: row.currency ? resolveImportCurrency(row.currency, context, currencySymbol).id : 'BASE',
                exchangeRate: row.exchangeRate || 1.0,
                currencySymbol: row.currency ? resolveImportCurrency(row.currency, context, currencySymbol).symbol : currencySymbol,
                userId: targetUid,
                ownerId: targetUid,
                // Rule 7: Batch Isolation & Audit Stamps
                batchImportId,
                isImported: true,
                importedAt: timestampISO,
                importedBy: user.uid,
                importedByName: effectiveName,
                createdAt: serverTimestamp(),
                createdBy: user.uid,
                createdByName: effectiveName
            };

            batch.set(docRef, paymentDoc);

            // Accumulate balance impacts
            const rowRate = Number(row.exchangeRate) > 0 ? Number(row.exchangeRate) : 1;
            if (sourceAccountId) {
                trackChange(doc(db, 'accounts', sourceAccountId), row.amount, voucherType, 'account');
            }
            splits.forEach(s => {
                if (s.targetId) {
                    // Split values are in the voucher currency — balances live in BASE currency.
                    trackChange(doc(db, targetCol(s.category), s.targetId), (Number(s.amount) || 0) * rowRate, voucherType, s.category);
                }
            });

            totalImported++;
        }

        try {
            await batch.commit();
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'imported', i, rowsToImport.length));
        } catch (chunkErr) {
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'error', i, rowsToImport.length));
            throw chunkErr;
        }
    }

    // Apply accumulated balance adjustments compatibly with rxfs
    const diffEntries = Array.from(balanceDiffs.values()).filter(d => Math.abs(d.netChange) > 0.0001);
    for (const d of diffEntries) {
        try {
            const snap = await getDoc(d.ref);
            if (snap && snap.exists()) {
                const currentBal = Number(snap.data()?.balance || 0);
                await updateDoc(d.ref, { balance: currentBal + d.netChange });
            }
        } catch (err) {
            console.warn('[ImportEngine] Balance update warning:', err);
        }
    }

    // Create Audit Log Entry
    const auditLogRef = doc(collection(db, 'audit_logs'));
    const auditBatch = writeBatch(db);
    auditBatch.set(auditLogRef, {
        date: serverTimestamp(),
        ownerId: targetUid,
        userId: targetUid,
        userName: effectiveName,
        action: 'IMPORTED',
        docType: voucherType === 'journal' ? 'Journal Voucher' : (voucherType === 'in' ? 'Receipt Voucher' : 'Payment Voucher'),
        refNo: batchImportId,
        amount: rowsToImport.reduce((sum, r) => sum + (r.amount || 0), 0),
        description: `Imported ${totalImported} voucher(s) from ${context.docLabel || 'Excel'} (Batch: ${batchImportId})`,
        batchImportId,
        voucherCount: totalImported
    });
    await auditBatch.commit();

    // Log to local storage batch history
    addBatchHistoryEntry({
        batchImportId,
        timestamp: timestampISO,
        count: totalImported,
        totalAmount: rowsToImport.reduce((sum, r) => sum + (r.amount || 0), 0),
        user: effectiveName,
        voucherType: voucherType === 'journal' ? 'journal' : (voucherType === 'in' ? 'receipt' : 'payment'),
        docLabel: context.docLabel || 'Voucher',
        status: 'COMPLETED'
    });

    return {
        batchImportId,
        totalImported,
        cancelledCount,
        timestamp: timestampISO
    };
}

/**
 * Rolls back an entire import batch (Rule 7)
 */
export async function rollbackBatchImport(batchImportId, context) {
    const { user, dataOwnerId, effectiveName } = context;
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid || !batchImportId) throw new Error('Invalid rollback parameters');

    // 1. Fetch all vouchers with this batchImportId (check payments or journal_vouchers)
    let snap = await getDocs(query(
        collection(db, 'payments'),
        where('userId', '==', targetUid),
        where('batchImportId', '==', batchImportId)
    ));
    let colName = 'payments';

    if (snap.empty) {
        snap = await getDocs(query(
            collection(db, 'journal_vouchers'),
            where('userId', '==', targetUid),
            where('batchImportId', '==', batchImportId)
        ));
        colName = 'journal_vouchers';
    }

    if (snap.empty) {
        snap = await getDocs(query(
            collection(db, 'invoices'),
            where('userId', '==', targetUid),
            where('batchImportId', '==', batchImportId)
        ));
        colName = 'invoices';
    }

    if (snap.empty) {
        snap = await getDocs(query(
            collection(db, 'stock_journals'),
            where('userId', '==', targetUid),
            where('batchImportId', '==', batchImportId)
        ));
        colName = 'stock_journals';
    }

    if (snap.empty) {
        // Master imports (groups / ledgers / items) are tagged the same way
        const masterCollections = [
            'party_groups', 'expense_groups', 'stock_groups',
            'parties', 'accounts', 'expenses', 'direct_expenses',
            'income_accounts', 'capital_accounts', 'asset_accounts',
            'products', 'tax_rates'
        ];
        for (const col of masterCollections) {
            const s = await getDocs(query(
                collection(db, col),
                where('userId', '==', targetUid),
                where('batchImportId', '==', batchImportId)
            ));
            if (!s.empty) { snap = s; colName = col; break; }
        }
    }

    if (snap.empty) {
        throw new Error(`No vouchers found for Batch ID: ${batchImportId}`);
    }

    // 2. Delete in batches of 400
    const docsToDelete = snap.docs;
    const CHUNK_SIZE = 400;

    for (let i = 0; i < docsToDelete.length; i += CHUNK_SIZE) {
        const chunk = docsToDelete.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }

    // 3. Log Rollback in Audit Log
    const auditLogRef = doc(collection(db, 'audit_logs'));
    const auditBatch = writeBatch(db);
    auditBatch.set(auditLogRef, {
        date: serverTimestamp(),
        ownerId: targetUid,
        userId: targetUid,
        userName: effectiveName,
        action: 'ROLLED_BACK',
        docType: 'Imported',
        refNo: batchImportId,
        description: `Rolled back Excel Import Batch: ${batchImportId} (${docsToDelete.length} vouchers deleted)`,
        batchImportId,
        voucherCount: docsToDelete.length
    });
    await auditBatch.commit();

    // 4. Update status in local storage history
    updateBatchHistoryStatus(batchImportId, 'ROLLED_BACK');

    return {
        batchImportId,
        deletedCount: docsToDelete.length
    };
}

/* ==========================================================================================
 * PURCHASE VOUCHER IMPORT (Tally item invoice, GST / VAT aware)
 * - Missing suppliers, stock items and tax ledgers are ROUTED to the Solution Centre for
 *   manual creation (never auto-created).
 * - Posts standard `invoices` documents with type 'purchase', so the app's DERIVED stock,
 *   last-purchase-rate, register and reporting logic keeps working with no extra bookkeeping.
 * - Lots are intentionally not handled here (attach them later in the voucher).
 * ========================================================================================== */

const TAX_LEDGER_RE = /(gst|vat|tax|duty|cess|s\.?\s*tax|input\s*tax|sales\s*tax)/i;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Reads a tag's direct child first (Tally nests allocation lists that carry their own AMOUNT/DATE). */
function readXmlTag(node, tag) {
    const direct = Array.from(node.children || []).find(c => c.tagName === tag);
    const el = direct || node.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim() : '';
}

function numFromTally(text) {
    return parseFloat(String(text || '').replace(/[^0-9.\-]/g, '')) || 0;
}

/** "650 KG" -> { qty: 650, unit: 'KG' } */
function splitQtyUnit(text) {
    const s = String(text || '').trim();
    if (!s) return { qty: 0, unit: '' };
    const m = s.match(/^(-?[\d.,]+)\s*(.*)$/);
    if (!m) return { qty: parseFloat(s) || 0, unit: '' };
    return { qty: parseFloat(m[1].replace(/,/g, '')) || 0, unit: (m[2] || '').trim() };
}

/** "VAT 17%" -> 17, "GST 18" -> 18, "Purchase @ 5%" -> 5 */
export function extractTaxPercent(name) {
    const s = String(name || '');
    const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
    if (TAX_LEDGER_RE.test(s)) {
        const m2 = s.match(/(\d+(?:\.\d+)?)/);
        if (m2) return parseFloat(m2[1]);
    }
    return 0;
}

/**
 * Parses Tally purchase vouchers (item invoices) from Tally ERP 9 / Tally Prime XML.
 */
/* ─────────────────────────────────────────────────────────────────────────────
 * Tally ERP 9 "Day Book / Register" XML export (DBC* tags)
 * ERP 9 has no "Export Data → Vouchers"; `E: Export` on a register produces this
 * flat column layout: one row per ledger/item line, each row starting with
 * <DBCFIXED><DBCDATE/><DBCPARTY/></DBCFIXED>. The first row of a voucher carries
 * the voucher meta (type / number / party / total); following rows are item lines.
 * ──────────────────────────────────────────────────────────────────────────── */
const decodeXmlEntities = (s) => String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

export function isDbcRegisterXml(xmlText) {
    const s = String(xmlText || '');
    return /<DBCFIXED[\s>]/i.test(s) || /<DBCVCHNO[\s>]/i.test(s) || /<DBCPARTYNAME[\s>]/i.test(s);
}

/** Splits the flat DBC register into one object per printed row. */
export function splitDbcRows(xmlText) {
    const parts = String(xmlText || '').split(/<DBCFIXED\s*>/i).slice(1);
    return parts.map((part) => {
        const fixedEnd = part.search(/<\/DBCFIXED>/i);
        const fixedText = fixedEnd >= 0 ? part.slice(0, fixedEnd) : '';
        const body = fixedEnd >= 0 ? part.slice(fixedEnd + '</DBCFIXED>'.length) : part;
        const pick = (tag, src) => {
            const m = new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(src);
            return m ? decodeXmlEntities(m[1]).trim() : '';
        };
        return {
            date: pick('DBCDATE', fixedText),
            fixedParty: pick('DBCPARTY', fixedText),
            partyName: pick('DBCPARTYNAME', body),
            vchType: pick('DBCVCHTYPE', body),
            vchNo: pick('DBCVCHNO', body),
            vchRef: pick('DBCVCHREF', body),
            narration: pick('DBCNARR', body),
            qty: pick('DBCQTY', body),
            altUnits: pick('DBCALTUNITS', body),
            rate: pick('DBCRATE', body),
            amount: pick('DBCAMOUNT', body),
            addlCost: pick('DBCADDLCOST', body),
            grossAmt: pick('DBCGROSSAMT', body),
            ledgerAmt: pick('DBCLEDAMT', body),
        };
    }).filter(r => r.date || r.fixedParty || r.partyName || r.amount);
}

/** Groups rows into vouchers: a row with a voucher number/type starts a new voucher. */
export function groupDbcRows(xmlText) {
    const rows = splitDbcRows(xmlText);
    const groups = [];
    let cur = null;
    const flush = () => { if (cur) groups.push(cur); };
    rows.forEach((r) => {
        const isHeader = !!(r.vchNo || r.vchType) || (!cur && !!r.date);
        if (isHeader) {
            flush();
            cur = { header: r, lines: [] };
        } else if (cur) {
            cur.lines.push(r);
        }
    });
    flush();
    return groups;
}

/**
 * ERP 9 register → purchase vouchers in the same shape the validation middleware expects
 * (party, items with qty/unit/rate/amount, tax entries, totals).
 */
export function parsePurchaseDbcRegister(xmlText, options = {}) {
    const groups = groupDbcRows(sanitizeTallyXml(xmlText));
    if (!groups.length) throw new Error('No register rows were found in this Tally XML.');

    const expectedKind = options.voucherType === 'sales' ? 'sales' : 'purchase';
    const refPrefix = expectedKind === 'sales' ? 'SAL' : 'PUR';
    const fallbackType = expectedKind === 'sales' ? 'Sales' : 'Purchase';
    const typeCounts = {};
    const parsedVouchers = [];
    const skippedTypes = [];
    let skippedVoucherCount = 0;

    groups.forEach((g, index) => {
        const h = g.header || {};
        const vchType = h.vchType || fallbackType;
        typeCounts[vchType] = (typeCounts[vchType] || 0) + 1;

        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== expectedKind) {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            return;
        }

        const items = [];
        const taxEntries = [];
        const otherLines = [];

        g.lines.forEach((l) => {
            const name = (l.fixedParty || l.partyName || '').trim();
            if (!name) return;
            const amount = Math.abs(numFromTally(l.amount));
            const { qty, unit } = splitQtyUnit(l.qty);
            const absQty = Math.abs(qty);

            if (absQty > 0) {
                const rateParts = String(l.rate || '').split('/');
                const rate = Math.abs(numFromTally(rateParts[0]));
                items.push({
                    itemName: name,
                    qty: absQty,
                    unit: unit || (rateParts[1] || '').trim(),
                    rate: rate || (absQty ? amount / absQty : 0),
                    amount: amount || r3(absQty * rate),
                    discount: 0,
                    taxHeads: []
                });
            } else if (TAX_LEDGER_RE.test(name)) {
                taxEntries.push({ name, amount, percent: extractTaxPercent(name) });
            } else if (amount > 0) {
                otherLines.push({ name, amount });
            }
        });

        const itemsTotal = r3(items.reduce((s, i) => s + (i.amount || 0), 0));
        const taxAmount = r3(taxEntries.reduce((s, t) => s + (t.amount || 0), 0));
        const otherTotal = r3(otherLines.reduce((s, o) => s + (o.amount || 0), 0));
        const partyTotal = Math.abs(numFromTally(h.amount));
        const amount = partyTotal || r3(itemsTotal + taxAmount + otherTotal);

        parsedVouchers.push({
            rowNumber: index + 1,
            rawDate: h.date,
            date: parseExcelDate(h.date),
            vchNo: h.vchNo || `${refPrefix}-${index + 1}`,
            vchType,
            partyName: (h.partyName || h.fixedParty || '').trim(),
            supplierInvoiceNo: h.vchRef || '',
            narration: h.narration || '',
            items,
            itemCount: items.length,
            itemsTotal,
            taxEntries,
            taxName: taxEntries.map(t => t.name).join(', '),
            taxPercent: taxEntries.length ? (taxEntries[0].percent || 0) : 0,
            taxAmount,
            otherLines,
            otherTotal,
            ledgerEntries: [],
            amount,
            totalDr: amount,
            totalCr: amount,
            currency: 'BASE',
            exchangeRate: 1.0,
            format: 'tally_erp9_register',
            paidTo: (h.partyName || h.fixedParty || '').trim(),
            paidFrom: '',
            splits: [],
            isMultiSplit: items.length > 1
        });
    });

    return {
        formatType: 'tally_erp9_register',
        headers: ['Date', 'Voucher No', expectedKind === 'sales' ? 'Customer' : 'Supplier', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Tax', 'Narration'],
        vouchers: parsedVouchers,
        expectedVoucherKind: expectedKind,
        detectedVoucherTypes: Object.keys(typeCounts),
        detectedVoucherTypeCounts: typeCounts,
        skippedVoucherCount,
        skippedVoucherTypes: skippedTypes,
        typeMismatch: parsedVouchers.length === 0 && Object.keys(typeCounts).length > 0
    };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * STOCK JOURNAL — ERP 9 register (DBC*) and Tally Prime voucher XML
 * A stock journal posts consumption (source, negative amount) and production
 * (destination, positive amount) of the same material in one voucher.
 * ──────────────────────────────────────────────────────────────────────────── */
export function parseStockJournalDbcRegister(xmlText, options = {}) {
    const groups = groupDbcRows(sanitizeTallyXml(xmlText));
    if (!groups.length) throw new Error('No register rows were found in this Tally XML.');

    const typeCounts = {};
    const skippedTypes = [];
    let skippedVoucherCount = 0;
    const vouchers = [];

    groups.forEach((g, index) => {
        const h = g.header || {};
        const vchType = h.vchType || 'Stock Journal';
        typeCounts[vchType] = (typeCounts[vchType] || 0) + 1;

        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== 'stock_journal') {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            return;
        }

        const consumed = [];
        const produced = [];

        g.lines.forEach((l) => {
            const name = (l.fixedParty || l.partyName || '').trim();
            if (!name) return;
            const { qty, unit } = splitQtyUnit(l.qty);
            const absQty = Math.abs(qty);
            if (!(absQty > 0)) return;
            const rateParts = String(l.rate || '').split('/');
            const rate = Math.abs(numFromTally(rateParts[0]));
            const signedAmount = numFromTally(l.amount);
            const amount = Math.abs(signedAmount) || r3(absQty * rate);
            const entry = {
                itemName: name,
                qty: absQty,
                unit: unit || (rateParts[1] || '').trim(),
                rate: rate || (absQty ? amount / absQty : 0),
                amount,
                discount: 0,
                taxHeads: []
            };
            // ERP 9 prints the consumption (source) leg with a negative amount
            if (signedAmount < 0) consumed.push(entry); else produced.push(entry);
        });

        const consumedTotal = r3(consumed.reduce((s, i) => s + (i.amount || 0), 0));
        const producedTotal = r3(produced.reduce((s, i) => s + (i.amount || 0), 0));
        const items = [
            ...consumed.map(i => ({ ...i, side: 'consumed' })),
            ...produced.map(i => ({ ...i, side: 'produced' }))
        ];

        vouchers.push({
            rowNumber: index + 1,
            rawDate: h.date,
            date: parseExcelDate(h.date),
            vchNo: h.vchNo || `SJ-${index + 1}`,
            vchType,
            narration: h.narration || '',
            partyName: '',
            items,
            itemCount: items.length,
            itemsTotal: producedTotal || consumedTotal,
            consumed,
            produced,
            consumedTotal,
            producedTotal,
            amount: producedTotal || consumedTotal,
            taxEntries: [],
            taxName: '',
            taxPercent: 0,
            taxAmount: 0,
            currency: 'BASE',
            exchangeRate: 1.0,
            format: 'tally_erp9_stock_journal',
            paidTo: '',
            paidFrom: '',
            splits: [],
            isMultiSplit: items.length > 2
        });
    });

    return {
        formatType: 'tally_erp9_stock_journal',
        headers: ['Date', 'Voucher No', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Side', 'Narration'],
        vouchers,
        expectedVoucherKind: 'stock_journal',
        detectedVoucherTypes: Object.keys(typeCounts),
        detectedVoucherTypeCounts: typeCounts,
        skippedVoucherCount,
        skippedVoucherTypes: skippedTypes,
        typeMismatch: vouchers.length === 0 && Object.keys(typeCounts).length > 0
    };
}

/** Tally Prime / ERP 9 Stock Journal voucher XML (Data Interchange). */
export function parseStockJournalXMLFile(xmlText, options = {}) {
    let xmlDoc;
    if (options.doc) {
        xmlDoc = options.doc;
    } else {
        if (isDbcRegisterXml(xmlText)) {
            return parseStockJournalDbcRegister(xmlText, options);
        }
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) throw new Error('Invalid XML file: ' + parseError[0].textContent);
    }

    const voucherNodes = Array.from(xmlDoc.getElementsByTagName('VOUCHER'));
    if (!voucherNodes.length) throw new Error('No <VOUCHER> elements found in this XML document.');

    const typeCounts = {};
    voucherNodes.forEach(v => {
        const t = v.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() || v.getAttribute('VCHTYPE') || '';
        if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const skippedTypes = [];
    let skippedVoucherCount = 0;
    const vouchers = [];

    const readLine = (n, side) => {
        const itemName = readXmlTag(n, 'STOCKITEMNAME');
        if (!itemName) return null;
        const qtyText = readXmlTag(n, 'BILLEDQTY') || readXmlTag(n, 'ACTUALQTY') || readXmlTag(n, 'QUANTITY') || '';
        const { qty, unit } = splitQtyUnit(qtyText);
        const rateFx = parseTallyFxRate(readXmlTag(n, 'RATE'));
        const rate = Math.abs(rateFx.base); // BASE-currency rate (forex "cad5.00 = AED 14.450" -> 14.45)
        const amtFx = parseTallyFxAmount(readXmlTag(n, 'AMOUNT'));
        let amount = Math.abs(amtFx.base);
        if (!amount) {
            const alloc = n.getElementsByTagName('ACCOUNTINGALLOCATIONS.LIST')[0];
            if (alloc) amount = Math.abs(parseTallyFxAmount(readXmlTag(alloc, 'AMOUNT')).base);
        }
        const absQty = Math.abs(qty);
        return {
            itemName,
            qty: absQty,
            unit: unit || readXmlTag(n, 'UNIT') || '',
            rate: rate || (absQty ? amount / absQty : 0),
            amount: amount || r3(absQty * rate),
            discount: 0,
            taxHeads: [],
            side
        };
    };

    voucherNodes.forEach((vNode, index) => {
        const vchType = vNode.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
            vNode.getAttribute('VCHTYPE') || 'Stock Journal';
        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== 'stock_journal') {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            return;
        }

        // Tally writes a Stock Journal as two item lists, but the names are counter-intuitive:
        //   INVENTORYENTRIESIN.LIST  → Destination (Production)  — ISDEEMEDPOSITIVE = Yes, amount negative
        //   INVENTORYENTRIESOUT.LIST → Source (Consumption)      — ISDEEMEDPOSITIVE = No,  amount positive
        // (verified against Tally's own voucher screen: Source/Consumption = OUT list).
        let produced = Array.from(vNode.getElementsByTagName('INVENTORYENTRIESIN.LIST')).map(n => readLine(n, 'produced')).filter(Boolean);
        let consumed = Array.from(vNode.getElementsByTagName('INVENTORYENTRIESOUT.LIST')).map(n => readLine(n, 'consumed')).filter(Boolean);

        if (consumed.length === 0 && produced.length === 0) {
            // Fallback: generic item list — trust ISDEEMEDPOSITIVE first, then the amount sign.
            const generic = Array.from(vNode.getElementsByTagName('ALLINVENTORYENTRIES.LIST'))
                .concat(Array.from(vNode.getElementsByTagName('INVENTORYENTRIES.LIST')));
            consumed = [];
            produced = [];
            generic.forEach(n => {
                const deemed = (readXmlTag(n, 'ISDEEMEDPOSITIVE') || '').toLowerCase();
                const signed = parseTallyFxAmount(readXmlTag(n, 'AMOUNT')).base;
                const isProduced = deemed ? (deemed === 'yes') : (signed < 0);
                const line = readLine(n, isProduced ? 'produced' : 'consumed');
                if (!line) return;
                (isProduced ? produced : consumed).push(line);
            });
        }

        const consumedTotal = r3(consumed.reduce((s, i) => s + (i.amount || 0), 0));
        const producedTotal = r3(produced.reduce((s, i) => s + (i.amount || 0), 0));
        const items = [...consumed, ...produced];

        vouchers.push({
            rowNumber: index + 1,
            rawDate: readXmlTag(vNode, 'DATE'),
            date: parseExcelDate(readXmlTag(vNode, 'DATE')),
            vchNo: readXmlTag(vNode, 'VOUCHERNUMBER') || `SJ-${index + 1}`,
            vchType,
            narration: readXmlTag(vNode, 'NARRATION'),
            partyName: '',
            items,
            itemCount: items.length,
            itemsTotal: producedTotal || consumedTotal,
            consumed,
            produced,
            consumedTotal,
            producedTotal,
            amount: producedTotal || consumedTotal,
            taxEntries: [],
            taxName: '',
            taxPercent: 0,
            taxAmount: 0,
            currency: 'BASE',
            exchangeRate: 1.0,
            format: 'tally_xml_stock_journal',
            paidTo: '',
            paidFrom: '',
            splits: [],
            isMultiSplit: items.length > 2
        });
    });

    return {
        formatType: 'tally_xml_stock_journal',
        headers: ['Date', 'Voucher No', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Side', 'Narration'],
        vouchers,
        expectedVoucherKind: 'stock_journal',
        detectedVoucherTypes: Object.keys(typeCounts),
        detectedVoucherTypeCounts: typeCounts,
        skippedVoucherCount,
        skippedVoucherTypes: skippedTypes,
        typeMismatch: vouchers.length === 0 && Object.keys(typeCounts).length > 0
    };
}

/** Universal loader for stock journal files: .xml -> Tally parser. */
export async function parseStockJournalUniversalFile(file, options = {}) {
    const text = await readXmlFileText(file);
    return parseStockJournalXMLFile(text, options);
}

/**
 * Validates stock journal vouchers: stock items must exist (or be created from
 * the Solution Centre), quantities must be positive, and both a consumption and
 * a production side must be present.
 */
export function validateStockJournalBatch(vouchers, context = {}) {
    const { existingVouchers = [], masters = {}, companyProfile = {} } = context;
    const lockDate = companyProfile?.rules?.lockDate || null;
    const existingRefSet = new Set(
        (existingVouchers || []).map(v => String(v.refNo || '').trim().toLowerCase()).filter(Boolean)
    );

    const cleanRows = [];
    const quarantinedRows = [];
    const seenRefs = new Set();

    (vouchers || []).forEach((v, index) => {
        const issues = [];
        const push = (type, rule, message, extra = {}) => issues.push({ type, rule, message, ...extra });

        if (!v.date) push('CRITICAL', 'RULE_4_MANDATORY', 'Missing voucher date', { field: 'date' });
        if (!v.items || v.items.length === 0) push('CRITICAL', 'RULE_4_MANDATORY', 'No item lines found in this stock journal', { field: 'items' });
        if (!(v.consumed || []).length) push('CRITICAL', 'RULE_4_MANDATORY', 'No consumption (source) lines found', { field: 'consumed' });
        if (!(v.produced || []).length) push('CRITICAL', 'RULE_4_MANDATORY', 'No production (destination) lines found', { field: 'produced' });

        if (lockDate && v.date && v.date <= lockDate) {
            push('CRITICAL', 'RULE_6_PERIOD_LOCK', `Date ${v.date} is on/before the locked date ${lockDate}`, { field: 'date' });
        }

        const ref = String(v.vchNo || '').trim();
        if (ref && existingRefSet.has(ref.toLowerCase())) {
            push('CRITICAL', 'RULE_1_DUPLICATE_REF', `Voucher no. ${ref} already exists in the system`, { solution: 'auto_renumber_or_skip' });
        } else if (ref && seenRefs.has(ref.toLowerCase())) {
            push('WARNING', 'RULE_1_DUPLICATE_REF', `Voucher no. ${ref} repeats within this file`, { solution: 'confirm_multi_line' });
        }
        if (ref) seenRefs.add(ref.toLowerCase());

        const resolvedItems = (v.items || []).map((it, ii) => {
            const pm = matchMaster(it.itemName, { products: masters.products || [] });
            if (pm.match) {
                if (!pm.isExact) {
                    push('INFO', 'RULE_5_FUZZY_MATCH', `Item "${it.itemName}" fuzzy-matched to "${pm.match.name}" (${Math.round(pm.score * 100)}%)`, { suggestion: { ...pm, itemIndex: ii }, field: `items[${ii}]`, missingType: 'product', missingName: it.itemName });
                }
            } else {
                push('CRITICAL', 'RULE_2_MISSING_MASTER', `Stock item "${it.itemName}" does not exist in Items`, { field: `items[${ii}]`, missingType: 'product', missingName: it.itemName });
            }
            if (!(Number(it.qty) > 0)) push('CRITICAL', 'RULE_4_MANDATORY', `Item "${it.itemName}" has no quantity`, { field: `items[${ii}]` });
            return { ...it, matchedMaster: pm.match || null, productId: pm.match?.id || '' };
        });

        const consumedTotal = r3(resolvedItems.filter(i => i.side !== 'produced').reduce((s, i) => s + (i.amount || 0), 0));
        const producedTotal = r3(resolvedItems.filter(i => i.side === 'produced').reduce((s, i) => s + (i.amount || 0), 0));

        const hasCritical = issues.some(i => i.type === 'CRITICAL');
        const hasWarning = issues.some(i => i.type === 'WARNING');
        const status = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'VALID';

        const rowItem = {
            id: `sjrow_${index + 1}_${v.vchNo || Date.now()}`,
            ...v,
            status,
            issues,
            isResolved: !hasCritical,
            resolvedItems,
            consumedTotal: consumedTotal || v.consumedTotal || 0,
            producedTotal: producedTotal || v.producedTotal || 0,
            amount: producedTotal || v.amount || 0,
            taxEntries: [],
            resolvedTax: []
        };

        if (hasCritical || hasWarning) quarantinedRows.push(rowItem);
        else cleanRows.push(rowItem);
    });

    return {
        totalParsed: (vouchers || []).length,
        cleanRows,
        quarantinedRows,
        stats: {
            validCount: cleanRows.length,
            quarantinedCount: quarantinedRows.length,
            totalAmount: (vouchers || []).reduce((sum, v) => sum + (v.amount || 0), 0)
        }
    };
}

/** Posts validated stock journals into the `stock_journals` collection. */
export async function executeStockJournalImport(rowsToImport, context = {}) {
    beginBulk();
    try {
        return await runStockJournalImport(rowsToImport, context);
    } finally {
        endBulk();
    }
}

async function runStockJournalImport(rowsToImport, context = {}) {
    const { user, dataOwnerId, effectiveName, onRowStatus, chunkSize = 1, control, onBatchStart, lookups = {} } = context;
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!rowsToImport || rowsToImport.length === 0) throw new Error('No rows to import');

    const findProductId = (name) => {
        const key = normalizeMasterName(name);
        if (!key) return '';
        const hit = (lookups.products || []).find(x => normalizeMasterName(x.name) === key);
        return hit?.id || '';
    };

    const batchImportId = `BATCH_SJ_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const timestampISO = new Date().toISOString();
    const BATCH_CHUNK_SIZE = 400;
    let totalImported = 0;
    let totalValue = 0;

    const CHUNK = Math.min(BATCH_CHUNK_SIZE, Math.max(1, Number(chunkSize) || 1));
    const reportStatus = typeof onRowStatus === 'function' ? onRowStatus : null;
    const ctl = control || {};
    const isStoppedNow = () => (typeof ctl.isStopped === 'function' ? !!ctl.isStopped() : false);
    const isRowSkipped = (id) => (typeof ctl.isRowSkipped === 'function' ? !!ctl.isRowSkipped(id) : false);
    const waitWhilePaused = async () => {
        if (typeof ctl.isPaused !== 'function' || !ctl.isPaused()) return !isStoppedNow();
        while (ctl.isPaused()) {
            if (isStoppedNow()) return false;
            await new Promise(r => setTimeout(r, 150));
        }
        return !isStoppedNow();
    };
    let cancelledCount = 0;
    if (typeof onBatchStart === 'function') onBatchStart(batchImportId);

    for (let i = 0; i < rowsToImport.length; i += CHUNK) {
        const chunk = rowsToImport.slice(i, i + CHUNK).filter(r => {
            if (isStoppedNow() || isRowSkipped(r.id)) {
                cancelledCount++;
                if (reportStatus) reportStatus(r.id, 'cancelled');
                return false;
            }
            return true;
        });
        if (chunk.length === 0) continue;
        if (!(await waitWhilePaused())) {
            chunk.forEach(r => { cancelledCount++; if (reportStatus) reportStatus(r.id, 'cancelled'); });
            continue;
        }
        if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'processing', i, rowsToImport.length));
        const batch = writeBatch(db);

        for (const row of chunk) {
            const lines = row.resolvedItems || row.items || [];
            const toEntry = (it, extra = {}) => ({
                productId: it.productId || it.matchedMaster?.id || findProductId(it.itemName),
                quantity: r3(it.qty ?? it.quantity),
                rate: r3(it.rate),
                total: r3(it.amount ?? it.total ?? (Number(it.qty) || 0) * (Number(it.rate) || 0)),
                lotId: null,
                pcs: 0,
                ...extra
            });

            const consumed = lines.filter(it => it.side !== 'produced').map(it => toEntry(it));
            const producedEntries = lines
                .filter(it => it.side === 'produced')
                .map(it => toEntry(it));
            const consumedQty = consumed.reduce((s, i) => s + (i.quantity || 0), 0);
            producedEntries.forEach(e => { e.percent = consumedQty > 0 ? r3((e.quantity / consumedQty) * 100) : 0; });

            const consumedTotal = r3(consumed.reduce((s, i) => s + (i.total || 0), 0));
            const producedTotal = r3(producedEntries.reduce((s, i) => s + (i.total || 0), 0));

            const docRef = doc(collection(db, 'stock_journals'));
            batch.set(docRef, {
                date: row.date,
                refNo: row.vchNo,
                narration: row.narration || `Imported ${row.format === 'tally_xml_stock_journal' ? 'from Tally XML' : 'from Tally ERP 9 register'}`,
                type: 'manufacturing',
                consumed,
                produced: producedEntries,
                journalExpenses: [],
                creditAccountId: null,
                expenseJournalId: null,
                consumedTotal,
                producedTotal,
                jumboEnabled: false,
                bagCount: 0,
                jumboBags: [],
                soldBags: [],
                productionStaffIds: [],
                userId: targetUid,
                ownerId: targetUid,
                batchImportId,
                isImported: true,
                importedAt: timestampISO,
                importedBy: user.uid,
                importedByName: effectiveName,
                createdAt: serverTimestamp(),
                createdBy: user.uid,
                createdByName: effectiveName,
                updatedAt: serverTimestamp(),
                lastModifiedBy: user.uid,
                lastModifiedByName: effectiveName,
                lastModifiedAt: serverTimestamp()
            });

            totalImported++;
            totalValue += producedTotal;
        }

        try {
            await batch.commit();
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'imported', i, rowsToImport.length));
        } catch (chunkErr) {
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'error', i, rowsToImport.length));
            throw chunkErr;
        }
    }

    const auditBatch = writeBatch(db);
    auditBatch.set(doc(collection(db, 'audit_logs')), {
        date: serverTimestamp(),
        ownerId: targetUid,
        userId: targetUid,
        userName: effectiveName,
        action: 'IMPORTED',
        docType: 'Stock Journal',
        refNo: batchImportId,
        amount: totalValue,
        description: `Imported ${totalImported} stock journal voucher(s) from ${context.docLabel || 'Excel/XML'} (Batch: ${batchImportId})`,
        batchImportId,
        voucherCount: totalImported
    });
    await auditBatch.commit();

    addBatchHistoryEntry({
        batchImportId,
        timestamp: timestampISO,
        count: totalImported,
        totalAmount: totalValue,
        user: effectiveName,
        voucherType: 'stock_journal',
        docLabel: 'Stock Journal',
        status: 'COMPLETED'
    });

    return { batchImportId, totalImported, totalValue, cancelledCount, timestamp: timestampISO };
}

export function parsePurchaseXMLFile(xmlText, options = {}) {
    let xmlDoc;
    if (options.doc) {
        xmlDoc = options.doc;
    } else {
        if (isDbcRegisterXml(xmlText)) {
            return parsePurchaseDbcRegister(xmlText, options);
        }
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');

        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error('Invalid XML file: ' + parseError[0].textContent);
        }
    }

    const voucherNodes = Array.from(xmlDoc.getElementsByTagName('VOUCHER'));
    if (!voucherNodes.length) {
        throw new Error('No <VOUCHER> elements found in this XML document.');
    }

    const typeCounts = {};
    voucherNodes.forEach(v => {
        const t = v.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() || v.getAttribute('VCHTYPE') || '';
        if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const detectedVoucherTypes = Object.keys(typeCounts);
    const skippedTypes = [];
    let skippedVoucherCount = 0;

    const expectedKind = options.voucherType === 'sales' ? 'sales' : 'purchase';
    const refPrefix = expectedKind === 'sales' ? 'SAL' : 'PUR';
    const fallbackType = expectedKind === 'sales' ? 'Sales' : 'Purchase';
    const parsedVouchers = [];

    voucherNodes.forEach((vNode, index) => {
        const vchType = vNode.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
                        vNode.getAttribute('VCHTYPE') || fallbackType;

        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== expectedKind) {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            return;
        }

        const rawDate = vNode.getElementsByTagName('DATE')[0]?.textContent?.trim();
        const vchNo = vNode.getElementsByTagName('VOUCHERNUMBER')[0]?.textContent?.trim() || `${refPrefix}-${index + 1}`;
        const supplierInvoiceNo = vNode.getElementsByTagName('REFERENCE')[0]?.textContent?.trim() ||
                                  vNode.getElementsByTagName('SUPPLIERINVOICENO')[0]?.textContent?.trim() || '';
        const narration = vNode.getElementsByTagName('NARRATION')[0]?.textContent?.trim() || '';
        const partyName = vNode.getElementsByTagName('PARTYLEDGERNAME')[0]?.textContent?.trim() ||
                          vNode.getElementsByTagName('BASICBUYERNAME')[0]?.textContent?.trim() ||
                          vNode.getElementsByTagName('PARTYNAME')[0]?.textContent?.trim() || '';

        // Item lines — Prime/9 write INVENTORYENTRIES.LIST (and ALLINVENTORYENTRIES.LIST in registers)
        const invNodes = Array.from(vNode.getElementsByTagName('ALLINVENTORYENTRIES.LIST'))
            .concat(Array.from(vNode.getElementsByTagName('INVENTORYENTRIES.LIST')));

        const items = invNodes.map(n => {
            const itemName = readXmlTag(n, 'STOCKITEMNAME');
            const qtyText = readXmlTag(n, 'BILLEDQTY') || readXmlTag(n, 'ACTUALQTY') || readXmlTag(n, 'QUANTITY') || '';
            const { qty, unit } = splitQtyUnit(qtyText);
            const rateFx = parseTallyFxRate(readXmlTag(n, 'RATE'));
            // Item values stay in the VOUCHER currency (foreign for FX invoices), same as the
            // app's own invoice model, where items/tax are foreign and totalAmount is base.
            const rate = rateFx.isForeign ? Math.abs(rateFx.foreign) : Math.abs(rateFx.base);
            const amtFx = parseTallyFxAmount(readXmlTag(n, 'AMOUNT'));
            const amount = Math.abs(amtFx.isForeign ? amtFx.foreign : amtFx.base);
            const discount = Math.abs(numFromTally(readXmlTag(n, 'DISCOUNT')));
            // GST / VAT rate heads live inside the item's RATEDETAILS.LIST on Tally item invoices
            const taxHeads = Array.from(n.getElementsByTagName('RATEDETAILS.LIST')).map(rl => {
                const head = readXmlTag(rl, 'GSTRATEDUTYHEAD') || readXmlTag(rl, 'VATRATEDUTYHEAD') ||
                             readXmlTag(rl, 'GSTDUTYHEAD') || readXmlTag(rl, 'RATEDUTYHEAD') || '';
                const pct = numFromTally(readXmlTag(rl, 'GSTRATE')) || numFromTally(readXmlTag(rl, 'VATRATE')) ||
                            numFromTally(readXmlTag(rl, 'RATE')) || 0;
                return (head || pct) ? { head: head || 'Tax', percent: pct } : null;
            }).filter(Boolean);
            return {
                itemName,
                qty: Math.abs(qty) || 0,
                unit: unit || readXmlTag(n, 'UNIT') || '',
                rate: Math.abs(rate) || 0,
                amount: amount || (Math.abs(qty) * Math.abs(rate)) || 0,
                baseAmount: Math.abs(amtFx.base) || 0,
                isForeign: rateFx.isForeign || amtFx.isForeign,
                currency: amtFx.currency || '',
                exchangeRate: amtFx.isForeign ? amtFx.rate : (rateFx.rate || 1),
                discount,
                taxHeads
            };
        }).filter(i => i.itemName);

        // Ledger legs — supplier, purchase/expense account, tax ledgers (GST/VAT/duty), round-off
        const ledgerNodes = Array.from(vNode.getElementsByTagName('ALLLEDGERENTRIES.LIST'))
            .concat(Array.from(vNode.getElementsByTagName('LEDGERENTRIES.LIST')));

        const ledgerEntries = ledgerNodes.map(n => {
            const name = readXmlTag(n, 'LEDGERNAME');
            const amtFx = parseTallyFxAmount(readXmlTag(n, 'AMOUNT'));
            const rawAmt = amtFx.isForeign ? amtFx.foreign : amtFx.base;
            const isDeemedPositive = (readXmlTag(n, 'ISDEEMEDPOSITIVE') || '').toLowerCase() === 'yes';
            const isParty = (readXmlTag(n, 'ISPARTYLEDGER') || '').toLowerCase() === 'yes' ||
                            !!(partyName && name && name.trim().toLowerCase() === partyName.trim().toLowerCase());
            return {
                name,
                amount: Math.abs(rawAmt),
                signedAmount: rawAmt,
                baseAmount: Math.abs(amtFx.base),
                isDeemedPositive,
                isParty,
                isForeign: amtFx.isForeign,
                currency: amtFx.currency,
                exchangeRate: amtFx.rate,
                isTax: !isParty && TAX_LEDGER_RE.test(name)
            };
        }).filter(l => l.name);

        // Voucher-level currency: any forex leg carries the code + the base rate for the whole voucher.
        const fxLeg = ledgerEntries.find(l => l.isForeign) || items.find(i => i.isForeign);
        const voucherCurrency = fxLeg ? (fxLeg.currency || '') : '';
        const voucherRate = fxLeg && fxLeg.exchangeRate > 0 ? fxLeg.exchangeRate : 1;

        const taxEntries = ledgerEntries.filter(l => l.isTax).map(t => ({
            name: t.name,
            amount: t.amount,
            percent: extractTaxPercent(t.name)
        }));

        const itemsTotal = items.reduce((s, i) => s + (i.amount || 0), 0);
        const nonTaxLedgerTotal = ledgerEntries.filter(l => !l.isParty && !l.isTax).reduce((s, l) => s + l.amount, 0);
        const resolvedParty = partyName || (ledgerEntries.find(l => l.isParty)?.name || '');
        const amount = itemsTotal || nonTaxLedgerTotal || 0;

        // Item invoices carry the tax inside the party ledger (and the rate heads inside the item),
        // so derive the tax amount / heads when no explicit tax ledger leg exists.
        // Anything that cannot be tied to a real rate head (freight / loading / rent legs, round-off)
        // is kept as a DERIVED voucher-level amount — it must never demand a Tax master.
        const partyLedgerAmount = ledgerEntries.find(l => l.isParty)?.amount || 0;
        const embeddedTax = Math.max(0, r3(partyLedgerAmount - itemsTotal));
        if (taxEntries.length === 0 && (embeddedTax > 0 || items.some(i => (i.taxHeads || []).length > 0))) {
            const heads = [];
            items.forEach(i => (i.taxHeads || []).forEach(h => {
                if (h.percent > 0 && !heads.some(x => x.head === h.head && x.percent === h.percent)) heads.push(h);
            }));
            if (heads.length > 0) {
                heads.forEach((h, hi) => taxEntries.push({
                    name: `${h.head} ${h.percent}%`.trim(),
                    amount: hi === 0 ? embeddedTax : 0,
                    percent: h.percent,
                    derived: true
                }));
            } else if (embeddedTax > 0) {
                taxEntries.push({ name: 'Tax / Charges (from voucher)', amount: embeddedTax, percent: 0, derived: true });
            }
        }
        const taxTotal = taxEntries.reduce((s, t) => s + (t.amount || 0), 0);
        // Voucher value in the voucher currency (items + tax/charges); base figure lives in `amount`.
        const voucherForeignTotal = r3(amount + taxTotal);
        const amountBase = voucherCurrency ? r3(voucherForeignTotal * voucherRate) : amount;

        parsedVouchers.push({
            rowNumber: index + 1,
            rawDate,
            date: parseExcelDate(rawDate),
            vchNo,
            vchType,
            partyName: resolvedParty,
            supplierInvoiceNo: expectedKind === 'sales' ? '' : supplierInvoiceNo,
            narration,
            items,
            itemCount: items.length,
            itemsTotal,
            taxEntries,
            taxName: taxEntries.map(t => t.name).join(', '),
            taxPercent: taxEntries.length ? (taxEntries[0].percent || 0) : 0,
            taxAmount: taxTotal,
            ledgerEntries,
            amount: amountBase,
            foreignAmount: voucherCurrency ? voucherForeignTotal : amount,
            foreignTotal: voucherCurrency ? voucherForeignTotal : amount,
            baseTotal: amountBase,
            totalDr: ledgerEntries.filter(l => l.isDeemedPositive).reduce((s, l) => s + l.amount, 0),
            totalCr: ledgerEntries.filter(l => !l.isDeemedPositive).reduce((s, l) => s + l.amount, 0),
            currency: voucherCurrency || 'BASE',
            exchangeRate: voucherCurrency ? voucherRate : 1.0,
            isForeign: !!voucherCurrency,
            format: expectedKind === 'sales' ? 'tally_xml_sales' : 'tally_xml_purchase',
            paidTo: resolvedParty,
            paidFrom: '',
            splits: [],
            isMultiSplit: items.length > 1
        });
    });

    return {
        formatType: expectedKind === 'sales' ? 'tally_xml_sales' : 'tally_xml_purchase',
        headers: ['Date', 'Voucher No', expectedKind === 'sales' ? 'Customer' : 'Supplier', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Tax', 'Narration'],
        vouchers: parsedVouchers,
        expectedVoucherKind: expectedKind,
        detectedVoucherTypes,
        detectedVoucherTypeCounts: typeCounts,
        skippedVoucherCount,
        skippedVoucherTypes: skippedTypes,
        typeMismatch: parsedVouchers.length === 0 && detectedVoucherTypes.length > 0
    };
}

/**
 * Parses an Excel/CSV purchase sheet: one row per item line, grouped into vouchers.
 * Recognised headers: Date, Voucher No/Ref No, Supplier/Party, Item/Product, Qty, Unit,
 * Rate, Amount, Discount, Tax/GST, Tax %, Narration, Bill/Supplier Invoice No.
 */
export async function parsePurchaseExcelRows(arrayBuffer, options = {}) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    if (!raw || raw.length < 2) throw new Error('The sheet appears to be empty.');

    const colOf = (row, patterns) => {
        for (let c = 0; c < row.length; c++) {
            const h = String(row[c] || '').trim();
            if (h && patterns.some(p => p.test(h))) return c;
        }
        return -1;
    };

    let headerIdx = 0;
    let cols = null;
    for (let i = 0; i < Math.min(15, raw.length); i++) {
        const row = raw[i] || [];
        const probe = {
            date: colOf(row, [/^date$/i, /voucher\s*date/i, /bill\s*date/i]),
            vch: colOf(row, [/voucher\s*no/i, /vch\s*no/i, /ref\s*no/i, /^reference$/i]),
            party: colOf(row, [/supplier/i, /party/i, /^ledger$/i, /account/i]),
            item: colOf(row, [/item/i, /product/i, /stock\s*item/i, /particular/i, /description/i]),
            qty: colOf(row, [/^qty$/i, /quantity/i, /billed\s*qty/i]),
            rate: colOf(row, [/^rate$/i, /^price$/i]),
            amount: colOf(row, [/^amount$/i, /^value$/i, /^total$/i, /gross/i]),
            tax: colOf(row, [/tax\s*amount/i, /gst\s*amount/i, /vat\s*amount/i, /^tax$/i]),
            taxPct: colOf(row, [/tax\s*%|tax\s*percent|gst\s*%/i, /rate\s*%/i]),
        };
        if (probe.date >= 0 && (probe.party >= 0 || probe.item >= 0 || probe.vch >= 0)) {
            headerIdx = i;
            cols = probe;
            break;
        }
    }

    if (!cols) {
        throw new Error('Could not detect purchase columns. Include at least Date, Voucher No, Supplier and Item headers (see the purchase template).');
    }

    const unitCol = colOf(raw[headerIdx] || [], [/^unit$/i, /uom/i]);
    const discCol = colOf(raw[headerIdx] || [], [/discount/i, /^disc$/i]);
    const billCol = colOf(raw[headerIdx] || [], [/bill\s*no/i, /supplier\s*inv/i, /invoice\s*no/i]);
    const narrCol = colOf(raw[headerIdx] || [], [/narration/i, /remarks/i, /note/i]);

    const vouchersByKey = new Map();

    for (let i = headerIdx + 1; i < raw.length; i++) {
        const row = raw[i] || [];
        const cell = (idx) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
        const date = parseExcelDate(cell(cols.date));
        const vchNo = cell(cols.vch);
        const partyName = cell(cols.party);
        const itemName = cell(cols.item);
        if (!date && !vchNo && !itemName) continue;

        const qty = Number(String(cell(cols.qty)).replace(/,/g, '')) || 0;
        const rate = Number(String(cell(cols.rate)).replace(/,/g, '')) || 0;
        const amount = Number(String(cell(cols.amount)).replace(/,/g, '')) || (qty * rate);
        const taxAmount = Number(String(cell(cols.tax)).replace(/,/g, '')) || 0;
        const taxPercent = Number(String(cell(cols.taxPct)).replace(/[^0-9.]/g, '')) || 0;
        const key = `${date || ''}|${vchNo || `ROW-${i}`}`;

        if (!vouchersByKey.has(key)) {
            vouchersByKey.set(key, {
                rowNumber: vouchersByKey.size + 1,
                rawDate: cell(cols.date),
                date,
                vchNo: vchNo || `PUR-${vouchersByKey.size + 1}`,
                vchType: 'Purchase',
                partyName,
                supplierInvoiceNo: cell(billCol),
                narration: cell(narrCol),
                items: [],
                taxEntries: [],
                taxName: cell(cols.tax) ? 'Tax (from file)' : '',
                taxPercent,
                taxAmount: 0,
                ledgerEntries: [],
                amount: 0,
                currency: 'BASE',
                exchangeRate: 1.0,
                format: 'purchase_excel',
                paidTo: partyName,
                paidFrom: '',
                splits: [],
                isMultiSplit: false
            });
        }

        const v = vouchersByKey.get(key);
        if (itemName) {
            v.items.push({
                itemName,
                qty,
                unit: cell(unitCol),
                rate,
                amount,
                discount: Number(String(cell(discCol)).replace(/,/g, '')) || 0
            });
        }
        if (taxAmount) v.taxAmount += taxAmount;
        if (!v.partyName && partyName) v.partyName = partyName;
        if (!v.narration && cell(narrCol)) v.narration = cell(narrCol);
    }

    const vouchers = Array.from(vouchersByKey.values()).map(v => {
        const itemsTotal = v.items.reduce((s, i) => s + (i.amount || 0), 0);
        const taxAmount = v.taxAmount || r3(itemsTotal * (v.taxPercent || 0) / 100);
        return {
            ...v,
            itemCount: v.items.length,
            itemsTotal,
            taxAmount,
            amount: itemsTotal,
            isMultiSplit: v.items.length > 1
        };
    });

    return {
        formatType: 'purchase_excel',
        headers: ['Date', 'Voucher No', 'Supplier', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Tax'],
        vouchers,
        expectedVoucherKind: 'purchase',
        detectedVoucherTypes: ['Purchase (Excel)'],
        skippedVoucherCount: 0,
        skippedVoucherTypes: [],
        typeMismatch: vouchers.length === 0
    };
}

/** Universal loader for purchase files: .xml -> Tally parser, otherwise Excel/CSV. */
export async function parsePurchaseUniversalFile(file, options = {}) {
    const fileName = (file.name || '').toLowerCase();
    if (fileName.endsWith('.xml')) {
        const text = await readXmlFileText(file);
        return parsePurchaseXMLFile(text, options);
    }
    const buffer = await file.arrayBuffer();
    return parsePurchaseExcelRows(buffer, options);
}

/**
 * Validates parsed purchase vouchers. Missing suppliers, stock items and tax masters are
 * CRITICAL and surfaced as actionable Solution Centre items (create them from there).
 */
export function validatePurchaseBatch(vouchers, context = {}) {
    const { existingVouchers = [], masters = {}, companyProfile = {} } = context;
    const isSales = context.voucherType === 'sales';
    const partyLabel = isSales ? 'Customer' : 'Supplier';
    const docWord = isSales ? 'sales' : 'purchase';
    const lockDate = companyProfile?.rules?.lockDate || null;
    const existingRefSet = new Set(
        (existingVouchers || []).map(v => String(v.refNo || '').trim().toLowerCase()).filter(Boolean)
    );

    const cleanRows = [];
    const quarantinedRows = [];
    const seenRefs = new Set();

    (vouchers || []).forEach((v, index) => {
        const issues = [];
        const push = (type, rule, message, extra = {}) => issues.push({ type, rule, message, ...extra });

        // Rule 4 — mandatory fields
        if (!v.date) push('CRITICAL', 'RULE_4_MANDATORY', 'Missing voucher date', { field: 'date' });
        if (!v.partyName) push('CRITICAL', 'RULE_4_MANDATORY', `Missing ${partyLabel.toLowerCase()} / party name`, { field: 'partyName' });
        if (!v.items || v.items.length === 0) push('CRITICAL', 'RULE_4_MANDATORY', `No item lines found for this ${docWord} voucher`, { field: 'items' });
        if (!(Number(v.amount) > 0)) push('CRITICAL', 'RULE_4_MANDATORY', 'Voucher amount is zero', { field: 'amount' });

        // Rule 6 — period lock
        if (lockDate && v.date && v.date <= lockDate) {
            push('CRITICAL', 'RULE_6_PERIOD_LOCK', `Date ${v.date} is on/before the locked date ${lockDate}`, { field: 'date' });
        }

        // Rule 1 — duplicates
        const ref = String(v.vchNo || '').trim();
        if (ref && existingRefSet.has(ref.toLowerCase())) {
            push('CRITICAL', 'RULE_1_DUPLICATE_REF', `Voucher no. ${ref} already exists in the system`, { solution: 'auto_renumber_or_skip' });
        } else if (ref && seenRefs.has(ref.toLowerCase())) {
            push('WARNING', 'RULE_1_DUPLICATE_REF', `Voucher no. ${ref} repeats within this file`, { solution: 'confirm_multi_line' });
        }
        if (ref) seenRefs.add(ref.toLowerCase());

        // Rule 3 — FX
        if (v.currency && v.currency !== 'BASE' && !(Number(v.exchangeRate) > 0)) {
            push('WARNING', 'RULE_3_MISSING_FX', 'Foreign currency without an FX rate', { field: 'exchangeRate' });
        }

        // Rule 2 / 5 — supplier
        let matchedParty = null;
        if (v.partyName) {
            const pm = matchMaster(v.partyName, { parties: masters.parties || [] });
            if (pm.match) {
                matchedParty = pm.match;
                if (!pm.isExact) {
                    push('INFO', 'RULE_5_FUZZY_MATCH', `${partyLabel} fuzzy-matched to "${pm.match.name}" (${Math.round(pm.score * 100)}%)`, { suggestion: pm, field: 'partyName', missingType: 'party', missingName: v.partyName });
                }
            } else {
                push('CRITICAL', 'RULE_2_MISSING_MASTER', `${partyLabel} "${v.partyName}" does not exist in Parties`, { field: 'partyName', missingType: 'party', missingName: v.partyName });
            }
        }

        // Rule 2 / 5 — stock items + line sanity
        const resolvedItems = (v.items || []).map((it, ii) => {
            const pm = matchMaster(it.itemName, { products: masters.products || [] });
            if (pm.match) {
                if (!pm.isExact) {
                    push('INFO', 'RULE_5_FUZZY_MATCH', `Item "${it.itemName}" fuzzy-matched to "${pm.match.name}" (${Math.round(pm.score * 100)}%)`, { suggestion: { ...pm, itemIndex: ii }, field: `items[${ii}]`, missingType: 'product', missingName: it.itemName });
                }
            } else {
                push('CRITICAL', 'RULE_2_MISSING_MASTER', `Stock item "${it.itemName}" does not exist in Items`, { field: `items[${ii}]`, missingType: 'product', missingName: it.itemName });
            }
            if (!(Number(it.qty) > 0)) push('CRITICAL', 'RULE_4_MANDATORY', `Item "${it.itemName}" has no quantity`, { field: `items[${ii}]` });
            return { ...it, matchedMaster: pm.match || null, productId: pm.match?.id || '' };
        });

        // Rule 2 / 5 — tax masters (GST / VAT / duty ledgers)
        const resolvedTax = (v.taxEntries || []).map((t, ti) => {
            // Derived amounts (charges folded from the voucher total) never need a master
            if (t.derived) {
                return { ...t, taxId: '', taxName: '', percent: Number(t.percent) || 0, derived: true };
            }
            const tm = matchMaster(t.name, { taxRates: masters.taxRates || [] });
            if (tm.match) {
                if (!tm.isExact) push('INFO', 'RULE_5_FUZZY_MATCH', `Tax "${t.name}" fuzzy-matched to "${tm.match.name}"`, { suggestion: { ...tm, taxIndex: ti }, field: `tax[${ti}]`, missingType: 'tax', missingName: t.name, missingPercent: t.percent || 0 });
                return { ...t, taxId: tm.match.id, taxName: tm.match.name, percent: Number(tm.match.percentage ?? tm.match.rate ?? t.percent) || 0 };
            }
            // The tax ledger may already exist as a normal ledger (e.g. under Duties & Taxes).
            // In that case do NOT ask for a Tax master — keep the amount as a voucher-level tax.
            const asLedger = matchMaster(t.name, {
                parties: masters.parties || [],
                accounts: masters.accounts || [],
                expenses: masters.expenses || [],
                directExpenseAccounts: masters.directExpenseAccounts || [],
                incomeAccounts: masters.incomeAccounts || [],
                capitalAccounts: masters.capitalAccounts || [],
                assetAccounts: masters.assetAccounts || []
            });
            if (asLedger.match) {
                return { ...t, taxId: '', taxName: t.name, percent: Number(t.percent) || 0, linkedLedgerId: asLedger.match.id };
            }
            push('CRITICAL', 'RULE_2_MISSING_MASTER', `Tax "${t.name}" does not exist in Tax Rates`, { field: `tax[${ti}]`, missingType: 'tax', missingName: t.name, missingPercent: t.percent || 0 });
            return { ...t, taxId: '', taxName: t.name, percent: t.percent || 0 };
        });

        const primaryTax = resolvedTax[0] || null;
        const taxPercent = primaryTax ? (primaryTax.percent || 0) : (Number(v.taxPercent) || 0);
        const taxAmount = Number(v.taxAmount) || r3((v.itemsTotal || 0) * taxPercent / 100);

        const hasCritical = issues.some(i => i.type === 'CRITICAL');
        const hasWarning = issues.some(i => i.type === 'WARNING');
        const status = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'VALID';

        const rowItem = {
            id: `${isSales ? 'srow' : 'prow'}_${index + 1}_${v.vchNo || Date.now()}`,
            ...v,
            status,
            issues,
            isResolved: !hasCritical,
            matchedParty,
            resolvedItems,
            resolvedTax,
            taxId: primaryTax?.taxId || null,
            taxName: primaryTax ? (primaryTax.taxName || null) : (v.taxName || null),
            taxPercent,
            taxAmount,
            locationId: masters.defaultLocationId || ''
        };

        if (hasCritical || hasWarning) quarantinedRows.push(rowItem);
        else cleanRows.push(rowItem);
    });

    return {
        totalParsed: (vouchers || []).length,
        cleanRows,
        quarantinedRows,
        stats: {
            validCount: cleanRows.length,
            quarantinedCount: quarantinedRows.length,
            totalAmount: (vouchers || []).reduce((sum, v) => sum + (v.amount || 0), 0)
        }
    };
}

/**
 * Posts validated purchase vouchers as `invoices` documents (type 'purchase').
 */
export async function executePurchaseImport(rowsToImport, context = {}) {
    beginBulk();
    try {
        return await runPurchaseImport(rowsToImport, context);
    } finally {
        endBulk();
    }
}

async function runPurchaseImport(rowsToImport, context = {}) {
    const { user, dataOwnerId, effectiveName, currencySymbol = 'AED', onRowStatus, chunkSize = 1, control, onBatchStart, lookups = {} } = context;
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!rowsToImport || rowsToImport.length === 0) throw new Error('No rows to import');

    // Name→id resolvers: guarantees the voucher is linked to a real master even if the
    // resolved master object was stale when the row was validated.
    const findId = (list, name) => {
        const key = normalizeMasterName(name);
        if (!key) return '';
        const hit = (list || []).find(x => normalizeMasterName(x.name) === key);
        return hit?.id || '';
    };

    const isSales = context.voucherType === 'sales';
    const docType = isSales ? 'sales' : 'purchase';
    const batchImportId = `BATCH_${isSales ? 'SAL' : 'PUR'}_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const timestampISO = new Date().toISOString();
    const BATCH_CHUNK_SIZE = 400;
    let totalImported = 0;
    let totalValue = 0;

    // chunkSize = 1 gives true one-by-one progress in the UI
    const CHUNK = Math.min(BATCH_CHUNK_SIZE, Math.max(1, Number(chunkSize) || 1));
    const reportStatus = typeof onRowStatus === 'function' ? onRowStatus : null;
    // Run controls: Pause All / Stop All / Cancel All and per-row stop-resume-cancel
    const ctl = control || {};
    const isStoppedNow = () => (typeof ctl.isStopped === 'function' ? !!ctl.isStopped() : false);
    const isRowSkipped = (id) => (typeof ctl.isRowSkipped === 'function' ? !!ctl.isRowSkipped(id) : false);
    const waitWhilePaused = async () => {
        if (typeof ctl.isPaused !== 'function' || !ctl.isPaused()) return !isStoppedNow();
        while (ctl.isPaused()) {
            if (isStoppedNow()) return false;
            await new Promise(r => setTimeout(r, 150));
        }
        return !isStoppedNow();
    };
    let cancelledCount = 0;
    if (typeof onBatchStart === 'function') onBatchStart(batchImportId);
    for (let i = 0; i < rowsToImport.length; i += CHUNK) {
        const chunk = rowsToImport.slice(i, i + CHUNK).filter(r => {
            if (isStoppedNow() || isRowSkipped(r.id)) {
                cancelledCount++;
                if (reportStatus) reportStatus(r.id, 'cancelled');
                return false;
            }
            return true;
        });
        if (chunk.length === 0) continue;
        if (!(await waitWhilePaused())) {
            chunk.forEach(r => { cancelledCount++; if (reportStatus) reportStatus(r.id, 'cancelled'); });
            continue;
        }
        if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'processing', i, rowsToImport.length));
        const batch = writeBatch(db);

        for (const row of chunk) {
            const items = (row.resolvedItems || row.items || []).map(it => {
                const qty = Number(it.qty) || 0;
                const rate = Number(it.rate) || 0;
                return {
                    productId: it.productId || it.matchedMaster?.id || findId(lookups.products, it.itemName),
                    quantity: r3(qty),
                    rate: r3(rate),
                    total: r3(it.amount ?? qty * rate),
                    pieces: 0,
                    lotId: null,
                    originalRate: null
                };
            });

            const taxable = items.reduce((s, it) => s + (it.total || 0), 0);
            const taxPercent = Number(row.taxPercent) || 0;
            const taxAmount = Number(row.taxAmount) || r3(taxable * taxPercent / 100);
            const grand = r3(taxable + taxAmount);
            // items / tax stay in the voucher currency; the invoice carries base total + forex total.
            const rowFxRate = Number(row.exchangeRate) > 0 ? Number(row.exchangeRate) : 1;
            const isFx = !!(row.currency && row.currency !== 'BASE');
            const grandForeign = isFx ? r3(Number(row.foreignTotal) > 0 ? Number(row.foreignTotal) : grand) : grand;
            const grandBase = r3(grandForeign * (isFx ? rowFxRate : 1));

            const docRef = doc(collection(db, 'invoices'));
            batch.set(docRef, {
                type: docType,
                date: row.date,
                refNo: row.vchNo,
                supplierInvoiceNo: isSales ? '' : (row.supplierInvoiceNo || ''),
                partyId: row.matchedParty?.id || row.partyId || findId(lookups.parties, row.partyName),
                partyName: row.matchedParty?.name || row.partyName || '',
                locationId: row.locationId || '',
                narration: row.narration || `Imported via ${row.format || 'Excel'}`,
                items,
                expenses: [],
                addlExpenses: [],
                addlExpCreditId: null,
                addlExpTotal: 0,
                salesExpenseMode: null,
                totalAmount: grandBase,
                foreignTotal: grandForeign,
                currencyId: isFx ? resolveImportCurrency(row.currency, context, currencySymbol).id : 'BASE',
                exchangeRate: isFx ? rowFxRate : 1.0,
                currencySymbol: isFx ? resolveImportCurrency(row.currency, context, currencySymbol).symbol : currencySymbol,
                taxId: row.taxId || findId(lookups.taxRates, row.taxName) || null,
                taxName: row.taxName || null,
                taxPercent,
                taxAmount: r3(taxAmount),
                packingType: 'loose',
                jumboEnabled: false,
                bagCount: 0,
                jumboBags: [],
                soldBags: [],
                paymentTerms: row.date,
                userId: targetUid,
                ownerId: targetUid,
                batchImportId,
                isImported: true,
                importedAt: timestampISO,
                importedBy: user.uid,
                importedByName: effectiveName,
                createdAt: serverTimestamp(),
                createdBy: user.uid,
                createdByName: effectiveName,
                lastModifiedBy: user.uid,
                lastModifiedByName: effectiveName,
                lastModifiedAt: serverTimestamp()
            });

            totalImported++;
            totalValue += grand;
        }

        try {
            await batch.commit();
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'imported', i, rowsToImport.length));
        } catch (chunkErr) {
            if (reportStatus) chunk.forEach(r => reportStatus(r.id, 'error', i, rowsToImport.length));
            throw chunkErr;
        }
    }

    // Audit log
    const auditBatch = writeBatch(db);
    auditBatch.set(doc(collection(db, 'audit_logs')), {
        date: serverTimestamp(),
        ownerId: targetUid,
        userId: targetUid,
        userName: effectiveName,
        action: 'IMPORTED',
        docType: isSales ? 'Sales Invoice' : 'Purchase Invoice',
        refNo: batchImportId,
        amount: totalValue,
        description: `Imported ${totalImported} ${docType} vouchers from ${context.docLabel || 'Excel/XML'} (Batch: ${batchImportId})`,
        batchImportId,
        voucherCount: totalImported
    });
    await auditBatch.commit();

    addBatchHistoryEntry({
        batchImportId,
        timestamp: timestampISO,
        count: totalImported,
        totalAmount: totalValue,
        user: effectiveName,
        voucherType: docType,
        docLabel: isSales ? 'Sales' : 'Purchase',
        status: 'COMPLETED'
    });

    return { batchImportId, totalImported, totalValue, cancelledCount, timestamp: timestampISO };
}

/**
 * Day Book — one export containing every voucher type.
 * Splits the file into homogeneous buckets that the dedicated parsers understand.
 */
const DAYBOOK_KINDS = ['payment', 'receipt', 'journal', 'purchase', 'sales', 'stock_journal'];

export function classifyDayBookXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');
    const parseError = doc.getElementsByTagName('parsererror');
    if (parseError.length > 0) throw new Error('Invalid XML file: ' + parseError[0].textContent);

    const nodes = Array.from(doc.getElementsByTagName('VOUCHER'));
    if (!nodes.length) throw new Error('No <VOUCHER> elements found in this XML document.');

    const buckets = {};

    nodes.forEach((n) => {
        const type = n.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
            n.getAttribute('VCHTYPE') || '';
        const kind = classifyVoucherType(type);
        const key = DAYBOOK_KINDS.includes(kind) ? kind : 'other';
        if (!buckets[key]) buckets[key] = { kind: key, types: {}, nodes: [] };
        const label = type || '(blank)';
        buckets[key].types[label] = (buckets[key].types[label] || 0) + 1;
        buckets[key].nodes.push(n);
    });

    const groups = {};
    Object.entries(buckets).forEach(([key, b]) => {
        const group = {
            kind: key,
            count: b.nodes.length,
            types: b.types,
            // Live DOM nodes — the per-module parsers read these directly (single-pass parse).
            nodes: b.nodes
        };
        // Legacy `xml` accessor: only serialized if some external caller still asks for it.
        let cachedXml = null;
        Object.defineProperty(group, 'xml', {
            enumerable: false,
            get() {
                if (cachedXml === null) {
                    const serializer = new XMLSerializer();
                    cachedXml = `<ENVELOPE>${b.nodes.map(n => serializer.serializeToString(n)).join('')}</ENVELOPE>`;
                }
                return cachedXml;
            }
        });
        groups[key] = group;
    });

    return { total: nodes.length, groups };
}

const DAYBOOK_LABELS = {
    payment: 'Payment',
    receipt: 'Receipt',
    journal: 'Journal',
    purchase: 'Purchase',
    sales: 'Sales',
    stock_journal: 'Stock Journal',
    other: 'Other (skipped)'
};

/** Parses + validates a Day Book into one flat, mixed-type row list (feeds the Solution Centre). */
export function parseDayBookRows(xmlText, context = {}) {
    const { masters = {}, companyProfile = {}, invoices = [], payments = [], journalVouchers = [], stockJournals = [] } = context;
    const classification = classifyDayBookXml(xmlText);
    const cleanRows = [];
    const quarantinedRows = [];
    const groups = {};

    DAYBOOK_KINDS.forEach((kind) => {
        const group = classification.groups[kind];
        if (!group) return;
        try {
            let parsed;
            let validation;
            if (kind === 'payment' || kind === 'receipt' || kind === 'journal') {
                parsed = parseXMLFile('', { voucherMode: kind, doc: voucherDocFor(group.nodes) });
                validation = validateImportBatch(parsed.vouchers, {
                    masters,
                    companyProfile,
                    existingVouchers: kind === 'journal' ? journalVouchers : payments
                });
            } else if (kind === 'purchase' || kind === 'sales') {
                parsed = parsePurchaseXMLFile('', { voucherType: kind, doc: voucherDocFor(group.nodes) });
                validation = validatePurchaseBatch(parsed.vouchers, {
                    voucherType: kind,
                    masters,
                    companyProfile,
                    existingVouchers: (invoices || []).filter(i => i.type === kind)
                });
            } else {
                parsed = parseStockJournalXMLFile('', { doc: voucherDocFor(group.nodes) });
                validation = validateStockJournalBatch(parsed.vouchers, {
                    masters,
                    companyProfile,
                    existingVouchers: stockJournals
                });
            }

            const tag = (r) => ({ ...r, id: `${kind}_${r.id}`, __kind: kind, __label: DAYBOOK_LABELS[kind] });
            cleanRows.push(...(validation.cleanRows || []).map(tag));
            quarantinedRows.push(...(validation.quarantinedRows || []).map(tag));

            groups[kind] = {
                count: group.count,
                types: Object.keys(group.types),
                parsed: parsed.vouchers.length,
                clean: validation.cleanRows.length,
                quarantined: validation.quarantinedRows.length,
                totalAmount: validation.stats?.totalAmount || 0
            };
        } catch (err) {
            groups[kind] = { count: group.count, types: Object.keys(group.types), parsed: 0, clean: 0, quarantined: group.count, error: err.message };
        }
    });

    if (classification.groups.other) {
        groups.other = {
            count: classification.groups.other.count,
            types: Object.keys(classification.groups.other.types),
            parsed: 0,
            clean: 0,
            quarantined: classification.groups.other.count,
            error: 'Unsupported voucher type — use its dedicated importer.'
        };
    }

    return {
        total: classification.total,
        groups,
        cleanRows,
        quarantinedRows,
        stats: {
            validCount: cleanRows.length,
            quarantinedCount: quarantinedRows.length,
            totalAmount: cleanRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
        }
    };
}

/** Executes Day Book rows, routing each row to the executor of its own voucher type. */
export async function executeDayBookRows(rows, context = {}) {
    const byKind = {};
    rows.forEach(r => { (byKind[r.__kind] = byKind[r.__kind] || []).push(r); });

    // One bulk window for every module of this Day Book (queues cloud pushes until the end).
    beginBulk();
    try {
        return await runDayBookRows(byKind, context);
    } finally {
        endBulk();
    }
}

async function runDayBookRows(byKind, context = {}) {
    const targetUid = context.dataOwnerId || context.user?.uid;

    /** Reads the batch back from the store so the UI can prove the documents exist. */
    const verifyBatch = async (collectionName, batchImportId) => {
        if (!batchImportId) return null;
        try {
            const snap = await getDocs(query(
                collection(db, collectionName),
                where('batchImportId', '==', batchImportId)
            ));
            return snap.size;
        } catch (e) {
            return null;
        }
    };

    const results = [];
    for (const kind of DAYBOOK_KINDS) {
        const list = byKind[kind];
        if (!list || list.length === 0) continue;
        let res;
        let collectionName = 'payments';
        if (kind === 'payment' || kind === 'receipt' || kind === 'journal') {
            collectionName = kind === 'journal' ? 'journal_vouchers' : 'payments';
            res = await executeBatchImport(list, {
                ...context,
                voucherType: kind === 'payment' ? 'out' : kind === 'receipt' ? 'in' : 'journal',
                docLabel: DAYBOOK_LABELS[kind]
            });
        } else if (kind === 'purchase' || kind === 'sales') {
            collectionName = 'invoices';
            res = await executePurchaseImport(list, { ...context, voucherType: kind });
        } else {
            collectionName = 'stock_journals';
            res = await executeStockJournalImport(list, context);
        }
        const verified = await verifyBatch(collectionName, res.batchImportId);
        results.push({
            kind,
            label: DAYBOOK_LABELS[kind],
            imported: res.totalImported || 0,
            verified,
            collectionName,
            batchImportId: res.batchImportId || null
        });
    }
    return results;
}

/**
 * Day Book import: every voucher is routed to its own parser, validator and executor,
 * so payments land in `payments`, sales in `invoices`, stock journals in `stock_journals`, etc.
 */
export async function importDayBook(xmlText, context = {}) {
    const { masters = {}, companyProfile = {}, invoices = [], payments = [], journalVouchers = [], stockJournals = [], onProgress } = context;
    const classification = classifyDayBookXml(xmlText);
    const labels = {
        payment: 'Payment',
        receipt: 'Receipt',
        journal: 'Journal',
        purchase: 'Purchase',
        sales: 'Sales',
        stock_journal: 'Stock Journal',
        other: 'Other (skipped)'
    };

    const results = [];

    for (const kind of [...DAYBOOK_KINDS, 'other']) {
        const group = classification.groups[kind];
        if (!group) continue;

        if (kind === 'other') {
            results.push({
                kind,
                label: labels.other,
                parsed: group.count,
                imported: 0,
                quarantined: 0,
                skipped: group.count,
                types: Object.keys(group.types),
                reasons: ['Unsupported voucher type — use its dedicated importer.']
            });
            continue;
        }

        if (onProgress) onProgress({ kind, label: labels[kind], phase: 'parsing' });

        let parsed;
        let validation;
        try {
            if (kind === 'payment' || kind === 'receipt' || kind === 'journal') {
                parsed = parseXMLFile('', { voucherMode: kind, doc: voucherDocFor(group.nodes) });
                validation = validateImportBatch(parsed.vouchers, {
                    masters,
                    companyProfile,
                    existingVouchers: kind === 'journal' ? journalVouchers : payments
                });
            } else if (kind === 'purchase' || kind === 'sales') {
                parsed = parsePurchaseXMLFile('', { voucherType: kind, doc: voucherDocFor(group.nodes) });
                validation = validatePurchaseBatch(parsed.vouchers, {
                    voucherType: kind,
                    masters,
                    companyProfile,
                    existingVouchers: (invoices || []).filter(i => i.type === kind)
                });
            } else {
                parsed = parseStockJournalXMLFile('', { doc: voucherDocFor(group.nodes) });
                validation = validateStockJournalBatch(parsed.vouchers, {
                    masters,
                    companyProfile,
                    existingVouchers: stockJournals
                });
            }
        } catch (err) {
            results.push({
                kind,
                label: labels[kind],
                parsed: group.count,
                imported: 0,
                quarantined: 0,
                skipped: group.count,
                types: Object.keys(group.types),
                reasons: [err.message]
            });
            continue;
        }

        const clean = validation.cleanRows || [];
        const quarantined = validation.quarantinedRows || [];
        const reasons = [];
        quarantined.forEach(q => (q.issues || []).forEach(i => {
            if (i.type === 'CRITICAL' && !reasons.includes(i.message)) reasons.push(i.message);
        }));

        const result = {
            kind,
            label: labels[kind],
            parsed: parsed.vouchers.length,
            imported: 0,
            quarantined: quarantined.length,
            skipped: 0,
            types: Object.keys(group.types),
            reasons: reasons.slice(0, 6)
        };

        if (clean.length > 0) {
            if (onProgress) onProgress({ kind, label: labels[kind], phase: 'importing', total: clean.length });
            if (kind === 'payment' || kind === 'receipt' || kind === 'journal') {
                const r = await executeBatchImport(clean, {
                    ...context,
                    voucherType: kind === 'payment' ? 'out' : kind === 'receipt' ? 'in' : 'journal',
                    docLabel: labels[kind]
                });
                result.imported = r.totalImported;
            } else if (kind === 'purchase' || kind === 'sales') {
                const r = await executePurchaseImport(clean, { ...context, voucherType: kind });
                result.imported = r.totalImported;
            } else {
                const r = await executeStockJournalImport(clean, context);
                result.imported = r.totalImported;
            }
        }

        results.push(result);
    }

    return { total: classification.total, results };
}

/**
 * Tally master XML — ledgers (accounts) and stock items.
 */
/**
 * Tally master XML — GROUPS + ledgers (accounts) and stock groups + stock items.
 * Ledgers are classified by their PRIMARY-group ancestry (not just the immediate parent),
 * so a ledger under a custom sub-group (e.g. "MAIN VISA EXPENSES" → Indirect Expenses)
 * still lands in the right AccPro collection, and the sub-group is created first.
 */
const TALLY_PRIMARY_GROUPS = {
    // key = normalised Tally primary group name
    sundrydebtors: { collection: 'parties', kind: 'party', role: 'customer', label: 'Customer' },
    sundrycreditors: { collection: 'parties', kind: 'party', role: 'supplier', label: 'Supplier' },
    cashinhand: { collection: 'accounts', kind: 'account', label: 'Cash' },
    bankaccounts: { collection: 'accounts', kind: 'account', label: 'Bank' },
    bankodac: { collection: 'accounts', kind: 'account', label: 'Bank OD' },
    bankoccac: { collection: 'accounts', kind: 'account', label: 'Bank OCC' },
    branchdivisions: { collection: 'accounts', kind: 'account', label: 'Branch / Division' },
    currentliabilities: { collection: 'accounts', kind: 'account', label: 'Current Liability' },
    loansliability: { collection: 'accounts', kind: 'account', label: 'Loan (Liability)' },
    provisions: { collection: 'accounts', kind: 'account', label: 'Provision' },
    dutiesandtaxes: { collection: 'accounts', kind: 'account', label: 'Duties & Taxes' },
    dutiestaxes: { collection: 'accounts', kind: 'account', label: 'Duties & Taxes' },
    suspenseac: { collection: 'accounts', kind: 'account', label: 'Suspense' },
    suspenseaccount: { collection: 'accounts', kind: 'account', label: 'Suspense' },
    capitalaccount: { collection: 'capital_accounts', kind: 'capital', label: 'Capital' },
    currentassets: { collection: 'asset_accounts', kind: 'asset', label: 'Current Asset' },
    fixedassets: { collection: 'asset_accounts', kind: 'asset', label: 'Fixed Asset' },
    investments: { collection: 'asset_accounts', kind: 'asset', label: 'Investment' },
    depositsasset: { collection: 'asset_accounts', kind: 'asset', label: 'Deposit (Asset)' },
    loansadvancesasset: { collection: 'asset_accounts', kind: 'asset', label: 'Loan & Advance (Asset)' },
    miscexpensesasset: { collection: 'asset_accounts', kind: 'asset', label: 'Misc. Expenses (Asset)' },
    stockinhand: { collection: 'asset_accounts', kind: 'asset', label: 'Stock-in-Hand' },
    directexpenses: { collection: 'direct_expenses', kind: 'direct_expense', label: 'Direct Expense' },
    purchaseaccounts: { collection: 'direct_expenses', kind: 'direct_expense', label: 'Purchase Account' },
    indirectexpenses: { collection: 'expenses', kind: 'expense', label: 'Expense' },
    directincomes: { collection: 'income_accounts', kind: 'income', label: 'Direct Income' },
    indirectincomes: { collection: 'income_accounts', kind: 'income', label: 'Indirect Income' },
    salesaccounts: { collection: 'income_accounts', kind: 'income', label: 'Sales Account' }
};

const groupKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Legacy heuristic (used only when a ledger's parent group is not present in the file). */
function mapLedgerParent(parent) {
    const p = String(parent || '').toLowerCase();
    if (/sundry debtors|customer/.test(p)) return { collection: 'parties', kind: 'party', role: 'customer', label: 'Customer' };
    if (/sundry creditors|supplier/.test(p)) return { collection: 'parties', kind: 'party', role: 'supplier', label: 'Supplier' };
    if (/^(bank|bank accounts|bank od|bank occ)/.test(p)) return { collection: 'accounts', kind: 'account', label: 'Bank' };
    if (/cash-in-hand|cash/.test(p)) return { collection: 'accounts', kind: 'account', label: 'Cash' };
    if (/sales accounts|direct income|indirect income/.test(p)) return { collection: 'income_accounts', kind: 'income', label: 'Income' };
    if (/direct expense|direct expenses|purchase accounts/.test(p)) return { collection: 'direct_expenses', kind: 'direct_expense', label: 'Direct Expense' };
    if (/indirect expense|expense/.test(p)) return { collection: 'expenses', kind: 'expense', label: 'Expense' };
    if (/fixed asset/.test(p)) return { collection: 'asset_accounts', kind: 'asset', label: 'Fixed Asset' };
    if (/capital/.test(p)) return { collection: 'capital_accounts', kind: 'capital', label: 'Capital' };
    return { collection: 'accounts', kind: 'account', label: 'Ledger' };
}

/** Reads every <GROUP> node into a normalised map: key -> { name, parent }. */
function readTallyGroups(doc) {
    const map = new Map();
    Array.from(doc.getElementsByTagName('GROUP')).forEach(n => {
        const name = (n.getAttribute('NAME') || readXmlTag(n, 'NAME') || '').trim();
        if (!name) return;
        map.set(groupKey(name), { name, parent: readXmlTag(n, 'PARENT') || '' });
    });
    return map;
}

/** Walks up the group tree to the Tally primary group and returns its AccPro classification. */
function classifyByGroupTree(parentName, groupMap) {
    let current = parentName;
    const seen = new Set();
    let primary = '';
    while (current) {
        const key = groupKey(current);
        if (!key || seen.has(key)) break;
        seen.add(key);
        const node = groupMap.get(key);
        if (!node) break;
        if (!node.parent) { primary = node.name; break; }
        current = node.parent;
    }

    const direct = TALLY_PRIMARY_GROUPS[groupKey(parentName)];
    const viaTree = TALLY_PRIMARY_GROUPS[groupKey(primary)];
    if (direct) return { ...direct, primaryGroup: parentName };
    if (viaTree) return { ...viaTree, primaryGroup: primary };
    return null;
}

export function parseLedgerMastersXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('Invalid XML file: ' + doc.getElementsByTagName('parsererror')[0].textContent);
    }
    const ledgerNodes = Array.from(doc.getElementsByTagName('LEDGER'));
    if (!ledgerNodes.length) throw new Error('No <LEDGER> master records found in this XML document.');

    const groupMap = readTallyGroups(doc);
    const masters = [];

    // 1) GROUPS first — every group that belongs to a customer/supplier or expense tree
    //    becomes an AccPro group master (parties → party_groups, expenses → expense_groups).
    groupMap.forEach((g) => {
        const cls = classifyByGroupTree(g.name, groupMap);
        if (!cls) return;
        const isPartyTree = cls.collection === 'parties';
        const isExpenseTree = cls.collection === 'expenses' || cls.collection === 'direct_expenses';
        if (!isPartyTree && !isExpenseTree) return;
        masters.push({
            name: g.name,
            parent: g.parent || (isPartyTree ? cls.primaryGroup : cls.primaryGroup),
            kind: isPartyTree ? 'party_group' : 'expense_group',
            collection: isPartyTree ? 'party_groups' : 'expense_groups',
            groupLabel: isPartyTree ? 'Customer / Supplier Group' : 'Expense Group',
            treeRoot: cls.primaryGroup
        });
    });

    // 2) LEDGERS — classified by ancestry, grouped under their immediate Tally parent.
    ledgerNodes.forEach(n => {
        const name = (n.getAttribute('NAME') || readXmlTag(n, 'NAME') || '').trim();
        if (!name) return;
        const parent = readXmlTag(n, 'PARENT');
        const target = classifyByGroupTree(parent, groupMap) || mapLedgerParent(parent);
        masters.push({
            name,
            parent,
            group: parent || '',
            currency: readXmlTag(n, 'CURRENCYNAME'),
            openingBalance: numFromTally(readXmlTag(n, 'OPENINGBALANCE')),
            collection: target.collection,
            kind: target.kind,
            role: target.role || '',
            groupLabel: target.label
        });
    });

    const counts = {};
    masters.forEach(m => { counts[m.collection] = (counts[m.collection] || 0) + 1; });

    return {
        formatType: 'tally_ledger_masters',
        masters,
        total: masters.length,
        groupCount: masters.filter(m => m.kind === 'party_group' || m.kind === 'expense_group').length,
        ledgerCount: ledgerNodes.length,
        counts
    };
}

export function parseStockMastersXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('Invalid XML file: ' + doc.getElementsByTagName('parsererror')[0].textContent);
    }
    const nodes = Array.from(doc.getElementsByTagName('STOCKITEM'));
    if (!nodes.length) throw new Error('No <STOCKITEM> master records found in this XML document.');

    // Units of measure first — stock items reference them by name.
    const unitMasters = Array.from(doc.getElementsByTagName('UNIT')).map(n => {
        const name = (n.getAttribute('NAME') || readXmlTag(n, 'NAME') || '').trim();
        if (!name) return null;
        return {
            name,
            symbol: name,
            originalName: readXmlTag(n, 'ORIGINALNAME') || '',
            kind: 'unit',
            collection: 'units',
            groupLabel: 'Unit of Measure'
        };
    }).filter(Boolean);

    // Stock groups first (they carry a parent), so items can reference them.
    // Tally sometimes repeats a group block (same GUID) — keep the first occurrence only.
    const groupNodes = Array.from(doc.getElementsByTagName('STOCKGROUP'));
    const seenGroupKeys = new Set();
    const stockGroupMasters = groupNodes.map(n => {
        const name = (n.getAttribute('NAME') || readXmlTag(n, 'NAME') || '').trim();
        const key = groupKey(name);
        if (!name || key === 'primary' || seenGroupKeys.has(key)) return null;
        seenGroupKeys.add(key);
        return {
            name,
            parent: readXmlTag(n, 'PARENT') || 'Primary',
            kind: 'stock_group',
            collection: 'stock_groups',
            groupLabel: 'Stock Group'
        };
    }).filter(Boolean);

    const itemMasters = nodes.map(n => {
        const name = (n.getAttribute('NAME') || readXmlTag(n, 'NAME') || '').trim();
        if (!name) return null;
        return {
            name,
            group: readXmlTag(n, 'PARENT') || 'Primary',
            parent: readXmlTag(n, 'PARENT') || 'Primary',
            unit: readXmlTag(n, 'BASEUNITS') || '',
            altUnit: readXmlTag(n, 'ADDITIONALUNITS') || '',
            openingQty: Math.abs(numFromTally(readXmlTag(n, 'OPENINGBALANCE'))),
            openingRate: Math.abs(numFromTally(readXmlTag(n, 'OPENINGRATE'))),
            openingValue: Math.abs(numFromTally(readXmlTag(n, 'OPENINGVALUE'))),
            kind: 'product',
            collection: 'products'
        };
    }).filter(Boolean);

    const masters = [...unitMasters, ...stockGroupMasters, ...itemMasters];
    const counts = { units: unitMasters.length, stock_groups: stockGroupMasters.length, products: itemMasters.length };

    return {
        formatType: 'tally_stock_masters',
        masters,
        total: masters.length,
        groupCount: stockGroupMasters.length,
        unitCount: unitMasters.length,
        ledgerCount: itemMasters.length,
        counts
    };
}

/** Bulk-create Tally masters, skipping names that already exist (case/space-insensitive). */
export async function bulkImportMasters(masters, context = {}) {
    beginBulk();
    try {
        return await runBulkImportMasters(masters, context);
    } finally {
        endBulk();
    }
}

async function runBulkImportMasters(masters, context = {}) {
    const { user, dataOwnerId, effectiveName, onProgress } = context;
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!masters || masters.length === 0) throw new Error('Nothing to import');

    const batchImportId = `BATCH_MST_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const timestampISO = new Date().toISOString();

    const byCollection = {};
    masters.forEach(m => { (byCollection[m.collection] = byCollection[m.collection] || []).push(m); });

    // Groups must exist before the ledgers/items that point at them.
    const collectionOrder = Object.keys(byCollection).sort((a, b) => {
        const rank = (c) => (c.endsWith('_groups') ? 0 : 1);
        return rank(a) - rank(b);
    });

    const summary = {};
    let totalCreated = 0;
    let totalSkipped = 0;

    for (const collectionName of collectionOrder) {
        const list = byCollection[collectionName];
        const existingKeys = new Set();
        try {
            const snap = await getDocs(query(collection(db, collectionName), where('userId', '==', targetUid)));
            snap.docs.forEach(d => existingKeys.add(normalizeMasterName(d.data()?.name)));
        } catch (e) { /* offline / index */ }

        const toCreate = [];
        let skipped = 0;
        const seen = new Set();
        list.forEach(m => {
            const key = normalizeMasterName(m.name);
            if (!key || existingKeys.has(key) || seen.has(key)) { skipped++; return; }
            seen.add(key);
            toCreate.push(m);
        });

        for (let i = 0; i < toCreate.length; i += 400) {
            const chunk = toCreate.slice(i, i + 400);
            const batch = writeBatch(db);
            chunk.forEach(m => {
                const ref = doc(collection(db, collectionName));
                batch.set(ref, { ...buildMasterDoc(m, targetUid, user, effectiveName), batchImportId, importedAt: timestampISO });
            });
            await batch.commit();
            if (onProgress) onProgress({ collection: collectionName, done: Math.min(i + 400, toCreate.length), total: toCreate.length });
        }

        summary[collectionName] = { created: toCreate.length, skipped };
        totalCreated += toCreate.length;
        totalSkipped += skipped;
    }

    if (totalCreated > 0) {
        addBatchHistoryEntry({
            batchImportId,
            timestamp: timestampISO,
            count: totalCreated,
            totalAmount: 0,
            user: effectiveName,
            voucherType: 'masters',
            docLabel: 'Masters',
            status: 'COMPLETED'
        });
    }

    return { summary, totalCreated, totalSkipped, batchImportId };
}

function buildMasterDoc(m, targetUid, user, effectiveName) {
    const base = {
        name: m.name.trim(),
        userId: targetUid,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || 'import-engine',
        createdByName: effectiveName || 'Import Engine',
        balance: 0
    };

    switch (m.kind) {
        case 'party_group':
            return {
                name: m.name.trim(),
                userId: targetUid,
                addValues: 'Yes',
                parent: m.parent || '',
                treeRoot: m.treeRoot || '',
                createdAt: serverTimestamp(),
                createdBy: user?.uid || 'import-engine',
                createdByName: effectiveName || 'Import Engine',
                isImported: true
            };
        case 'expense_group':
            return {
                name: m.name.trim(),
                userId: targetUid,
                addValues: 'Yes',
                parent: m.parent || '',
                treeRoot: m.treeRoot || '',
                createdAt: serverTimestamp(),
                createdBy: user?.uid || 'import-engine',
                createdByName: effectiveName || 'Import Engine',
                isImported: true
            };
        case 'stock_group':
            return {
                name: m.name.trim(),
                userId: targetUid,
                parent: m.parent || 'Primary',
                shouldQuantities: 'Yes',
                shouldValues: 'Yes',
                addInwardQty: 'Yes',
                addInwardValue: 'Yes',
                addOutwardQty: 'Yes',
                addOutwardValue: 'Yes',
                addClosingQty: 'Yes',
                addClosingValue: 'Yes',
                createdAt: serverTimestamp(),
                createdBy: user?.uid || 'import-engine',
                createdByName: effectiveName || 'Import Engine',
                isImported: true
            };
        case 'unit':
            return {
                name: m.name.trim(),
                symbol: m.symbol || m.name.trim(),
                isBase: false,
                originalName: m.originalName || '',
                userId: targetUid,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                createdBy: user?.uid || 'import-engine',
                createdByName: effectiveName || 'Import Engine',
                isImported: true
            };
        case 'party': {
            const isCustomer = m.role === 'customer';
            return {
                ...base,
                type: isCustomer ? 'customer' : 'supplier',
                partyType: isCustomer ? 'customer' : 'supplier',
                category: isCustomer ? 'Sundry Debtors' : 'Sundry Creditors',
                group: m.group || m.parent || (isCustomer ? 'Sundry Debtors' : 'Sundry Creditors'),
                currency: m.currency || 'AED',
                isImported: true
            };
        }
        case 'product':
            return {
                ...base,
                name_lowercase: m.name.trim().toLowerCase(),
                hscode: '',
                group: m.group || 'Primary',
                unit: m.unit || '',
                altUnit: m.altUnit || '',
                openingStock: Number(m.openingQty) || 0,
                openingRate: Number(m.openingRate) || 0,
                openingBalance: Number(m.openingValue) || 0,
                currentStock: Number(m.openingQty) || 0,
                isImported: true
            };
        case 'tax':
            return {
                ...base,
                name_lowercase: m.name.trim().toLowerCase(),
                percentage: Number(m.percentage) || 0,
                balance: undefined,
                isImported: true
            };
        case 'expense':
            return { ...base, group: m.group || m.parent || 'Administrative Expenses', isImported: true };
        case 'direct_expense':
            return { ...base, group: m.group || m.parent || 'Direct Expenses', isImported: true };
        case 'income':
            return { ...base, group: m.group || m.parent || 'Indirect Incomes', isImported: true };
        case 'capital':
            return { ...base, group: m.group || m.parent || 'Capital Account', isImported: true };
        case 'asset':
            return { ...base, group: m.group || m.parent || 'Fixed Assets', isImported: true };
        default:
            return {
                ...base,
                type: 'cash',
                accountType: 'cash',
                group: m.group || m.parent || '',
                currency: m.currency || 'AED',
                isImported: true
            };
    }
}

/**
 * Batch History Local Persistence
 */
export function getBatchHistory() {
    try {
        const raw = localStorage.getItem(BATCH_HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function addBatchHistoryEntry(entry) {
    try {
        const history = getBatchHistory();
        history.unshift({
            id: entry.batchImportId,
            ...entry
        });
        if (history.length > 100) history.length = 100;
        localStorage.setItem(BATCH_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.warn('Failed to save batch history entry:', e);
    }
}

export function updateBatchHistoryStatus(batchImportId, status) {
    try {
        const history = getBatchHistory();
        const item = history.find(h => h.batchImportId === batchImportId);
        if (item) {
            item.status = status;
            item.rolledBackAt = new Date().toISOString();
            localStorage.setItem(BATCH_HISTORY_KEY, JSON.stringify(history));
        }
    } catch (e) {
        console.warn('Failed to update batch history status:', e);
    }
}
