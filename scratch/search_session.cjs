const fs = require('fs');
const content = fs.readFileSync('src/App.jsx', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('localStorage.getItem') || line.includes('session') || line.includes('accpro_session')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
process.exit(0);
