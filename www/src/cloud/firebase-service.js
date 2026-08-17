import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getFirebaseConfig } from './firebase-config.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

let app = null;
let auth = null;
let db = null;
let user = null;
let initialized = false;
let authUnsubscribe = null;

export async function initFirebaseService() {
  if (initialized) return { enabled: true, user };

  const config = await getFirebaseConfig();
  if (!config) {
    logInfo('firebase', 'Firebase yapılandırılmamış; uygulama yerel/offline çalışıyor.');
    return { enabled: false, user: null };
  }

  try {
    app = getApps()[0] ?? initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    initialized = true;

    authUnsubscribe = onAuthStateChanged(auth, (nextUser) => {
      user = nextUser ?? null;
    });

    if (!auth.currentUser) await signInAnonymously(auth);
    user = auth.currentUser;

    await enableNetwork(db).catch(() => {});
    await testFirestoreConnection();

    logInfo('firebase', 'Firebase hazır.', { uid: user?.uid });
    return { enabled: true, user };
  } catch (error) {
    initialized = false;
    logError('firebase', 'Firebase başlatılamadı', error);
    return { enabled: false, user: null, error };
  }
}

export function isFirebaseReady() {
  return initialized && !!db && !!auth?.currentUser;
}

export function getFirebaseUser() {
  return user ?? auth?.currentUser ?? null;
}

export async function testFirestoreConnection() {
  if (!initialized || !db) throw new Error('Firestore hazır değil.');

  const uid = getFirebaseUser()?.uid;
  if (!uid) throw new Error('Firebase kullanıcı oturumu yok.');

  const ref = doc(db, 'users', uid, 'meta', 'connection');
  await setDoc(ref, {
    status: 'online',
    checkedAt: serverTimestamp(),
    app: 'smart-drive-ai',
    version: 2,
  }, { merge: true });

  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Firestore yazma/okuma testi başarısız.');
  return true;
}

export async function uploadSnapshot(snapshot, signature = null) {
  if (!isFirebaseReady()) throw new Error('Firebase bağlı değil.');

  const uid = getFirebaseUser()?.uid;
  if (!uid) throw new Error('Firebase kullanıcı oturumu yok.');

  const now = new Date().toISOString();
  await setDoc(doc(db, 'users', uid, 'sync', 'current'), {
    version: 3,
    schemaVersion: snapshot?.formatVersion ?? 1,
    updatedAt: serverTimestamp(),
    clientUpdatedAt: now,
    signature: signature ?? null,
    payload: snapshot,
  }, { merge: false });

  return { ok: true, clientUpdatedAt: now, signature };
}

export async function downloadSnapshot() {
  if (!isFirebaseReady()) throw new Error('Firebase bağlı değil.');

  const uid = getFirebaseUser()?.uid;
  if (!uid) throw new Error('Firebase kullanıcı oturumu yok.');

  const snap = await getDoc(doc(db, 'users', uid, 'sync', 'current'));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    payload: data?.payload ?? null,
    clientUpdatedAt: data?.clientUpdatedAt ?? null,
    schemaVersion: data?.schemaVersion ?? 1,
    signature: data?.signature ?? null,
  };
}

/**
 * Çakışma halinde mevcut bulut sürümünü kaybetmemek için ayrı bir belgeye alır.
 * Böylece yerel sürüm kazanırken eski bulut verisi de geri döndürülebilir.
 */
export async function saveConflictSnapshot(snapshot, signature = null) {
  if (!isFirebaseReady()) throw new Error('Firebase bağlı değil.');

  const uid = getFirebaseUser()?.uid;
  if (!uid) throw new Error('Firebase kullanıcı oturumu yok.');

  const id = `conflict_${Date.now()}`;
  await setDoc(doc(db, 'users', uid, 'sync', id), {
    version: 3,
    createdAt: serverTimestamp(),
    signature: signature ?? null,
    payload: snapshot,
  }, { merge: false });

  return id;
}

export async function setFirebaseNetwork(online) {
  if (!db) return;
  try {
    if (online) await enableNetwork(db);
    else await disableNetwork(db);
  } catch (error) {
    logWarn('firebase', online ? 'Ağ açılamadı' : 'Offline moda geçilemedi', error);
  }
}

export function disposeFirebaseService() {
  authUnsubscribe?.();
  authUnsubscribe = null;
  app = null;
  auth = null;
  db = null;
  user = null;
  initialized = false;
}
