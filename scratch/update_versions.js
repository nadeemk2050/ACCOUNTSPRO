const fs = require('fs');
const path = require('path');

// Update main AccountsPro files
const mainFiles = [
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

mainFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');

    // package.json: version
    if (file === 'package.json') {
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "2.6.7"');
    } else if (file === 'public/version.json') {
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "V2.6.7"');
    } else if (file === 'src/App.jsx') {
        // App.jsx replaces 2.6.3 with 2.6.7
        content = content.replace(/2\.6\.3\s*\(April\s*2026\)/g, '2.6.7 (June 2026)');
        content = content.replace(/v2\.6\.3/g, 'v2.6.7');
        content = content.replace(/v\s*2\.6\.3/g, 'v 2.6.7');
        content = content.replace(/"2\.6\.3"/g, '"2.6.7"');
    } else {
        // Replaces 2.6.6 with 2.6.7
        content = content.replace(/2\.6\.6/g, '2.6.7');
    }

    fs.writeFileSync(filePath, content);
    console.log(`Updated main app file: ${file}`);
});

// Update QuickAccPro files
const quickFiles = [
    'quickaccpro/package.json',
    'quickaccpro/src/components/Layout.jsx',
    'quickaccpro/src/components/ApiKeyLogin.jsx'
];

quickFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');

    if (file === 'quickaccpro/package.json') {
        content = content.replace(/"version":\s*"[^"]+"/g, '"version": "1.4.0"');
    } else {
        // replace v1.3 with v1.4
        content = content.replace(/v1\.3/g, 'v1.4');
    }

    fs.writeFileSync(filePath, content);
    console.log(`Updated quick app file: ${file}`);
});

console.log('Version updates completed.');
