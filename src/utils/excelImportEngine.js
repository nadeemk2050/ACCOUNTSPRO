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
import { collection, doc, writeBatch, setDoc, getDoc, updateDoc, serverTimestamp, getDocs, query, where, deleteDoc } from 'firebase/firestore';

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
async function readXmlFileText(file) {
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
    const parser = new DOMParser();
    const sanitized = sanitizeTallyXml(xmlText);
    const xmlDoc = parser.parseFromString(sanitized, 'text/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror');
    if (parseError.length > 0) {
        throw new Error('Invalid XML file: ' + parseError[0].textContent);
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

        ledgerNodes.forEach(lNode => {
            const ledgerName = readTag(lNode, 'LEDGERNAME');
            const rawAmt = parseFloat(readTag(lNode, 'AMOUNT')) || 0;
            const isDeemedPositive = readTag(lNode, 'ISDEEMEDPOSITIVE');
            const absAmt = Math.abs(rawAmt);

            if (voucherMode === 'journal') {
                if (isDeemedPositive === 'Yes' || (rawAmt < 0 && isDeemedPositive !== 'No')) {
                    drRows.push({ targetName: ledgerName, amount: absAmt, description: narration, type: 'dr' });
                    totalDr += absAmt;
                } else {
                    crRows.push({ targetName: ledgerName, amount: absAmt, description: narration, type: 'cr' });
                    totalCr += absAmt;
                }
            } else if (voucherMode === 'payment') {
                if (isDeemedPositive === 'No' || (rawAmt > 0 && isDeemedPositive !== 'Yes')) {
                    if (!paidFrom) paidFrom = ledgerName;
                } else {
                    splits.push({ targetName: ledgerName, amount: absAmt, description: narration });
                    totalAmount += absAmt;
                }
            } else {
                if (isDeemedPositive === 'Yes' || (rawAmt < 0 && isDeemedPositive !== 'No')) {
                    if (!paidFrom) paidFrom = ledgerName;
                } else {
                    splits.push({ targetName: ledgerName, amount: absAmt, description: narration });
                    totalAmount += absAmt;
                }
            }
        });

        if (voucherMode === 'journal') {
            paidTo = drRows.map(r => r.targetName).filter(Boolean).join(', ');
            paidFrom = crRows.map(r => r.targetName).filter(Boolean).join(', ');
            totalAmount = Math.max(totalDr, totalCr);
        } else if (splits.length === 0 && ledgerNodes.length >= 2) {
            paidFrom = readTag(ledgerNodes[0], 'LEDGERNAME');
            const secondName = readTag(ledgerNodes[1], 'LEDGERNAME');
            const secondAmt = Math.abs(parseFloat(readTag(ledgerNodes[1], 'AMOUNT')) || 0);
            splits.push({ targetName: secondName, amount: secondAmt, description: narration });
            totalAmount = secondAmt;
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
            amount: totalAmount || (splits[0]?.amount || 0),
            totalDr,
            totalCr,
            drRows,
            crRows,
            narration,
            splits: voucherMode === 'journal' ? [...drRows, ...crRows] : splits,
            currency: 'BASE',
            exchangeRate: 1.0,
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
        onBatchStart
    } = context;

    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!rowsToImport || rowsToImport.length === 0) throw new Error('No rows to import');

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
                    amount: row.amount * (row.exchangeRate || 1),
                    foreignAmount: row.amount,
                    rows: [...drRows, ...crRows],
                    drName: (row.drRows || []).map(r => r.targetName).join(', ') || 'Various',
                    crName: (row.crRows || []).map(r => r.targetName).join(', ') || 'Various',
                    currencyId: row.currency || 'BASE',
                    exchangeRate: row.exchangeRate || 1.0,
                    currencySymbol,
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
            const sourceAccountId = row.matchedPaidFrom?.match?.id || row.paidFromId || '';

            const splits = (row.resolvedSplits || []).map((s, idx) => ({
                id: idx + 1,
                category: s.category || 'party',
                targetId: s.targetId || s.matchedMaster?.id || '',
                amount: s.amount || row.amount,
                description: s.description || row.narration || ''
            }));

            const paymentDoc = {
                date: row.date,
                refNo: row.vchNo,
                type: voucherType,
                accountId: sourceAccountId,
                amount: row.amount,
                totalAmount: row.amount,
                narration: row.narration || `Imported via ${row.format || 'Excel'}`,
                description: row.narration || '',
                isMulti: true,
                splits,
                currencyId: row.currency || 'BASE',
                exchangeRate: row.exchangeRate || 1.0,
                currencySymbol,
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
            if (sourceAccountId) {
                trackChange(doc(db, 'accounts', sourceAccountId), row.amount, voucherType, 'account');
            }
            splits.forEach(s => {
                if (s.targetId) {
                    trackChange(doc(db, targetCol(s.category), s.targetId), s.amount, voucherType, s.category);
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
        docType: 'Imported',
        refNo: batchImportId,
        amount: rowsToImport.reduce((sum, r) => sum + (r.amount || 0), 0),
        description: `Imported ${totalImported} payment vouchers from Excel (Batch: ${batchImportId})`,
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
export function parsePurchaseXMLFile(xmlText, options = {}) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(sanitizeTallyXml(xmlText), 'text/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror');
    if (parseError.length > 0) {
        throw new Error('Invalid XML file: ' + parseError[0].textContent);
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

    const parsedVouchers = [];

    voucherNodes.forEach((vNode, index) => {
        const vchType = vNode.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
                        vNode.getAttribute('VCHTYPE') || 'Purchase';

        const kind = classifyVoucherType(vchType);
        if (kind !== 'unknown' && kind !== 'other' && kind !== 'purchase') {
            skippedVoucherCount++;
            if (!skippedTypes.includes(vchType)) skippedTypes.push(vchType);
            return;
        }

        const rawDate = vNode.getElementsByTagName('DATE')[0]?.textContent?.trim();
        const vchNo = vNode.getElementsByTagName('VOUCHERNUMBER')[0]?.textContent?.trim() || `PUR-${index + 1}`;
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
            const rate = numFromTally(readXmlTag(n, 'RATE'));
            const amount = Math.abs(numFromTally(readXmlTag(n, 'AMOUNT')));
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
                discount,
                taxHeads
            };
        }).filter(i => i.itemName);

        // Ledger legs — supplier, purchase/expense account, tax ledgers (GST/VAT/duty), round-off
        const ledgerNodes = Array.from(vNode.getElementsByTagName('ALLLEDGERENTRIES.LIST'))
            .concat(Array.from(vNode.getElementsByTagName('LEDGERENTRIES.LIST')));

        const ledgerEntries = ledgerNodes.map(n => {
            const name = readXmlTag(n, 'LEDGERNAME');
            const rawAmt = numFromTally(readXmlTag(n, 'AMOUNT'));
            const isDeemedPositive = (readXmlTag(n, 'ISDEEMEDPOSITIVE') || '').toLowerCase() === 'yes';
            const isParty = (readXmlTag(n, 'ISPARTYLEDGER') || '').toLowerCase() === 'yes' ||
                            !!(partyName && name && name.trim().toLowerCase() === partyName.trim().toLowerCase());
            return {
                name,
                amount: Math.abs(rawAmt),
                signedAmount: rawAmt,
                isDeemedPositive,
                isParty,
                isTax: !isParty && TAX_LEDGER_RE.test(name)
            };
        }).filter(l => l.name);

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
                    percent: h.percent
                }));
            } else if (embeddedTax > 0) {
                taxEntries.push({ name: 'Tax (from voucher)', amount: embeddedTax, percent: 0 });
            }
        }
        const taxTotal = taxEntries.reduce((s, t) => s + (t.amount || 0), 0);

        parsedVouchers.push({
            rowNumber: index + 1,
            rawDate,
            date: parseExcelDate(rawDate),
            vchNo,
            vchType,
            partyName: resolvedParty,
            supplierInvoiceNo,
            narration,
            items,
            itemCount: items.length,
            itemsTotal,
            taxEntries,
            taxName: taxEntries.map(t => t.name).join(', '),
            taxPercent: taxEntries.length ? (taxEntries[0].percent || 0) : 0,
            taxAmount: taxTotal,
            ledgerEntries,
            amount,
            totalDr: ledgerEntries.filter(l => l.isDeemedPositive).reduce((s, l) => s + l.amount, 0),
            totalCr: ledgerEntries.filter(l => !l.isDeemedPositive).reduce((s, l) => s + l.amount, 0),
            currency: 'BASE',
            exchangeRate: 1.0,
            format: 'tally_xml_purchase',
            paidTo: resolvedParty,
            paidFrom: '',
            splits: [],
            isMultiSplit: items.length > 1
        });
    });

    return {
        formatType: 'tally_xml_purchase',
        headers: ['Date', 'Voucher No', 'Supplier', 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Tax', 'Narration'],
        vouchers: parsedVouchers,
        expectedVoucherKind: 'purchase',
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
        if (!v.partyName) push('CRITICAL', 'RULE_4_MANDATORY', 'Missing supplier / party name', { field: 'partyName' });
        if (!v.items || v.items.length === 0) push('CRITICAL', 'RULE_4_MANDATORY', 'No item lines found for this purchase voucher', { field: 'items' });
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
                    push('INFO', 'RULE_5_FUZZY_MATCH', `Supplier fuzzy-matched to "${pm.match.name}" (${Math.round(pm.score * 100)}%)`, { suggestion: pm, field: 'partyName' });
                }
            } else {
                push('CRITICAL', 'RULE_2_MISSING_MASTER', `Supplier "${v.partyName}" does not exist in Parties`, { field: 'partyName', missingType: 'party', missingName: v.partyName });
            }
        }

        // Rule 2 / 5 — stock items + line sanity
        const resolvedItems = (v.items || []).map((it, ii) => {
            const pm = matchMaster(it.itemName, { products: masters.products || [] });
            if (pm.match) {
                if (!pm.isExact) {
                    push('INFO', 'RULE_5_FUZZY_MATCH', `Item "${it.itemName}" fuzzy-matched to "${pm.match.name}" (${Math.round(pm.score * 100)}%)`, { suggestion: { ...pm, itemIndex: ii }, field: `items[${ii}]` });
                }
            } else {
                push('CRITICAL', 'RULE_2_MISSING_MASTER', `Stock item "${it.itemName}" does not exist in Items`, { field: `items[${ii}]`, missingType: 'product', missingName: it.itemName });
            }
            if (!(Number(it.qty) > 0)) push('CRITICAL', 'RULE_4_MANDATORY', `Item "${it.itemName}" has no quantity`, { field: `items[${ii}]` });
            return { ...it, matchedMaster: pm.match || null, productId: pm.match?.id || '' };
        });

        // Rule 2 / 5 — tax masters (GST / VAT / duty ledgers)
        const resolvedTax = (v.taxEntries || []).map((t, ti) => {
            const tm = matchMaster(t.name, { taxRates: masters.taxRates || [] });
            if (tm.match) {
                if (!tm.isExact) push('INFO', 'RULE_5_FUZZY_MATCH', `Tax "${t.name}" fuzzy-matched to "${tm.match.name}"`, { suggestion: { ...tm, taxIndex: ti }, field: `tax[${ti}]` });
                return { ...t, taxId: tm.match.id, taxName: tm.match.name, percent: Number(tm.match.percentage ?? tm.match.rate ?? t.percent) || 0 };
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
            id: `prow_${index + 1}_${v.vchNo || Date.now()}`,
            ...v,
            status,
            issues,
            isResolved: !hasCritical,
            matchedParty,
            resolvedItems,
            resolvedTax,
            taxId: primaryTax?.taxId || null,
            taxName: primaryTax?.taxName || v.taxName || null,
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
    const { user, dataOwnerId, effectiveName, currencySymbol = 'AED', onRowStatus, chunkSize = 1, control, onBatchStart } = context;
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');
    if (!rowsToImport || rowsToImport.length === 0) throw new Error('No rows to import');

    const batchImportId = `BATCH_PUR_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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
                    productId: it.productId || it.matchedMaster?.id || '',
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

            const docRef = doc(collection(db, 'invoices'));
            batch.set(docRef, {
                type: 'purchase',
                date: row.date,
                refNo: row.vchNo,
                supplierInvoiceNo: row.supplierInvoiceNo || '',
                partyId: row.matchedParty?.id || row.partyId || '',
                partyName: row.matchedParty?.name || row.partyName || '',
                locationId: row.locationId || '',
                narration: row.narration || `Imported via ${row.format || 'Excel'}`,
                items,
                expenses: [],
                addlExpenses: [],
                addlExpCreditId: null,
                addlExpTotal: 0,
                salesExpenseMode: null,
                totalAmount: grand,
                foreignTotal: grand,
                currencyId: 'BASE',
                exchangeRate: 1.0,
                currencySymbol,
                taxId: row.taxId || null,
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
        docType: 'Purchase Invoice',
        refNo: batchImportId,
        amount: totalValue,
        description: `Imported ${totalImported} purchase vouchers from ${context.docLabel || 'Excel/XML'} (Batch: ${batchImportId})`,
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
        voucherType: 'purchase',
        docLabel: 'Purchase',
        status: 'COMPLETED'
    });

    return { batchImportId, totalImported, totalValue, cancelledCount, timestamp: timestampISO };
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
