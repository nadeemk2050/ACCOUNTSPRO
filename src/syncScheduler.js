import {
  syncCompanyDataDelta,
  registerCompanyAsLiveInFirestore,
} from './liveSync.js';
import { getCompanyStats } from './localDB.js';

const PERIODIC_SYNC_TAG = 'accpro-company-sync';
const FALLBACK_SYNC_TAG = 'accpro-company-sync-once';
const LOCK_TTL_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_TRIGGER_GAP_MS = 45 * 1000;

const runtimeState = {
  schedulers: new Map(),
  bridgeReady: false,
};

function lockKey(companyId) {
  return `accpro_sync_lock_${companyId}`;
}

function statusKey(companyId) {
  return `accpro_sync_status_${companyId}`;
}

function acquireLock(companyId) {
  const key = lockKey(companyId);
  const now = Date.now();
  const token = `${now}-${Math.random().toString(36).slice(2)}`;

  try {
    const raw = localStorage.getItem(key) || (window.__syncLocks && JSON.stringify(window.__syncLocks[key]));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.expiresAt > now) {
        return null;
      }
    }
  } catch (_e) {
    // ignore malformed lock
  }

  const value = {
    token,
    acquiredAt: now,
    expiresAt: now + LOCK_TTL_MS,
  };
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("Storage quota exceeded, could not acquire localStorage lock:", e);
    if (!window.__syncLocks) window.__syncLocks = {};
    window.__syncLocks[key] = value;
  }
  return token;
}

function releaseLock(companyId, token) {
  const key = lockKey(companyId);
  try {
    if (window.__syncLocks && window.__syncLocks[key]?.token === token) {
      delete window.__syncLocks[key];
    }
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.token === token) {
      localStorage.removeItem(key);
    }
  } catch (_e) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
}

function saveStatus(companyId, status) {
  const next = {
    ...status,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(statusKey(companyId), JSON.stringify(next));
  } catch (_e) {
    // ignore storage quota errors
  }
}

function canRunNow(companyId) {
  const scheduler = runtimeState.schedulers.get(companyId);
  if (!scheduler) return true;
  return Date.now() - scheduler.lastTriggerAt > MIN_TRIGGER_GAP_MS;
}

async function notifyServiceWorker(type, payload) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active || reg.waiting || reg.installing;
    if (!target) return;
    target.postMessage({ type, payload });
  } catch (_e) {
    // ignore if service worker is not ready yet
  }
}

async function runCompanySync(companyId, companyName, reason) {
  if (!companyId) return { skipped: true, reason: 'missing-company' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };

  const token = acquireLock(companyId);
  if (!token) {
    return { skipped: true, reason: 'locked' };
  }

  saveStatus(companyId, { state: 'running', reason, startedAt: Date.now() });

  try {
    const delta = await syncCompanyDataDelta(companyId);
    const stats = await getCompanyStats(companyId).catch(() => null);
    if (stats) {
      await registerCompanyAsLiveInFirestore(companyId, companyName || '', stats);
    }

    const pushed = delta?.count || 0;
    saveStatus(companyId, {
      state: 'ok',
      reason,
      pushed,
      completedAt: Date.now(),
    });

    return { success: true, pushed };
  } catch (error) {
    saveStatus(companyId, {
      state: 'error',
      reason,
      message: error?.message || 'sync-failed',
      completedAt: Date.now(),
    });
    return { success: false, error: error?.message || 'sync-failed' };
  } finally {
    releaseLock(companyId, token);
  }
}

async function triggerScheduler(companyId, reason) {
  const scheduler = runtimeState.schedulers.get(companyId);
  if (!scheduler) return;
  if (!canRunNow(companyId)) return;

  scheduler.lastTriggerAt = Date.now();
  if (scheduler.inFlight) return scheduler.inFlight;

  scheduler.inFlight = runCompanySync(companyId, scheduler.companyName, reason)
    .finally(() => {
      const current = runtimeState.schedulers.get(companyId);
      if (current) current.inFlight = null;
    });

  return scheduler.inFlight;
}

