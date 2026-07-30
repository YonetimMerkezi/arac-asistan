/**
 * owner-name-store.js
 * ---------------------------------------------------------------------------
 * Sesli asistanın karşılarken kullandığı ismi kalıcı saklar.
 *
 * ÖNCEKİ DURUM: app-init.js'te `const OWNER_NAME = 'Sedat';` olarak SABİT
 * kodluydu - uygulamayı başka biri kullandığında (ör. ailenin başka bir
 * aracında) hep "Merhaba Sedat" diyordu. Artık Ayarlar'dan değiştirilebilir.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logWarn } from './logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_owner_name';

/** @type {string} Hiç ayarlanmamışsa kullanılacak varsayılan isim. */
const DEFAULT_NAME = 'Sürücü';

/** @type {string} Bellekte tutulan güncel değer - her okumada Preferences'a gitmemek için. */
let cachedName = DEFAULT_NAME;

/**
 * Kayıtlı ismi yükler (uygulama açılışında bir kez çağrılmalıdır).
 * @returns {Promise<void>}
 */
export async function initOwnerName() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) cachedName = value;
  } catch (error) {
    logWarn('owner-name-store', 'İsim okunamadı, varsayılan kullanılıyor', error);
  }
}

/**
 * @returns {string}
 */
export function getOwnerName() {
  return cachedName;
}

/**
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function setOwnerName(name) {
  const trimmed = name.trim();
  cachedName = trimmed.length > 0 ? trimmed : DEFAULT_NAME;
  await Preferences.set({ key: STORAGE_KEY, value: cachedName });
}
