/**
 * reverse-geocode.js
 * ---------------------------------------------------------------------------
 * Bir GPS koordinatını (enlem/boylam) Türkiye il/ilçe adına çevirir.
 *
 * ÖNCE Sedat'ın Cloudflare Worker'ını dener (aynı worker Overpass POI
 * aramasını da yapıyor) - telefon ağından Nominatim'e DOĞRUDAN erişimin
 * bazı ağlarda başarısız olduğu gözlemlendi (Overpass'ta yaşanan sorunun
 * aynısı). Worker başarısız olursa doğrudan Nominatim'e düşer.
 *
 * ÖNEMLİ (Nominatim kullanım politikası): saniyede en fazla 1 istek. Bu
 * yüzden sonuç KONUM ÖNEMLİ ÖLÇÜDE DEĞİŞMEDİKÇE önbellekte tutulur - her
 * GPS güncellemesinde tekrar sorgulanmaz.
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

/** @type {string} Sedat'ın POI/coğrafi kodlama proxy worker adresi. */
const POI_WORKER_ENDPOINT = 'https://istasyon.sedonet23.workers.dev/';

/** @type {string} Nominatim halka açık sunucu adresi (yedek yol). */
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

/** @type {number} Önbelleği geçersiz kılmak için gereken asgari konum değişimi (km). */
const CACHE_INVALIDATE_DISTANCE_KM = 15;

/**
 * @typedef {Object} IlIlce
 * @property {string} il
 * @property {string} ilce
 */

/** @type {{lat: number, lon: number, result: IlIlce}|null} */
let cache = null;

/**
 * Verilen koordinat için il/ilçe adını döndürür. Önbellekteki son sorgu
 * konuma yakınsa (CACHE_INVALIDATE_DISTANCE_KM içinde) tekrar ağ isteği
 * ATMAZ, önbellekten döner.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<IlIlce|null>}
 */
export async function reverseGeocodeIlIlce(lat, lon) {
  if (cache && haversineKm(cache.lat, cache.lon, lat, lon) < CACHE_INVALIDATE_DISTANCE_KM) {
    return cache.result;
  }

  const viaWorker = await tryWorkerReverseGeocode(lat, lon);
  if (viaWorker) {
    cache = { lat, lon, result: viaWorker };
    return viaWorker;
  }

  const viaDirect = await tryDirectNominatim(lat, lon);
  if (viaDirect) {
    cache = { lat, lon, result: viaDirect };
    return viaDirect;
  }

  return null;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<IlIlce|null>}
 */
async function tryWorkerReverseGeocode(lat, lon) {
  try {
    const url = `${POI_WORKER_ENDPOINT}?reverse=1&lat=${lat}&lon=${lon}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.success || !data.il || !data.ilce) return null;

    return { il: data.il, ilce: data.ilce };
  } catch (error) {
    logWarn('reverse-geocode', 'Worker üzerinden coğrafi kodlama başarısız, doğrudan Nominatim deneniyor', error);
    return null;
  }
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<IlIlce|null>}
 */
async function tryDirectNominatim(lat, lon) {
  try {
    const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=tr`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const address = data.address ?? {};

    // Nominatim, Türkiye il/ilçe alan adlarını duruma göre farklı
    // anahtarlarda döndürebiliyor - hepsini sırayla dener.
    const il = address.province ?? address.state ?? null;
    const ilce = address.county ?? address.town ?? address.city_district ?? address.district ?? null;

    if (!il || !ilce) {
      logWarn('reverse-geocode', 'İl/ilçe alanları bulunamadı', address);
      return null;
    }

    return { il, ilce };
  } catch (error) {
    logWarn('reverse-geocode', 'Doğrudan Nominatim coğrafi kodlaması başarısız', error);
    return null;
  }
}

/**
 * İki koordinat arasındaki büyük daire mesafesini (km) hesaplar.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
