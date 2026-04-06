import { app as realApp, db as cloudDb, auth as cloudAuth, functions as cloudFunctions, rtdb as cloudRtdb } from './realFirebase.js';

// The following imports will be aliased by Vite to use rxfs.js/local storage
import { initializeApp } from "firebase/app";
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDaKgWXJiz_NTYo4NBCXhVZ7qIo9SwkooY",
  authDomain: "cashshams.firebaseapp.com",
  projectId: "cashshams",
  storageBucket: "cashshams.firebasestorage.app",
  messagingSenderId: "565173718396",
  appId: "1:565173718396:web:c23d370ab7c629f86c28f9"
};

const app = initializeApp(firebaseConfig);

// Electron can intermittently fail IndexedDB backing-store initialization.
// Use in-memory cache there to avoid startup/runtime crashes.
const isElectronRuntime = typeof window !== 'undefined' && !!window.process?.versions?.electron;

const db = initializeFirestore(app, {
  localCache: isElectronRuntime
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);
const functions = getFunctions(app);
const rtdb = getDatabase(app);
const storage = getStorage(app);

export { app, db, auth, functions, rtdb, storage, cloudDb, cloudAuth, cloudFunctions, cloudRtdb };
