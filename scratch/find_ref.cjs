const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('checkDuplicateRef')) {
        console.log(`${idx + 1}: ${line.trim()}`);
        for (let i = 1; i <= 20; i++) {
            if (lines[idx + i]) console.log(`  ${idx + 1 + i}: ${lines[idx + i]}`);
        }
    }
});
