// ===== RESTORE MISSING BANK ACCOUNTS =====
// Paste this in main ACCPRO's Console (F12) and press Enter

(async () => {
  const accounts = [
    {"id":"03iuGeMokLvVQMUiNMtg","name":"HBZ BANK AL SAHAM","type":"bank","balance":372993.5088760001,"details":"Party"},
    {"id":"2c347356-466e-4fdf-ae9a-503b2926e2ea","name":"AXIOM CASHIER","type":"bank","balance":-57967,"details":"Party"},
    {"id":"Pnus7QLBiGRSG6UBRIB8","name":"RAK BANK AL SAHAM","type":"bank","balance":650860.2800000011,"details":"Party"},
    {"id":"TlLJ1BlrijK50oK9xSZC","name":"OBAIDALLAH RAK ACCOUNT","type":"bank","balance":39954.62,"details":"Party"},
    {"id":"UKb82dnuJusiZjFG1Pqm","name":"NADEEM CASH","type":"bank","balance":411079,"details":"Party"},
    {"id":"bCQgZfeU2rYTWRtW32Ye","name":"BRAND BANK HBZ","type":"bank","balance":-73522.18,"details":"Party"},
    {"id":"f2006893-85de-4e3d-a9f7-ec7f75316c5f","name":"HBZ BRANDS","type":"bank","balance":-41950,"details":"Party"},
    {"id":"gkQX4OwWpXApMhwDpBlp","name":"FARHAN CASH 3","type":"bank","balance":33563,"details":"Party"},
    {"id":"iD1UmkFjpZckNBgZk3PH","name":"OMAR CASH","type":"bank","balance":1700,"details":"Party"},
    {"id":"oFqDHnT0nH5EwTadfMIq","name":"CAPITAL CASH","type":"bank","balance":-481692.24,"details":"Party"},
    {"id":"sC6Bq0wkJggDTP5Xw3hF","name":"farhan rak account","type":"bank","balance":26266.78,"details":"Party"},
    {"id":"sEas8RY8PxW51zI3VzrD","name":"ARIFUL CASH","type":"bank","balance":-0.01,"details":"Party"},
    {"id":"thYCRk7ckYsOUlcmdpm5","name":"E MONEY NADEEM","type":"bank","balance":-40,"details":"Party"}
  ];
  
  try {
    const { getDB } = await import('./localDB.js');
    const db = await getDB();
    let count = 0;
    for (const acct of accounts) {
      const existing = await db.offline_records.findOne({ selector: { id: acct.id } }).exec();
      if (existing) {
        console.log('⏭️ Already exists:', acct.name);
        continue;
      }
      await db.offline_records.insert({
        id: acct.id,
        collectionName: 'accounts',
        data: acct,
        timestamp: Date.now(),
        lastSync: 0
      });
      count++;
      console.log('✅ Restored:', acct.name);
    }
    console.log(`\n🎉 Done! ${count} accounts restored. Refresh the page.`);
  } catch (e) {
    console.error('Error:', e);
  }
})();
