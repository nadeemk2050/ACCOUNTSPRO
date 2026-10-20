window.prompt = function (msg, defaultText) { console.warn('Prompt mocked: ', msg); return defaultText; };
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LicenseGate from './LicenseGate.jsx'

const extensionAsyncMessageNoise = 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';

// Suppress React internal development warnings
if (process.env.NODE_ENV === 'development') {
  const originalError = console.error;

  console.error = (...args) => {
    const first = args[0];
    const msg = typeof first === 'string' ? first : (first?.message || '');
    if (
      (msg.includes('Expected static flag was missing') ||
        msg.includes('Internal React error') ||
        msg.includes('Cannot find menu item with id') ||
        msg.includes('RxStorageInstanceDexie is closed') || 
        msg.includes('DM4') ||
        msg.includes('Could not establish connection. Receiving end does not exist') ||
        msg.includes(extensionAsyncMessageNoise))
    ) {
      return; // Suppress this specific error
    }
    originalError.apply(console, args);
  };

  // Some browser extensions emit unhandled promise rejections in page context.
  // Ignore only the known async message-channel noise so real app errors still surface.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const text = typeof reason === 'string' ? reason : (reason?.message || '');
    if (text.includes(extensionAsyncMessageNoise)) {
      event.preventDefault();
    }
  });
}

// This noise usually comes from browser extensions, not app logic.
// Keep this global so it does not spam users in non-dev builds either.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const text = typeof reason === 'string' ? reason : (reason?.message || '');
  if (text.includes(extensionAsyncMessageNoise)) {
    event.preventDefault();
  }
});

const APP_VERSION = 'V2.8.0'; // Update this string whenever you deploy a breaking change
console.log(`ACCPRO Running Version: ${APP_VERSION}`);

// ── Keep every open tab on the same build ───────────────────────────────────
// When an old tab and a new build share the same IndexedDB, Dexie upgrades the
// schema and closes the older tab's connection -> "Database has been closed".
// Converging all tabs on the newest running version prevents that.
const RUNNING_VERSION_KEY = 'accpro_running_version';
const versionParts = (v) => String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
const isNewerVersion = (a, b) => {
  const A = versionParts(a); const B = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0);
  }
  return false;
};
try {
  const stored = localStorage.getItem(RUNNING_VERSION_KEY);
  if (!stored || isNewerVersion(APP_VERSION, stored)) {
    localStorage.setItem(RUNNING_VERSION_KEY, APP_VERSION);
  }
} catch (e) { /* storage blocked */ }
window.addEventListener('storage', (e) => {
  if (e.key === RUNNING_VERSION_KEY && e.newValue && isNewerVersion(e.newValue, APP_VERSION)) {
    window.location.reload();
  }
});

// ── Recover from a closed local database instead of alerting users ───────────
const DB_CLOSED_RE = /Database has been closed|RxStorageInstanceDexie is closed|database connection is closing|DM4/i;
let dbRecoveryStarted = false;
const startDbRecovery = () => {
  if (dbRecoveryStarted) return;
  dbRecoveryStarted = true;
  const KEY = 'accpro_db_recover_at';
  let previous = 0;
  try { previous = Number(sessionStorage.getItem(KEY) || 0); sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { /* ignore */ }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;color:#fff;text-align:center;padding:24px';
  const looping = Date.now() - previous < 60000;
  overlay.innerHTML = looping
    ? `<div style="max-width:440px"><div style="font-size:15px;font-weight:800">Local database is busy</div><div style="margin-top:8px;font-size:12px;opacity:.8">Close other ACCPRO tabs, then reload.</div><button id="accpro-db-reload" style="margin-top:16px;padding:10px 18px;border-radius:10px;border:0;background:#22c55e;color:#052e16;font-weight:800;cursor:pointer">Reload now</button></div>`
    : `<div style="max-width:420px"><div style="font-size:15px;font-weight:800">Reconnecting local database…</div><div style="margin-top:8px;font-size:12px;opacity:.75">The app will refresh in a moment. Your saved data is safe.</div></div>`;
  document.body.appendChild(overlay);
  if (looping) {
    document.getElementById('accpro-db-reload')?.addEventListener('click', () => window.location.reload());
    return;
  }
  setTimeout(() => window.location.reload(), 1200);
};
window.__accproHandleDbClosed = startDbRecovery;

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const text = typeof reason === 'string' ? reason : (reason?.message || '');
  if (DB_CLOSED_RE.test(text)) {
    event.preventDefault();
    startDbRecovery();
  }
});

// Never show the raw IndexedDB error to end users.
const nativeAlert = window.alert.bind(window);
window.alert = (message) => {
  const text = typeof message === 'string' ? message : String(message ?? '');
  if (DB_CLOSED_RE.test(text)) { startDbRecovery(); return; }
  return nativeAlert(message);
};

// Keep service worker active so periodic/background sync can run in supported browsers.

const GlobalEffects = () => {
  useEffect(() => {
    // Prevent mouse wheel from changing number input values
    const handleWheel = (e) => {
      if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur(); // Remove focus to allow normal scrolling
      }
    };
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);

  // Soft Version Check Mechanism has been removed per user request
  // to prevent infinite reloading loops when version mismatched.

  return null;
};

createRoot(document.getElementById('root')).render(
  <React.Fragment>
    <GlobalEffects />
    <LicenseGate>
      <App />
    </LicenseGate>
  </React.Fragment>
)
