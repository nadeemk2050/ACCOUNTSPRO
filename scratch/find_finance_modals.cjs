const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

const lineNumbers = [24315, 25752];
lineNumbers.forEach(lineNum => {
    console.log(`--- Line ${lineNum} ---`);
    for (let idx = lineNum - 100; idx < lineNum; idx++) {
        if (lines[idx] && (lines[idx].includes('const ') || lines[idx].includes('function '))) {
            console.log(`  ${idx + 1}: ${lines[idx].trim()}`);
        }
    }
});
