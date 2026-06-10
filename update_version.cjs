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
    'public/version.json'
];

files.forEach(file => {
    if (!fs.existsSync(file)) {
        console.warn(`File not found: ${file}`);
        return;
    }
    let content = fs.readFileSync(file, 'utf8');
    
    if (file === 'package.json') {
        // Replace version with 2.6.6
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "2.6.6"');
    } else if (file === 'public/version.json') {
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "V2.6.6"');
    } else {
        // Replace various version strings to 2.6.6 / V2.6.6 / v 2.6.6 etc.
        // Let's replace versions like 2.6.2, 2.6.3, 2.6.4, 2.6.5
        content = content.replace(/v\s*2\.6\.[2345]/ig, (match) => {
            return match.startsWith('V') ? 'V2.6.6' : 'v2.6.6';
        });
        content = content.replace(/v\s+2\.6\.[2345]/ig, (match) => {
            return match.startsWith('V') ? 'V 2.6.6' : 'v 2.6.6';
        });
        content = content.replace(/\b2\.6\.[2345]\b/g, '2.6.6');
    }
    
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
});
