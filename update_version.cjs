const fs = require('fs');
const files = [
    'src/App.jsx',
    'src/main.jsx',
    'src/ManagementDashboard.jsx',
    'src/PackagingSmartReportModal.jsx',
    'package.json'
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    if (file === 'package.json') {
        content = content.replace(/"version": "2\.6\.2"/g, '"version": "2.6.5"');
    } else {
        content = content.replace(/v 2\.6\.2/ig, 'V2.6.5');
        content = content.replace(/v2\.6\.2/ig, 'V2.6.5');
        content = content.replace(/2\.6\.2/g, 'V2.6.5');
    }
    
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
});
