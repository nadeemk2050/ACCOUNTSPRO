/* Generates sample workbooks + a one-page guide (HTML) for every Excel importer.
   Run:  node samples/make-import-kit.cjs
   Output: samples/<Type>_Import_Sample.xlsx / .csv / <Type>_Import_Format.html
*/
const path = require('path');
const XLSX = require('xlsx');

const OUT = __dirname;

const KITS = {};

/* ─────────────────────────── RECEIPT ─────────────────────────── */
KITS.receipt = {
    title: 'Receipt Import — Excel / CSV Format',
    accent: '#0d9488',
    columns: [
        ['Date', 'YES', 'Date · Txn Date · Vch Date', '01-04-2026', 'YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYYMMDD or a real Excel date'],
        ['Voucher No', 'Recommended', 'Voucher No · Vch No · Ref No · Doc No', 'RCP-2001', 'Same No + Date on several rows = one voucher with multiple givers'],
        ['Received In (Bank/Cash)', 'Recommended', 'Received In · Deposit To · Bank · Cash · Account · Dr Ledger', 'Commercial Bank - ENBD', 'Must be an existing Cash / Bank ledger'],
        ['Received From (Customer)', 'YES', 'Received From · Customer · Party · Particulars · Cr Ledger', 'Global Metal Importers LLC', 'Must exist in masters — or create it in Solution Centre'],
        ['Amount', 'YES', 'Amount · Gross · Total · Debit · Credit · Received', '15000', 'Number only, greater than 0'],
        ['Currency', 'Optional', 'Currency · Curr · Ccy', 'BASE', 'BASE = AED. Use USD / EUR … for foreign currency'],
        ['Exchange Rate', 'Optional', 'Exchange Rate · Rate · FX', '1', 'Required when Currency is not BASE'],
        ['Narration', 'Optional', 'Narration · Remarks · Description · Notes', 'Customer payment inv 892', 'Saved on the voucher'],
    ],
    rows: [
        ['01-04-2026', 'RCP-2001', 'Commercial Bank - ENBD', 'Global Metal Importers LLC', 15000, 'BASE', 1, 'Customer payment inv 892'],
        ['02-04-2026', 'RCP-2002', 'Main Cash', 'Sunrise Trading FZE', 3500, 'BASE', 1, 'Cash settlement bill 104'],
        ['03-04-2026', 'RCP-2003', 'Commercial Bank - ENBD', 'Direct Scrap Sale Cash', 8200, 'BASE', 1, 'Direct yard scrap sales'],
        ['05-04-2026', 'RCP-2004', 'Main Cash', 'Al Falah Trading LLC', 2500, 'BASE', 1, 'Advance received'],
        ['05-04-2026', 'RCP-2004', 'Main Cash', 'Gulf Steel Traders', 1750, 'BASE', 1, '↑ same voucher = ONE voucher, 2 splits'],
    ],
    rules: [
        '<b>Date</b> and <b>Amount</b> are mandatory; amount must be greater than 0.',
        '<b>Received From</b> (customer / party) must exist in masters — otherwise the row waits in Solution Centre.',
        '<b>Received In</b> must be a Cash / Bank ledger of the company.',
        '<b>Duplicate</b> voucher numbers already in the system are quarantined (auto-renumber or skip).',
        'Same <b>Voucher No + Date</b> on several rows = one voucher with multiple givers (multi-split collection).',
        '<b>Foreign currency</b> rows need a valid exchange rate.',
        'Dates inside the <b>locked period</b> are rejected.',
        '<b>Tally XML</b> receipt vouchers are accepted on the same screen.',
    ],
};

