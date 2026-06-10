import https from 'https';

const apiKey = '47b9e6be0b37a8abb5cc7b09aec57cb464fc0509b5ac0451';

async function callApi(action, params = {}) {
    return new Promise((resolve, reject) => {
        let url = `https://accproapi-rl2gmlmsma-uc.a.run.app/accproApi?action=${action}&apiKey=${apiKey}`;
        Object.entries(params).forEach(([k, v]) => {
            url += `&${k}=${encodeURIComponent(v)}`;
        });
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Status: ${res.statusCode}, Body: ${data}`));
                }
            });
        });
        req.on('error', reject);
    });
}

async function run() {
    try {
        console.log('Fetching accounts...');
        const accountsData = await callApi('list_accounts');
        const rakAccount = accountsData.accounts.find(a => (a.name || '').toUpperCase().includes('RAK BANK AL SAHAM'));
        console.log(`RAK Accounts Data:`, rakAccount);

        console.log('\nFetching all daybook transactions...');
        const daybookData = await callApi('list_daybook', { limit: 'all' });
        console.log(`Total transactions returned from daybook: ${daybookData.transactions.length}`);

        let rakDr = 0;
        let rakCr = 0;
        const nameLower = 'rak bank al saham';

        daybookData.transactions.forEach(t => {
            const isDrMatch = (t.drName || '').toLowerCase() === nameLower || 
                              (t.drName || '').toLowerCase().split(', ').map(n => n.trim()).includes(nameLower);
            const isCrMatch = (t.crName || '').toLowerCase() === nameLower || 
                              (t.crName || '').toLowerCase().split(', ').map(n => n.trim()).includes(nameLower);

            if (isDrMatch || isCrMatch) {
                let isDr = isDrMatch;
                let isCr = isCrMatch;
                let amt = Number(t.amount || 0);

                if (isDr) {
                    if (t.isMulti && t.splits) {
                        const matchedSplit = t.splits.find(s => (s.targetName || '').toLowerCase() === nameLower);
                        if (matchedSplit) {
                            amt = Number(matchedSplit.amount || 0);
                        }
                    }
                    rakDr += amt;
                }
                if (isCr) {
                    if (t.isMulti && t.splits && t.type === 'journal_vouchers') {
                        const matchedSplit = t.splits.find(s => (s.targetName || '').toLowerCase() === nameLower && s.type === 'cr');
                        if (matchedSplit) {
                            amt = Number(matchedSplit.amount || 0);
                        }
                    }
                    rakCr += amt;
                }
            }
        });

        console.log(`\nDaybook Calculated: Dr=${rakDr}, Cr=${rakCr}`);
        console.log(`Accounts Dynamic:  Dr=${rakAccount.debit}, Cr=${rakAccount.credit}`);
        console.log(`Difference:        Dr=${rakDr - rakAccount.debit}, Cr=${rakCr - rakAccount.credit}`);

        if (Math.abs(rakDr - rakAccount.debit) < 0.01 && Math.abs(rakCr - rakAccount.credit) < 0.01) {
            console.log('\nSUCCESS: Daybook totals and Main AccountsPro dynamic totals match EXACTLY!');
        } else {
            console.log('\nERROR: Mismatch detected between Daybook and AccountsPro totals.');
        }

    } catch (e) {
        console.error('API Verification failed:', e.message);
    }
}

run();
