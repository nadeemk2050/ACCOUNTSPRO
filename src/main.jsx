window.prompt = function (msg, defaultText) { console.warn('Prompt mocked: ', msg); return defaultText; };
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LicenseGate from './LicenseGate.jsx'

// Suppress React internal development warnings
if (process.env.NODE_ENV === 'development') {
  const originalError = console.error;
  console.error = (...args) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (
      (first.includes('Expected static flag was missing') ||
        first.includes('Internal React error') ||
        first.includes('Could not establish connection. Receiving end does not exist') ||
        first.includes('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'))
    ) {
      return; // Suppress this specific error
    }
    originalError.apply(console, args);
  };
}

const APP_VERSION = '2.5.7'; // Update this string whenever you deploy a breaking change
console.log(`NADTALLY Running Version: ${APP_VERSION}`);

// 🛡️ SECURITY & CACHE FIX: Unregister any existing service workers that might be serving old code
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) {
      registration.unregister();
      console.log('Service Worker unregistered');
    }
  });
}

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

  // Soft Version Check Mechanism: Simple json file fetched bypassing cache
  useEffect(() => {
    let intervalId;

    const checkVersion = async () => {
      try {
        // Fetch a static config file, append a timestamp to bust the cache!
        const response = await fetch(`version.json?t=${new Date().getTime()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.version && data.version !== APP_VERSION) {
            console.warn(`Version mismatch! Detected ${data.version}, but currently running ${APP_VERSION}. Forcing reload...`);
            // Show a brief alert, so the user isn't totally shocked when the page blinks out
            alert("A new update for NADTALLY has been released! The page will now refresh to apply the latest changes.");
            // Hard reload, clearing cache
            window.location.reload(true);
          }
        }
      } catch (e) {
        // Silently fail if offline or file missing
        console.log("Could not check version:", e);
      }
    };

    // Check version immediately on load, then every 5 minutes
    setTimeout(checkVersion, 2000);
    intervalId = setInterval(checkVersion, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

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
