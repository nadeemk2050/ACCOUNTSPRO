const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('lazy(') || line.includes('import(')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
