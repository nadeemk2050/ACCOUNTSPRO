import https from 'https';

const apiKey = '34b1e7e92fcc8b42384ec055dffc680142c552f409c2cf25';
const url = `https://accproapi-rl2gmlmsma-uc.a.run.app/accproApi?action=verify_team_login&apiKey=${apiKey}`;

const bodyData = JSON.stringify({
    username: 'haris',
    password: '123456'
});

const options = {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        'x-api-key': apiKey
    }
};

console.log('Sending request to verify team login on live API...');
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
