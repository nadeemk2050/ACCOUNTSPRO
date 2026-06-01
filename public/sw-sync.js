const ACCPRO_PERIODIC_TAG = 'accpro-company-sync';
const ACCPRO_FALLBACK_SYNC_TAG = 'accpro-company-sync-once';
const ACCPRO_CONFIG_CACHE = 'accpro-sync-config-v1';
const ACCPRO_CONFIG_URL = '/__accpro_sync_config__';

async function readSyncConfig() {
  const cache = await caches.open(ACCPRO_CONFIG_CACHE);
  const res = await cache.match(ACCPRO_CONFIG_URL);
  if (!res) {
    return { companies: {} };
  }
  try {
    return await res.json();
  } catch (_e) {
    return { companies: {} };
  }
}

async function writeSyncConfig(config) {
  const cache = await caches.open(ACCPRO_CONFIG_CACHE);
  const payload = JSON.stringify(config || { companies: {} });
  await cache.put(
    ACCPRO_CONFIG_URL,
    new Response(payload, {
      headers: { 'content-type': 'application/json' },
    })
  );
}

async function upsertCompanyConfig(company) {
  if (!company || !company.companyId) return;
  const config = await readSyncConfig();
  const companies = config.companies || {};
  companies[company.companyId] = {
    companyId: company.companyId,
    companyName: company.companyName || '',
    updatedAt: Date.now(),
  };
  await writeSyncConfig({ companies });
}

async function removeCompanyConfig(companyId) {
  if (!companyId) return;
  const config = await readSyncConfig();
  const companies = config.companies || {};
  delete companies[companyId];
  await writeSyncConfig({ companies });
}

async function notifyClientsToRunSync(reason) {
  const config = await readSyncConfig();
  const companies = Object.values(config.companies || {});
  if (companies.length === 0) return;

  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  if (!clients || clients.length === 0) return;

  for (const client of clients) {
    client.postMessage({
      type: 'ACCPRO_RUN_SYNC',
      payload: {
        reason,
        companies,
      },
    });
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const type = data.type;
  const payload = data.payload || {};

  if (type === 'ACCPRO_SYNC_CONFIG_UPSERT') {
    event.waitUntil(upsertCompanyConfig(payload));
    return;
  }

  if (type === 'ACCPRO_SYNC_CONFIG_REMOVE') {
    event.waitUntil(removeCompanyConfig(payload.companyId));
    return;
  }

  if (type === 'ACCPRO_RUN_SYNC_NOW') {
    event.waitUntil(notifyClientsToRunSync(payload.reason || 'manual'));
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === ACCPRO_PERIODIC_TAG) {
    event.waitUntil(notifyClientsToRunSync('periodic-background-sync'));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === ACCPRO_FALLBACK_SYNC_TAG) {
    event.waitUntil(notifyClientsToRunSync('one-shot-background-sync'));
  }
});
