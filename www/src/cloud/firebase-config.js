/** Firebase yapılandırması; gerçek proje bilgisi Ayarlar ekranından kaydedilir. */
const STORAGE_KEY = 'sda_firebase_config_v1';
export const FIREBASE_CONFIG_FIELDS = ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
export async function getFirebaseConfig(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const c=JSON.parse(raw);return isValidFirebaseConfig(c)?c:null;}catch{return null;}}
export async function saveFirebaseConfig(config){const normalized=normalizeFirebaseConfig(config);if(!isValidFirebaseConfig(normalized))throw new Error('Firebase yapılandırması eksik veya geçersiz.');localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));return normalized;}
export async function clearFirebaseConfig(){localStorage.removeItem(STORAGE_KEY);}
export function isValidFirebaseConfig(config){return !!config&&FIREBASE_CONFIG_FIELDS.every(k=>typeof config[k]==='string'&&config[k].trim().length>0);}
export function normalizeFirebaseConfig(config){const source=config??{};return FIREBASE_CONFIG_FIELDS.reduce((out,key)=>{out[key]=String(source[key]??'').trim();return out;},{});}
export function parseFirebaseConfigText(text){const parsed=JSON.parse(text);return normalizeFirebaseConfig(parsed.firebaseConfig??parsed);}
