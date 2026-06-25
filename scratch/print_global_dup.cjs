const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

for (let idx = 1450; idx < 1510; idx++) {
    console.log(`${idx + 1}: ${lines[idx]}`);
}
