import https from 'https';

const apiKey = '34b1e7e92fcc8b42384ec055dffc680142c552f409c2cf25';
const url = `https://accproapi-rl2gmlmsma-uc.a.run.app/accproApi?action=add_contra&apiKey=${apiKey}`;

const bodyData = JSON.stringify({
    fromAccountId: '65e85439-e1ac-4070-a6d0-cb2f0bd25d7f', // AL SAHAM
    toAccountId: 'wR4Vvbts6VuCmggakfun', // AL SHAMS
    amount: 500,
    date: new Date().toISOString().split('T')[0],
    narration: 'Test Contra from API subagent',
    refNo: 'CTR-TEST-001',
    subUserId: '7mwtu',
    userName: 'haris'
});

const options = {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        'x-api-key': apiKey
    }
};

console.log('Sending contra request to live API...');
const req = https.request(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', data);
        process.exit(0);
    });
});

req.on('error', (err) => {
    console.error('Error sending request:', err.message);
    process.exit(1);
});

req.write(bodyData);
req.end();
