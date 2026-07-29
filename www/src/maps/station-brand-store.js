/**
 * station-brand-store.js
 * ---------------------------------------------------------------------------
 * OpenStreetMap'te "brand" etiketi eksik/belirsiz olan akaryakıt
 * istasyonları için kullanıcının haritadan ELLE atadığı marka eşlemesini
 * (OSM node id -> marka adı) kalıcı olarak saklar.
 *
 * Bu, poi-search.js'in döndürdüğü OSM verisini DEĞİŞTİRMEZ (salt okunur dış
 * kaynak) - yalnızca "bu id için kullanıcı şu markayı seçti" bilgisini ayrı
 * bir katmanda tutar. navigation-view.js, işaretçi/liste/fiyat eşleşmesi
 * yaparken önce buraya bakar, yoksa OSM'in kendi brand etiketine düşer.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError } from '../core/logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_station_brand_overrides';

/** @type {Record<string, string>} OSM node id (string) -> marka adı. */
let overrides = {};

/**
 * Kayıtlı eşlemeleri yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function initStationBrandStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    overrides = value ? JSON.parse(value) : {};
  } catch (error) {
    logError('station-brand-store', 'İstasyon marka eşlemeleri okunamadı', error);
    overrides = {};
  }
}

/**
 * Verilen istasyon için kullanıcının elle atadığı markayı döndürür (yoksa null).
 * @param {number|string} stationId - poi-search.js'ten gelen OSM node id.
 * @returns {string|null}
 */
export function getAssignedBrand(stationId) {
  return overrides[String(stationId)] ?? null;
}

/**
 * Bir istasyona marka atar (veya boş geçilirse ataması kaldırır) ve kalıcı olarak saklar.
 * @param {number|string} stationId
 * @param {string|null} brandName
 * @returns {Promise<void>}
 */
export async function assignBrand(stationId, brandName) {
  const id = String(stationId);
  if (brandName) {
    overrides = { ...overrides, [id]: brandName };
  } else {
    const { [id]: _removed, ...rest } = overrides;
    overrides = rest;
  }
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(overrides) });
  } catch (error) {
    logError('station-brand-store', 'İstasyon marka ataması kaydedilemedi', error);
  }
}
