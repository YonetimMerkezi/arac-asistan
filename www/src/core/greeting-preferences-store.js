/**
 * greeting-preferences-store.js
 * ---------------------------------------------------------------------------
 * Sesli karşılama mesajının AÇIK/KAPALI olup olmadığını ve İÇERİĞİNİ
 * (hangi bilgilerin söyleneceğini) kalıcı saklar.
 *
 * ÖNCEKİ DURUM: Karşılama cümlesinin içeriği (isim + başarı + sıcaklık +
 * voltaj + yakıt + "sürüş kaydı başlatılıyor") SABİT KODLUYDU - kullanıcının
 * ne söyleneceği üzerinde hiçbir kontrolü yoktu, sesi tamamen kapatmanın da
 * bir yolu yoktu.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logWarn } from './logger.js';

const STORAGE_KEY_ENABLED = 'sda_greeting_spoken_enabled';
const STORAGE_KEY_FIELDS = 'sda_greeting_fields';

/** @typedef {'success'|'coolant'|'outside'|'voltage'|'fuel'|'closing'} GreetingField */

/** @type {GreetingField[]} Hiç özelleştirme yapılmamışsa kullanılacak varsayılan içerik (önceki sabit davranışla aynı). */
const DEFAULT_FIELDS = ['success', 'coolant', 'outside', 'voltage', 'fuel', 'closing'];

/** @type {{label: string, field: GreetingField}[]} Ayarlar ekranında gösterilecek seçenekler, sırasıyla. */
export const GREETING_FIELD_OPTIONS = [
  { field: 'success', label: 'Bağlantı başarılı mesajı' },
  { field: 'coolant', label: 'Motor sıcaklığı' },
  { field: 'outside', label: 'Dış hava sıcaklığı' },
  { field: 'voltage', label: 'Akü voltajı' },
  { field: 'fuel', label: 'Yakıt seviyesi' },
  { field: 'closing', label: '"Sürüş kaydı başlatılıyor, iyi yolculuklar"' },
];

/** @type {boolean} */
let cachedEnabled = true;

/** @type {GreetingField[]} */
let cachedFields = DEFAULT_FIELDS;

/**
 * Kayıtlı tercihleri yükler (uygulama açılışında bir kez çağrılmalıdır).
 * @returns {Promise<void>}
 */
export async function initGreetingPreferences() {
  try {
    const enabledResult = await Preferences.get({ key: STORAGE_KEY_ENABLED });
    cachedEnabled = enabledResult.value !== 'false';

    const fieldsResult = await Preferences.get({ key: STORAGE_KEY_FIELDS });
    if (fieldsResult.value) {
      cachedFields = JSON.parse(fieldsResult.value);
    }
  } catch (error) {
    logWarn('greeting-preferences-store', 'Tercihler okunamadı, varsayılan kullanılıyor', error);
  }
}

/**
 * @returns {boolean}
 */
export function isGreetingSpoken() {
  return cachedEnabled;
}

/**
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setGreetingSpoken(enabled) {
  cachedEnabled = enabled;
  await Preferences.set({ key: STORAGE_KEY_ENABLED, value: String(enabled) });
}

/**
 * @returns {GreetingField[]}
 */
export function getGreetingFields() {
  return cachedFields;
}

/**
 * @param {GreetingField[]} fields
 * @returns {Promise<void>}
 */
export async function setGreetingFields(fields) {
  cachedFields = fields;
  await Preferences.set({ key: STORAGE_KEY_FIELDS, value: JSON.stringify(fields) });
}
