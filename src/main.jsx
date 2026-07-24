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

const APP_VERSION = 'V2.7.1'; // Update this string whenever you deploy a breaking change
console.log(`ACCPRO Running Version: ${APP_VERSION}`);

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
