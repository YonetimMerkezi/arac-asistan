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
 *
 * AYRICA: akaryakıt firmalarının (dağıtıcı) hangi LPG sağlayıcısını
 * kullandığı bilgisinin kullanıcı ELLE düzeltmesini de burada saklar
 * (firma adı -> LPG sağlayıcı adı). Bu, istasyon bazlı DEĞİL, FİRMA bazlı
 * bir eşlemedir (ör. "Total" -> "Milangaz") - bu yüzden anahtar OSM node id
 * değil, dağıtıcı adının kendisidir. fuel-price-service.js'teki
 * DEFAULT_LPG_PROVIDERS varsayılan tabloyla aynı mantığa paralel çalışır:
 * kullanıcı burada özelleştirmişse o, yoksa varsayılan kullanılır.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError } from '../core/logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_station_brand_overrides';

/** @type {string} */
const LPG_PROVIDER_STORAGE_KEY = 'sda_lpg_provider_overrides';

/** @type {Record<string, string>} OSM node id (string) -> marka adı. */
let overrides = {};

/** @type {Record<string, string>} Dağıtıcı adı -> kullanıcının elle girdiği LPG sağlayıcı adı. */
let lpgProviderOverrides = {};

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

  try {
    const { value } = await Preferences.get({ key: LPG_PROVIDER_STORAGE_KEY });
    lpgProviderOverrides = value ? JSON.parse(value) : {};
  } catch (error) {
    logError('station-brand-store', 'LPG sağlayıcı eşlemeleri okunamadı', error);
    lpgProviderOverrides = {};
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

/**
 * Kullanıcının bir akaryakıt firması (dağıtıcı) için elle girdiği LPG
 * sağlayıcısını döndürür (yoksa null - bu durumda çağıran taraf
 * fuel-price-service.js'teki varsayılan tabloya düşmelidir).
 * @param {string} brandName - Dağıtıcı adı (ör. "Total", "Opet").
 * @returns {string|null}
 */
export function getAssignedLpgProvider(brandName) {
  if (!brandName) return null;
  return lpgProviderOverrides[normalizeBrandForKey(brandName)] ?? null;
}

/**
 * Bir firma için LPG sağlayıcısını elle atar (veya boş geçilirse
 * ataması kaldırılıp varsayılana dönülür) ve kalıcı olarak saklar.
 * @param {string} brandName
 * @param {string|null} providerName
 * @returns {Promise<void>}
 */
export async function assignLpgProvider(brandName, providerName) {
  if (!brandName) return;
  const key = normalizeBrandForKey(brandName);
  if (providerName) {
    lpgProviderOverrides = { ...lpgProviderOverrides, [key]: providerName };
  } else {
    const { [key]: _removed, ...rest } = lpgProviderOverrides;
    lpgProviderOverrides = rest;
  }
  try {
    await Preferences.set({ key: LPG_PROVIDER_STORAGE_KEY, value: JSON.stringify(lpgProviderOverrides) });
  } catch (error) {
    logError('station-brand-store', 'LPG sağlayıcı ataması kaydedilemedi', error);
  }
}

/**
 * Dağıtıcı adını LPG sağlayıcı eşleme anahtarı için normalize eder
 * (büyük/küçük harf ve baştaki/sondaki boşluk farkları aynı firmayı farklı
 * anahtar altında saklamasın diye).
 * @param {string} brandName
 * @returns {string}
 */
function normalizeBrandForKey(brandName) {
  return brandName.trim().toLocaleLowerCase('tr');
}
