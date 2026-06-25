const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('const [parties') || line.includes('const [expenses') || line.includes('const [accounts') || line.includes('const [incomeAccounts') || line.includes('const [capitalAccounts') || line.includes('const [assetAccounts') || line.includes('directExpenseAccounts')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
