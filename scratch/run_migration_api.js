import https from 'https';

const url = 'https://accproapi-rl2gmlmsma-uc.a.run.app/accproApi?action=run_migration&apiKey=34b1e7e92fcc8b42384ec055dffc680142c552f409c2cf25';

console.log('Sending request to run migration...');
https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', data);
        process.exit(0);
    });
}).on('error', (err) => {
    console.error('Error sending request:', err.message);
    process.exit(1);
});
