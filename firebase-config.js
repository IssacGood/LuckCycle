// ⚠️ 這是你自己 Firebase 專案的設定(luckcycle-7d3c7)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBuyzreG1nMK76K08tbTQsFwqPkeF5pCLs",
  authDomain: "luckcycle-7d3c7.firebaseapp.com",
  projectId: "luckcycle-7d3c7",
  storageBucket: "luckcycle-7d3c7.firebasestorage.app",
  messagingSenderId: "829816861809",
  appId: "1:829816861809:web:5735a7dd6c4635351157d0",
  measurementId: "G-WWSG0W46LL"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
};
