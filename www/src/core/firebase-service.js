import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCzrX6XTqMaGfdO6cV-CbHUsYTl2neYPac",
  authDomain: "arac-asistan-67a10.firebaseapp.com",
  projectId: "arac-asistan-67a10",
  storageBucket: "arac-asistan-67a10.firebasestorage.app",
  messagingSenderId: "704766485198",
  appId: "1:704766485198:web:f8c9b67684e9c477fc669f"
};

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let initialized = false;

function ensureFirebase() {
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  if (!auth) auth = getAuth(app);
  if (!db) db = getFirestore(app);
  return { app, auth, db };
}

/**
 * Firebase'i başlatır ve anonim kullanıcı oturumunu hazırlar.
 * Başarısızlık uygulamanın yerel çalışma modunu bozmaz.
 */
export async function initFirebaseService() {
  if (initialized && currentUser) return currentUser;

  try {
    const { auth: firebaseAuth } = ensureFirebase();

    if (firebaseAuth.currentUser) {
      currentUser = firebaseAuth.currentUser;
      initialized = true;
      return currentUser;
    }

    currentUser = await signInAnonymously(firebaseAuth).then((result) => result.user);
    initialized = true;
    return currentUser;
  } catch (error) {
    initialized = false;
    console.warn('[Firebase] Anonim oturum başlatılamadı:', error);
    return null;
  }
}

export function getFirebaseUser() {
  return currentUser ?? auth?.currentUser ?? null;
}

export function getFirebaseUid() {
  return getFirebaseUser()?.uid ?? null;
}

export function isFirebaseReady() {
  return Boolean(db && getFirebaseUser());
}

export function onFirebaseAuthChange(callback) {
  try {
    const { auth: firebaseAuth } = ensureFirebase();
    return onAuthStateChanged(firebaseAuth, (user) => {
      currentUser = user ?? null;
      callback?.(user);
    });
  } catch (error) {
    console.warn('[Firebase] Auth listener kurulamadı:', error);
    return () => {};
  }
}

/**
 * İlk Firestore bağlantısını doğrular.
 * users/{uid}/sync/current altında küçük bir bağlantı kaydı oluşturur.
 */
export async function testFirestoreConnection() {
  try {
    const { db: firestore } = ensureFirebase();
    const user = await initFirebaseService();
    if (!user) return { ok: false, reason: 'anonymous-auth-failed' };

    const ref = doc(firestore, 'users', user.uid, 'sync', 'current');
    await setDoc(ref, {
      type: 'connection-test',
      status: 'connected',
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const snapshot = await getDoc(ref);
    return {
      ok: snapshot.exists(),
      uid: user.uid,
      path: `users/${user.uid}/sync/current`,
    };
  } catch (error) {
    console.warn('[Firebase] Firestore bağlantı testi başarısız:', error);
    return { ok: false, reason: error?.code ?? error?.message ?? 'firestore-error' };
  }
}

export { firebaseConfig };
