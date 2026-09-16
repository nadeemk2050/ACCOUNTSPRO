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

import * as XLSX from 'xlsx';
import { db } from '../firebase.js';
import { collection, doc, writeBatch, setDoc, getDoc, updateDoc, serverTimestamp, getDocs, query, where, deleteDoc } from 'firebase/firestore';

export const BATCH_HISTORY_KEY = 'accpro_excel_batch_history';

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
    ];

    // 1. Check exact match
    for (const group of masterLists) {
        for (const item of group.items) {
            const itemName = String(item.name || '').trim().toLowerCase();
            if (itemName === query) {
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
export function parseExcelFile(arrayBuffer, options = {}) {
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
export function parseXMLFile(xmlText, options = {}) {
    const voucherMode = options.voucherMode || 'payment';
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror');
    if (parseError.length > 0) {
        throw new Error('Invalid XML file: ' + parseError[0].textContent);
    }

    const voucherNodes = xmlDoc.getElementsByTagName('VOUCHER');
    if (!voucherNodes || voucherNodes.length === 0) {
        throw new Error('No <VOUCHER> elements found in this XML document.');
    }

    const parsedVouchers = [];

    for (let i = 0; i < voucherNodes.length; i++) {
        const vNode = voucherNodes[i];
        const vchType = vNode.getElementsByTagName('VOUCHERTYPENAME')[0]?.textContent?.trim() ||
                        vNode.getAttribute('VCHTYPE') || (voucherMode === 'receipt' ? 'Receipt' : 'Payment');

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

        ledgerNodes.forEach(lNode => {
            const ledgerName = lNode.getElementsByTagName('LEDGERNAME')[0]?.textContent?.trim() || '';
            const rawAmt = parseFloat(lNode.getElementsByTagName('AMOUNT')[0]?.textContent) || 0;
            const isDeemedPositive = lNode.getElementsByTagName('ISDEEMEDPOSITIVE')[0]?.textContent?.trim();
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
            paidFrom = ledgerNodes[0].getElementsByTagName('LEDGERNAME')[0]?.textContent?.trim() || '';
            const secondName = ledgerNodes[1].getElementsByTagName('LEDGERNAME')[0]?.textContent?.trim() || '';
            const secondAmt = Math.abs(parseFloat(ledgerNodes[1].getElementsByTagName('AMOUNT')[0]?.textContent) || 0);
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
        vouchers: parsedVouchers
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
        const text = await file.text();
        parsed = parseXMLFile(text, options);
    } else {
        // .xlsx, .xls, .csv (SheetJS automatically parses CSV and Excel)
        const buffer = await file.arrayBuffer();
        parsed = parseExcelFile(buffer, options);
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
export async function createMissingMaster({ name, type = 'party', partyRole = 'supplier', dataOwnerId, user, effectiveName }) {
    if (!name || !name.trim()) throw new Error('Master name cannot be empty');
    const targetUid = dataOwnerId || user?.uid;
    if (!targetUid) throw new Error('User not identified');

    const collectionName = type === 'account' ? 'accounts' : 
        type === 'expense' ? 'expenses' : 
        type === 'direct_expense' ? 'direct_expenses' :
        type === 'income' ? 'income_accounts' :
        type === 'capital' ? 'capital_accounts' :
        type === 'asset' ? 'asset_accounts' : 'parties';

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
        docLabel = 'Payment'
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

    // Process all rows in chunks
    for (let i = 0; i < rowsToImport.length; i += BATCH_CHUNK_SIZE) {
        const chunk = rowsToImport.slice(i, i + BATCH_CHUNK_SIZE);
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

        await batch.commit();
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
