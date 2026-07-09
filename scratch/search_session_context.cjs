const fs = require('fs');
const content = fs.readFileSync('src/App.jsx', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('accpro_session')) {
        console.log(`\n--- Line ${idx + 1} ---`);
        for (let i = Math.max(0, idx - 5); i <= Math.min(lines.length - 1, idx + 5); i++) {
            console.log(`${i + 1}: ${lines[i]}`);
        }
    }
});
process.exit(0);
