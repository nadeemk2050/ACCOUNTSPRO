/**
 * Convert QAPD backup to ACCPRO restore format
 * 
 * Usage: node convert_qapd_to_accpro.js
 * 
 * Reads: qapd_full_backup_2026-06-27.json (or specify filename as argument)
 * Writes: accpro_ready_restore.json
 */

const fs = require('fs');
const path = require('path');

// Get input file from command line or use default
const inputFile = process.argv[2] || 'c:\\Users\\Dell\\Downloads\\qapd_full_backup_2026-06-27.json';

if (!fs.existsSync(inputFile)) {
  console.error('File not found:', inputFile);
  console.error('Usage: node convert_qapd_to_accpro.js <path-to-qapd-backup.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Find the company key (e.g., qapd_accounts_NDTL232 -> NDTL232)
const accountKey = Object.keys(raw).find(k => k.startsWith('qapd_accounts_'));
const partyKey = Object.keys(raw).find(k => k.startsWith('qapd_parties_'));
const transactionKey = Object.keys(raw).find(k => k.startsWith('qapd_transactions_'));

if (!accountKey) {
  console.error('No accounts data found in QAPD backup!');
  console.error('Available keys:', Object.keys(raw).filter(k => k.startsWith('qapd_')).join(', '));
  process.exit(1);
}

const accounts = raw[accountKey] || [];
const parties = raw[partyKey] || [];
const transactions = raw[transactionKey] || [];

// QAPD stores EVERYTHING in "accounts" array with a `type` or `details` field:
//   details === "Party" → actually a Customer/Supplier
//   type === "bank" | "cash" | "bank_account" → Cash/Bank account
//   type === "expense" → Expense ledger
//   type === "income" | "income_account" → Income account
//   type === "capital" → Capital account
//   type === "asset" → Asset account
//   type === "party" | undefined with details="Party" → Party

console.log(`Found:`);
console.log(`  Raw accounts: ${accounts.length}`);
console.log(`  Ledgers:      ${parties.length}`);
console.log(`  Transactions: ${transactions.length}`);

// Build ACCPRO-format restore data
const accproData = { data: {} };

// Separate accounts into their proper collections
const acctList = [];
const partyList = [];
const expenseList = [];
const incomeList = [];
const capitalList = [];
const assetList = [];

for (const a of accounts) {
  const type = (a.type || '').toLowerCase();
  const details = (a.details || '').toLowerCase();
  
  // Use 'type' field for classification (more reliable than 'details')
  if (type === 'party') {
    partyList.push(a);
  } else if (type === 'expense' || type === 'direct_expense' || type === 'indirect_expense') {
    expenseList.push(a);
  } else if (type === 'income' || type === 'income_account' || type === 'direct_income' || type === 'indirect_income') {
    incomeList.push(a);
  } else if (type === 'capital' || type === 'equity') {
    capitalList.push(a);
  } else if (type === 'asset' || type === 'fixed_asset' || type === 'current_asset') {
    assetList.push(a);
  } else if (type === 'bank' || type === 'cash' || type === 'bank_account') {
    acctList.push(a);
  } else if (!type || type === 'undefined' || type === 'null') {
    // Unknown type - if details=Party treat as party, else treat as account
    if (details === 'party') {
      partyList.push(a);
    } else {
      acctList.push(a);
    }
  } else {
    // Everything else goes to accounts
    acctList.push(a);
  }
}

if (acctList.length > 0) {
  accproData.data.accounts = acctList;
  console.log(`  → Cash/Bank accounts: ${acctList.length}`);
}
if (partyList.length > 0) {
  accproData.data.parties = partyList;
  console.log(`  → Parties: ${partyList.length}`);
}
if (expenseList.length > 0) {
  accproData.data.expenses = expenseList;
  console.log(`  → Expenses: ${expenseList.length}`);
}
if (incomeList.length > 0) {
  accproData.data.income_accounts = incomeList;
  console.log(`  → Income accounts: ${incomeList.length}`);
}
if (capitalList.length > 0) {
  accproData.data.capital_accounts = capitalList;
  console.log(`  → Capital accounts: ${capitalList.length}`);
}
if (assetList.length > 0) {
  accproData.data.asset_accounts = assetList;
  console.log(`  → Asset accounts: ${assetList.length}`);
}

// 3. Process activity logs if available
const activityKey = Object.keys(raw).find(k => k.startsWith('qapd_activity_logs_'));
if (activityKey && Array.isArray(raw[activityKey]) && raw[activityKey].length > 0) {
  accproData.data.audit_logs = raw[activityKey];
  console.log(`  → Audit logs: ${raw[activityKey].length}`);
}

// 4. Process transactions - QAPD stores them flat with type/subType fields
if (transactions.length > 0) {
  for (const t of transactions) {
    const tType = (t.type || '').toLowerCase();
    const tSubType = (t.subType || '').toLowerCase();
    
    // Determine collection: 
    //   type=in/out/contra → payments
    //   type=sales/purchase → invoices
    //   type=journal → journal_vouchers
    //   type=manufacturing → stock_journals
    if (tType === 'in' || tType === 'out' || tType === 'contra' || tType === 'payment' || tType === 'receipt') {
      if (!accproData.data.payments) accproData.data.payments = [];
      accproData.data.payments.push(t);
    } else if (tType === 'sales' || tType === 'purchase' || tType === 'sales_invoice' || tType === 'purchase_invoice') {
      if (!accproData.data.invoices) accproData.data.invoices = [];
      accproData.data.invoices.push(t);
    } else if (tType === 'journal' || tType === 'adjustment') {
      if (!accproData.data.journal_vouchers) accproData.data.journal_vouchers = [];
      accproData.data.journal_vouchers.push(t);
    } else if (tType === 'manufacturing' || tType === 'production') {
      if (!accproData.data.stock_journals) accproData.data.stock_journals = [];
      accproData.data.stock_journals.push(t);
    } else {
      // Put in payments as default
      if (!accproData.data.payments) accproData.data.payments = [];
      accproData.data.payments.push(t);
    }
  }
  
  console.log(`  → Split transactions:`);
  Object.entries(accproData.data).forEach(([key, arr]) => {
    if (key !== 'accounts' && key !== 'parties' && key !== 'expenses' && key !== 'income_accounts' && key !== 'capital_accounts' && key !== 'asset_accounts') {
      console.log(`       ${key}: ${arr.length}`);
    }
  });
}

// Check if there are direct company keys (non-prefixed)
const companyKey = accountKey.replace('qapd_accounts_', '');
console.log(`\nCompany Key: ${companyKey}`);

// Write output
const outputFile = path.join(
  path.dirname(inputFile),
  'accpro_ready_restore.json'
);
fs.writeFileSync(outputFile, JSON.stringify(accproData, null, 2), 'utf8');

console.log(`\n✅ Converted! Saved to: ${outputFile}`);
console.log(`\nTo restore:`);
console.log(`1. Open main ACCPRO app`);
console.log(`2. Go to Management Dashboard → Restore`);
console.log(`3. Select the file: ${outputFile}`);
console.log(`4. Confirm the restore`);
