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
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "2.6.8"');
    } else if (file === 'public/version.json') {
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "V2.6.8"');
    } else {
        content = content.replace(/2\.6\.7/g, '2.6.8');
    }
    
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
});
