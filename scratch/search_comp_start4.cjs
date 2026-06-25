const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

for (let idx = 17850; idx < 17950; idx++) {
    console.log(`${idx + 1}: ${lines[idx]}`);
}
