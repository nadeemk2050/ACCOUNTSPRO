const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

const inspect = [15343, 18981, 24315, 25752];
inspect.forEach(lineNum => {
    console.log(`--- Line ${lineNum} ---`);
    for (let i = -10; i <= 10; i++) {
        const lIdx = lineNum - 1 + i;
        if (lines[lIdx]) console.log(`${lIdx + 1}: ${lines[lIdx]}`);
    }
});