/* ─────────────────────────── JOURNAL ─────────────────────────── */
KITS.journal = {
    title: 'Journal Voucher Import — Excel / CSV Format',
    accent: '#7c3aed',
    columns: [
        ['Date', 'YES', 'Date · Txn Date · Vch Date', '01-04-2026', 'YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYYMMDD or a real Excel date'],
        ['Voucher No', 'Recommended', 'Voucher No · Vch No · Ref No · Doc No', 'JV-3001', 'Same No + Date on several rows = one multi-leg journal'],
        ['Dr Ledger (Debit)', 'YES', 'Dr Ledger · Debit Ledger · Debit Account · Dr Account', 'Depreciation Expense', 'Must exist in masters (any ledger type)'],
        ['Cr Ledger (Credit)', 'YES', 'Cr Ledger · Credit Ledger · Credit Account · Cr Account', 'Accumulated Depreciation', 'Must exist in masters (any ledger type)'],
        ['Amount', 'YES', 'Amount · Gross · Total · Debit · Credit', '4500', 'Same amount is posted to Dr and Cr (must balance)'],
        ['Currency', 'Optional', 'Currency · Curr · Ccy', 'BASE', 'BASE = AED'],
        ['Exchange Rate', 'Optional', 'Exchange Rate · Rate · FX', '1', 'Required when Currency is not BASE'],
        ['Narration', 'Optional', 'Narration · Remarks · Description · Notes', 'Annual vehicle depreciation', 'Saved on the voucher'],
    ],
    rows: [
        ['01-04-2026', 'JV-3001', 'Depreciation Expense', 'Accumulated Depreciation', 4500, 'BASE', 1, 'Annual vehicle depreciation'],
        ['02-04-2026', 'JV-3002', 'Office Stationery Exp', 'Petty Cash Custodian', 750, 'BASE', 1, 'Month end stationery adjustment'],
        ['03-04-2026', 'JV-3003', 'Al Falah Trading LLC', 'Sunrise Trading FZE', 12000, 'BASE', 1, 'Inter-party balance settlement'],
    ],
    rules: [
        '<b>Date</b>, <b>Dr Ledger</b>, <b>Cr Ledger</b> and <b>Amount</b> are mandatory.',
        'Both ledgers must exist in masters (party, expense, cash / bank, capital, asset, income).',
        'A journal voucher must stay <b>balanced</b> — the importer posts the same amount on both sides.',
        'For multi-leg journals repeat the <b>same Voucher No + Date</b>; the rows are merged into one voucher.',
        '<b>Duplicate</b> voucher numbers already in the system are quarantined.',
        'Dates inside the <b>locked period</b> are rejected.',
        '<b>Foreign currency</b> rows need a valid exchange rate.',
        '<b>Tally XML</b> journal vouchers are accepted on the same screen.',
    ],
};

/* ─────────────────────── PURCHASE and SALES ─────────────────────── */
const buildTrade = (isSales) => ({
    title: `${isSales ? 'Sales' : 'Purchase'} Voucher Import — Excel / CSV Format`,
    accent: isSales ? '#2563eb' : '#ea580c',
    partyLabel: isSales ? 'Customer' : 'Supplier',
    columns: [
        ['Date', 'YES', 'Date · Txn Date · Vch Date', '02-04-2026', 'YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYYMMDD or a real Excel date'],
        ['Voucher No', 'Recommended', 'Voucher No · Vch No · Ref No · Doc No', isSales ? 'SAL-2001' : 'PUR-1001', 'Repeating the same No + Date merges item rows into one voucher'],
        [isSales ? 'Customer' : 'Supplier', 'YES', isSales ? 'Customer · Party · Buyer · Supplier' : 'Supplier · Party · Vendor · Customer', isSales ? 'Global Metal Importers LLC' : 'GHANI BHAI PVC', 'Must exist in Parties master'],
        ['Item', 'YES', 'Item · Item Name · Product · Description', isSales ? 'KHALID ALUMINIUM' : 'PVC SCRAP', 'Must exist in Items (stock) master'],
        ['Qty', 'YES', 'Qty · Quantity · Qnty', '650', 'Greater than 0'],
        ['Unit', 'Optional', 'Unit · UOM · Units', 'KG', 'PCS / KG / LTR / BAG …'],
        ['Rate', 'YES', 'Rate · Price · Unit Rate', '615', 'Per unit'],
        ['Amount', 'Optional', 'Amount · Value · Total · Gross', '399750', 'Leave blank = Qty × Rate is calculated'],
        ['Tax %', 'Optional', 'Tax % · GST % · VAT % · Tax Percent', '5', 'Applied on the line / voucher total'],
        ['Tax Amount', 'Optional', 'Tax Amount · VAT Amount · GST Amount', '12600', 'Use when you already know the tax value'],
        ['Bill No', 'Optional', 'Bill No · Invoice No · Supplier Invoice No · Ref', 'INV-889', 'Stored as the party invoice reference'],
        ['Narration', 'Optional', 'Narration · Remarks · Description · Notes', isSales ? 'Export sale' : 'Aluminium bundle', 'Saved on the voucher'],
    ],
    rows: isSales
        ? [
            ['03-04-2026', 'SAL-2001', 'Global Metal Importers LLC', 'KHALID ALUMINIUM', 500, 'KG', 720, 360000, 5, 18000, 'INV-501', 'Export sale'],
            ['06-04-2026', 'SAL-2002', 'Sunrise Trading FZE', 'PVC SCRAP', 900, 'KG', 265, 238500, 5, 11925, 'INV-502', 'Local sale'],
            ['09-04-2026', 'SAL-2003', 'Gulf Steel Traders', 'KHALID ALUMINIUM', 150, 'KG', 735, 110250, 0, 0, 'INV-503', 'Spot sale'],
        ]
        : [
            ['02-04-2026', 'PUR-1001', 'GHANI BHAI PVC', 'PVC SCRAP', 1200, 'KG', 210, 252000, 5, 12600, 'INV-889', 'PVC scrap lot'],
            ['05-04-2026', 'PUR-1002', 'AL FALAH TRADING', 'KHALID ALUMINIUM', 650, 'KG', 615, 399750, 0, 0, 'INV-890', 'Aluminium bundle'],
            ['08-04-2026', 'PUR-1003', 'GHANI BHAI PVC', 'PVC SCRAP', 300, 'KG', 212, '', 5, 3180, 'INV-891', 'Amount left blank → Qty × Rate'],
        ],
    rules: [
        '<b>Date</b>, <b>' + (isSales ? 'Customer' : 'Supplier') + '</b>, <b>Item</b>, <b>Qty</b> and <b>Rate</b> are mandatory.',
        'Party and every item must exist in masters — missing ones appear in Solution Centre.',
        'Rows sharing the <b>same Voucher No + Date</b> become one voucher with multiple item lines.',
        '<b>Amount</b> can be left empty — Qty × Rate is used. Tax % or Tax Amount is optional.',
        '<b>Duplicate</b> voucher numbers already in the system are quarantined (auto-renumber or skip).',
        'Dates inside the <b>locked period</b> are rejected.',
        'Stock is posted automatically for every item line (opening / closing quantities update).',
        '<b>Tally XML</b> ' + (isSales ? 'sales' : 'purchase') + ' vouchers are accepted on the same screen.',
    ],
});

