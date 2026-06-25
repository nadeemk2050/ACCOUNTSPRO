const fs = require('fs');
const content = fs.readFileSync('c:/app2026/accountspro/src/App.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('<ManagementDashboard')) {
        console.log(`Usage at ${idx + 1}: ${line.trim()}`);
        // print next 30 lines
        for (let i = 1; i <= 30; i++) {
            console.log(`  ${idx + 1 + i}: ${lines[idx + i]}`);
        }
    }
});
