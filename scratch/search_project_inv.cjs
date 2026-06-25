const fs = require('fs');
const path = require('path');

function searchDir(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                searchDir(fullPath);
            }
        } else if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.cjs')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('InventoryVoucherV2')) {
                console.log(`Found in: ${fullPath}`);
            }
        }
    });
}

searchDir('c:/app2026/accountspro');