KITS.purchase = buildTrade(false);
KITS.sales = buildTrade(true);

/* ────────────────────────── GENERATORS ────────────────────────── */
function writeCsv(file, rows) {
    const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fs = require('fs');
    fs.writeFileSync(file, rows.map(r => r.map(esc).join(',')).join('\n') + '\n', 'utf8');
}

function writeXlsx(file, kit, header, data) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws['!cols'] = header.map((h, i) => ({ wch: i === header.length - 1 ? 44 : Math.max(12, Math.min(28, String(h).length + 6)) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Data');

    const info = [
        [kit.title.toUpperCase()],
        ['Header row must be the first row of the sheet. Column order does not matter — names are matched by keyword.'],
        [],
        ['Column', 'Required', 'Accepted header names', 'Example', 'Notes'],
        ...kit.columns,
        [],
        ['RULES ENFORCED BY THE IMPORTER'],
        ...kit.rules.map((r, i) => [`${i + 1}. ${r.replace(/<\/?b>/g, '')}`]),
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(info);
    wsInfo['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 52 }, { wch: 26 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions');
    XLSX.writeFile(wb, file);
}

function badge(req) {
    if (req === 'YES') return '<span class="yes">YES</span>';
    if (req === 'Recommended') return '<span class="rec">Recommended</span>';
    return '<span class="opt">Optional</span>';
}

function writeHtml(file, kit, header, data) {
    const fs = require('fs');
    const colRows = kit.columns.map(c => `<tr><td><b>${c[0]}</b></td><td>${badge(c[1])}</td><td>${c[2]}</td><td><code>${c[3]}</code></td><td class="muted">${c[4]}</td></tr>`).join('');
    const dataRows = data.map(r => `<tr>${r.map((v, i) => `<td class="${typeof v === 'number' || (i === 4) ? 'num' : ''}">${v === '' ? '<span class="muted">(blank)</span>' : v}</td>`).join('')}</tr>`).join('');
    const rules = kit.rules.map(r => `<div>${r}</div>`).join('');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:26px 30px 30px; font-family:"Segoe UI",system-ui,-apple-system,sans-serif; background:#f8fafc; color:#0f172a; width:1380px; }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
  .brand { font-size:11px; font-weight:900; letter-spacing:3px; color:${kit.accent}; text-transform:uppercase; }
  h1 { font-size:25px; margin:4px 0 2px; letter-spacing:-.4px; }
  .sub { font-size:12.5px; color:#64748b; }
  .pill { background:${kit.accent}; color:#fff; font-size:11px; font-weight:800; letter-spacing:1px; padding:7px 14px; border-radius:999px; }
  h2 { font-size:12.5px; letter-spacing:1.4px; text-transform:uppercase; color:${kit.accent}; margin:20px 0 7px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
  th { background:#eef5ff; text-align:left; font-size:10.5px; letter-spacing:.8px; text-transform:uppercase; color:#1e3264; padding:8px 11px; border-bottom:1px solid #dbe6f5; }
  td { font-size:12.5px; padding:7px 11px; border-bottom:1px solid #eef2f7; vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .yes { color:#b91c1c; font-weight:800; } .rec { color:#b45309; font-weight:800; } .opt { color:#475569; font-weight:700; }
  code { font-family:Consolas,monospace; font-size:11.5px; background:#f1f5f9; padding:1px 5px; border-radius:4px; }
  .muted { color:#64748b; }
  .rules { display:grid; grid-template-columns:1fr 1fr; gap:5px 26px; font-size:12.5px; }
  .rules div { position:relative; padding-left:18px; line-height:1.5; }
  .rules div:before { content:"•"; position:absolute; left:4px; color:${kit.accent}; font-weight:900; }
  .sample th { background:#0f172a; color:#e2e8f0; border-bottom:none; font-size:10px; }
  .sample td { font-size:11.5px; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .note { margin-top:15px; background:#fffbeb; border:1px solid #fde68a; color:#92400e; font-size:12px; padding:9px 13px; border-radius:10px; }
</style></head><body>
  <div class="head">
    <div>
      <div class="brand">Accpro · Professional Accounting</div>
      <h1>${kit.title}</h1>
      <div class="sub">Header row must be the first row of the sheet. Column order does not matter — names are matched automatically.</div>
    </div>
    <div class="pill">IMPORT FORMAT GUIDE</div>
  </div>

  <h2>1 · Columns</h2>
  <table><tr><th style="width:170px">Column</th><th style="width:110px">Required</th><th style="width:340px">Accepted header names</th><th style="width:200px">Example</th><th>Notes</th></tr>${colRows}</table>

  <h2>2 · Sample Rows</h2>
  <table class="sample"><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr>${dataRows}</table>

  <h2>3 · Automatic Rules &amp; Validation</h2>
  <div class="rules">${rules}</div>

  <div class="note"><b>Tip:</b> Inside the app open <b>Management Hub → Import ${kit.title.split(' ')[0]} → Instructions &amp; Templates</b> and press <b>Download Standard (.xlsx)</b> for a ready-made file with these exact headers.</div>
</body></html>`;

    fs.writeFileSync(file, html, 'utf8');
}

for (const key of Object.keys(KITS)) {
    const kit = KITS[key];
    const Name = key === 'receipt' ? 'Receipt' : key === 'journal' ? 'Journal' : key === 'purchase' ? 'Purchase' : 'Sales';
    const header = kit.rows[0].map((_, i) => {
        if (key === 'journal') return ['Date', 'Voucher No', 'Dr Ledger (Debit)', 'Cr Ledger (Credit)', 'Amount', 'Currency', 'Exchange Rate', 'Narration'][i];
        if (key === 'receipt') return ['Date', 'Voucher No', 'Received In (Bank/Cash)', 'Received From (Customer)', 'Amount', 'Currency', 'Exchange Rate', 'Narration'][i];
        return ['Date', 'Voucher No', kit.partyLabel, 'Item', 'Qty', 'Unit', 'Rate', 'Amount', 'Tax %', 'Tax Amount', 'Bill No', 'Narration'][i];
    });

    writeCsv(path.join(OUT, `${Name}_Import_Sample.csv`), [header, ...kit.rows]);
    writeXlsx(path.join(OUT, `${Name}_Import_Sample.xlsx`), kit, header, kit.rows);
    writeHtml(path.join(OUT, `${Name}_Import_Format.html`), kit, header, kit.rows);
    console.log('written', Name);
}
