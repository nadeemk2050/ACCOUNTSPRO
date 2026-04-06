import { initializeApp } from "firebase/app";
// Use @firebase/* directly so Vite's rxfs.js alias for 'firebase/firestore' is bypassed
import { initializeFirestore, memoryLocalCache } from "@firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDaKgWXJiz_NTYo4NBCXhVZ7qIo9SwkooY",
  authDomain: "cashshams.firebaseapp.com",
  projectId: "cashshams",
  storageBucket: "cashshams.firebasestorage.app",
  messagingSenderId: "565173718396",
  appId: "1:565173718396:web:c23d370ab7c629f86c28f9"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
const auth = getAuth(app);
const functions = getFunctions(app);
const rtdb = getDatabase(app);

export { app, db, auth, functions, rtdb };
