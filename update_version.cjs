const fs = require('fs');
const files = [
    'src/App.jsx',
    'src/main.jsx',
    'src/ManagementDashboard.jsx',
    'src/PackagingSmartReportModal.jsx',
    'src/RegistersDashboard.jsx',
    'src/ReportsV2.jsx',
    'src/UserManualModal.jsx',
    'package.json',
    'package-lock.json',
    'public/version.json',
    'nadtally_update/version.json'
];

const FROM_VERSION = '2.7.0';
const TO_VERSION = '2.7.1';

files.forEach(file => {
    if (!fs.existsSync(file)) {
        console.warn(`File not found: ${file}`);
        return;
    }
    let content = fs.readFileSync(file, 'utf8');
    
    if (file === 'package-lock.json') {
        let count = 0;
        content = content.replace(/"version":\s*"2\.7\.0"/g, (match) => {
            count++;
            if (count <= 2) {
                return '"version": "2.7.1"';
            }
            return match;
        });
    } else {
        const regex = new RegExp(FROM_VERSION.replace(/\./g, '\\.'), 'gi');
        content = content.replace(regex, TO_VERSION);
    }
    
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
});
