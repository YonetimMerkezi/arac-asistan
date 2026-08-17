/**
 * Firebase yapılandırması.
 * Varsayılan proje yapılandırması uygulamaya gömülüdür; kullanıcı isterse
 * Ayarlar ekranından kendi yapılandırmasıyla değiştirebilir.
 */
const STORAGE_KEY = 'sda_firebase_config_v1';

export const FIREBASE_CONFIG_FIELDS = [
  'apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId',
];

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCzrX6XTqMaGfdO6cV-CbHUsYTl2neYPac',
  authDomain: 'arac-asistan-67a10.firebaseapp.com',
  projectId: 'arac-asistan-67a10',
  storageBucket: 'arac-asistan-67a10.firebasestorage.app',
  messagingSenderId: '704766485198',
  appId: '1:704766485198:web:f8c9b67684e9c477fc669f',
};

export async function getFirebaseConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (isValidFirebaseConfig(config)) return config;
    }
  } catch {}
  return DEFAULT_FIREBASE_CONFIG;
}

export async function saveFirebaseConfig(config) {
  const normalized = normalizeFirebaseConfig(config);
  if (!isValidFirebaseConfig(normalized)) {
    throw new Error('Firebase yapılandırması eksik veya geçersiz.');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function clearFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isValidFirebaseConfig(config) {
  return !!config && FIREBASE_CONFIG_FIELDS.every(
    (key) => typeof config[key] === 'string' && config[key].trim().length > 0,
  );
}

export function normalizeFirebaseConfig(config) {
  const source = config ?? {};
  return FIREBASE_CONFIG_FIELDS.reduce((out, key) => {
    out[key] = String(source[key] ?? '').trim();
    return out;
  }, {});
}

export function parseFirebaseConfigText(text) {
  const parsed = JSON.parse(text);
  return normalizeFirebaseConfig(parsed.firebaseConfig ?? parsed);
}

export { DEFAULT_FIREBASE_CONFIG };