async function registerPeriodicBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.ready;

  if ('periodicSync' in reg) {
    try {
      if (navigator.permissions?.query) {
        const result = await navigator.permissions.query({
          name: 'periodic-background-sync',
        });
        if (result.state === 'denied') return;
      }

      await reg.periodicSync.register(PERIODIC_SYNC_TAG, {
        minInterval: 12 * 60 * 60 * 1000,
      });
    } catch (_e) {
      // ignore unsupported periodic sync flows
    }
  }

  if ('sync' in reg) {
    try {
      await reg.sync.register(FALLBACK_SYNC_TAG);
    } catch (_e) {
      // ignore unsupported one-shot sync flows
    }
  }
}

function ensureMessageBridge() {
  if (runtimeState.bridgeReady) return;
  runtimeState.bridgeReady = true;

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'ACCPRO_RUN_SYNC') return;

    const payload = data.payload || {};
    const companies = Array.isArray(payload.companies) ? payload.companies : [];
    const reason = payload.reason || 'service-worker-request';

    companies.forEach((company) => {
      const id = company?.companyId;
      if (id && runtimeState.schedulers.has(id)) {
        triggerScheduler(id, reason);
      }
    });
  });
}

export function isBackgroundSyncEnabled(company) {
  if (!company?.settings?.isLive) return false;
  return company.settings.backgroundSyncEnabled !== false;
}

export async function startCompanySyncScheduler(company, options = {}) {
  if (!company?.id || !isBackgroundSyncEnabled(company)) return;

  ensureMessageBridge();

  const intervalMs = Number(options.intervalMs || DEFAULT_INTERVAL_MS);
  const companyId = company.id;
  const companyName = company.name || '';

  if (runtimeState.schedulers.has(companyId)) {
    const existing = runtimeState.schedulers.get(companyId);
    existing.companyName = companyName;
    await notifyServiceWorker('ACCPRO_SYNC_CONFIG_UPSERT', {
      companyId,
      companyName,
    });
    return;
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      triggerScheduler(companyId, 'visibility-resume');
    }
  };

  const onFocus = () => triggerScheduler(companyId, 'focus');
  const onOnline = () => triggerScheduler(companyId, 'network-online');

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);

  const intervalId = window.setInterval(() => {
    triggerScheduler(companyId, 'timer');
  }, intervalMs);

  runtimeState.schedulers.set(companyId, {
    companyName,
    intervalId,
    onVisibility,
    onFocus,
    onOnline,
    inFlight: null,
    lastTriggerAt: 0,
  });

  await notifyServiceWorker('ACCPRO_SYNC_CONFIG_UPSERT', {
    companyId,
    companyName,
  });
  await registerPeriodicBackgroundSync();

  // Prime once shortly after scheduler start so stale devices catch up quickly.
  window.setTimeout(() => {
    triggerScheduler(companyId, 'scheduler-start');
  }, 8000);
}

export async function stopCompanySyncScheduler(companyId) {
  if (!companyId) return;

  const scheduler = runtimeState.schedulers.get(companyId);
  if (!scheduler) return;

  document.removeEventListener('visibilitychange', scheduler.onVisibility);
  window.removeEventListener('focus', scheduler.onFocus);
  window.removeEventListener('online', scheduler.onOnline);
  window.clearInterval(scheduler.intervalId);

  runtimeState.schedulers.delete(companyId);

  await notifyServiceWorker('ACCPRO_SYNC_CONFIG_REMOVE', { companyId });
}

export async function stopAllCompanySyncSchedulers() {
  const ids = Array.from(runtimeState.schedulers.keys());
  for (const id of ids) {
    await stopCompanySyncScheduler(id);
  }
}

export async function triggerCompanySyncNow(companyId, reason = 'manual') {
  return triggerScheduler(companyId, reason);
}
