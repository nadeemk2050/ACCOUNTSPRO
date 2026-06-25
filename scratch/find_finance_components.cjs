const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

const lineNumbers = [24217, 25654];
lineNumbers.forEach(lineNum => {
    console.log(`--- Line ${lineNum} ---`);
    for (let idx = lineNum - 1000; idx < lineNum; idx++) {
        if (lines[idx] && (lines[idx].startsWith('const ') || lines[idx].startsWith('function ')) && (lines[idx].includes('Modal') || lines[idx].includes('Voucher'))) {
            console.log(`  ${idx + 1}: ${lines[idx].trim()}`);
        }
    }
});
