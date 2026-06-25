const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('checkGlobalDuplicate') && idx > 18000 && idx < 20000) {
        console.log(`${idx + 1}: ${line.trim()}`);
        for (let i = -5; i <= 5; i++) {
            console.log(`  ${idx + 1 + i}: ${lines[idx + i]}`);
        }
    }
});
