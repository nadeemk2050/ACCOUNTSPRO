/* Generates the sample Excel workbook used in the importer instructions:
   - Sheet "Payments"     : ready-to-import sample rows
   - Sheet "Instructions" : exact column specification + rules
   Run:  node samples/make-sample-xlsx.cjs
*/
const path = require('path');
const XLSX = require('xlsx');

const outFile = path.join(__dirname, 'Payment_Import_Sample.xlsx');

const payments = [
    ['Date', 'Voucher No', 'Paid From', 'Paid To', 'Amount', 'Currency', 'Exchange Rate', 'Narration'],
    ['01-04-2026', 'PAY-1001', 'Main Cash', 'Al Falah Trading LLC', 5000, 'BASE', 1, 'Payment against Invoice 402'],
    ['02-04-2026', 'PAY-1002', 'Commercial Bank - ENBD', 'Office Rent Expense', 1200, 'BASE', 1, 'April 2026 office rent'],
    ['03-04-2026', 'PAY-1003', 'Cash in Hand', 'Haris Fuel Petrol', 180, 'BASE', 1, 'Fuel - vehicle 71439'],
    ['05-04-2026', 'PAY-1004', 'Cash in Hand', 'Waliul Contra', 306, 'BASE', 1, 'Vehicle and labour expense'],
    ['05-04-2026', 'PAY-1004', 'Cash in Hand', 'Labour Expense', 150, 'BASE', 1, 'Vehicle and labour expense'],
    ['05-04-2026', 'PAY-1004', 'Cash in Hand', 'Rizwan Contra', 156, 'BASE', 1, 'Vehicle and labour expense'],
    ['07-04-2026', 'PAY-1005', 'Commercial Bank - ENBD', 'Global Steel Exports LLC', 2500, 'USD', 3.6725, 'Import payment - foreign currency'],
    ['10-04-2026', 'PAY-1006', 'Cash in Hand', 'Ahmed Transport Services', 750.5, 'BASE', 1, 'Transport charges - 3 trips'],
];

const instructions = [
    ['ACCPRO — PAYMENT IMPORT FROM EXCEL / CSV'],
    ['Row 1 must be the header row (the importer scans the first 15 rows for it).'],
    [],
    ['Column', 'Required', 'Accepted header names (any of these)', 'Example', 'Notes'],
    ['Date', 'YES', 'Date / Txn Date / Vch Date', '01-04-2026', 'YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYYMMDD or a real Excel date'],
    ['Voucher No', 'Recommended', 'Voucher No / Vch No / Ref No / Doc No', 'PAY-1001', 'Must be unique. Repeating the same No + Date merges rows into ONE multi-split voucher'],
    ['Paid From', 'Recommended', 'Paid From / Bank / Cash / Account / Cr Ledger', 'Main Cash', 'Must be an existing Cash/Bank ledger (accounts master)'],
    ['Paid To', 'YES', 'Paid To / Party / Supplier / Customer / Particulars / Dr Ledger', 'Al Falah Trading LLC', 'Must exist in masters (party / expense / account); can be created in Solution Centre'],
    ['Amount', 'YES', 'Amount / Gross / Total / Debit / Credit / Paid', '5000', 'Must be greater than 0. Plain number, no currency symbol'],
    ['Currency', 'Optional', 'Currency / Curr / Ccy', 'BASE', 'Use BASE for AED, or USD / EUR ... for foreign currency'],
    ['Exchange Rate', 'Optional', 'Exchange Rate / Rate / FX', '3.6725', 'Required when Currency is not BASE'],
    ['Narration', 'Optional', 'Narration / Remarks / Description / Notes', 'Payment against Invoice 402', 'Free text stored on the voucher'],
    [],
    ['RULES ENFORCED BY THE IMPORTER'],
    ['1. Date and Amount are mandatory; amount must be > 0.'],
    ['2. Paid To must exist in masters, otherwise the row is quarantined until you create it (Solution Centre).'],
    ['3. Paid From should be a Cash/Bank ledger; a missing one is quarantined.'],
    ['4. Duplicate voucher numbers already in the system are quarantined (auto-renumber or skip).'],
    ['5. Same Voucher No + Date on several rows = one voucher with multiple splits (multi-receiver payout).'],
    ['6. Foreign currency rows need an exchange rate.'],
    ['7. Dates inside a locked period (company lock date) are rejected.'],
    [],
    ['TIP', 'Download AccPro_Payment_Template_standard.xlsx from the importer for a ready-made file.'],
];

const wb = XLSX.utils.book_new();

const wsPay = XLSX.utils.aoa_to_sheet(payments);
wsPay['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 46 },
];
XLSX.utils.book_append_sheet(wb, wsPay, 'Payments');

const wsInfo = XLSX.utils.aoa_to_sheet(instructions);
wsInfo['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 52 }, { wch: 24 }, { wch: 78 }];
XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions');

XLSX.writeFile(wb, outFile);
console.log('written', outFile);
