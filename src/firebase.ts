import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfigJson from '../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey || '',
  authDomain: firebaseConfigJson.authDomain || '',
  projectId: firebaseConfigJson.projectId || '',
  storageBucket: firebaseConfigJson.storageBucket || '',
  messagingSenderId: firebaseConfigJson.messagingSenderId || '',
  appId: firebaseConfigJson.appId || ''
};

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore with custom database ID
export const db = getFirestore(app, firebaseConfigJson.firestoreDatabaseId || 'ai-studio-455b21a0-3ed4-45e8-a2ba-944e0f1fcdb0');
export const defaultDb = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;
