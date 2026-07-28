/**
 * fuel-station-cache.js
 * ---------------------------------------------------------------------------
 * Yakındaki akaryakıt istasyonlarını VE bölgenin güncel fiyat listesini
 * uygulama açılışında bir kez, ardından belirli aralıklarla arka planda
 * çekip BELLEKTE tutar. Harita ve Yakıt ekranları artık her dokunuşta canlı
 * ağ isteği beklemek yerine bu önbellekten ANINDA okur - "istasyonları çok
 * geç buluyor" şikayetinin çözümü budur.
 *
 * Konum önemli ölçüde değiştiğinde (>3km) veya periyodik aralıkta (15 dk)
 * kendini tazeler.
 * ---------------------------------------------------------------------------
 */

import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { findNearbyPoi } from './poi-search.js';
import { reverseGeocodeIlIlce } from './reverse-geocode.js';
import { getFuelPrices } from './fuel-price-service.js';
import { logInfo, logWarn } from '../core/logger.js';

/** @type {number} Periyodik tazeleme aralığı (ms). */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 dakika

/** @type {number} Bu mesafeden (km) fazla hareket edilirse süre dolmadan da tazelenir. */
const REFRESH_DISTANCE_KM = 3;

/**
 * @typedef {Object} FuelStationCache
 * @property {import('./poi-search.js').PoiResult[]} stations
 * @property {import('./fuel-price-service.js').FuelStationPrice[]} prices
 * @property {{il: string, ilce: string}|null} location
 * @property {number} fetchedAt - Date.now()
 * @property {{lat: number, lon: number}|null} fetchedForPosition
 */

/** @type {FuelStationCache} */
let cache = { stations: [], prices: [], location: null, fetchedAt: 0, fetchedForPosition: null };

/** @type {Set<(cache: FuelStationCache) => void>} */
const listeners = new Set();

/** @type {boolean} */
let refreshInProgress = false;

/**
 * Önbelleği başlatır: konum geldiğinde ilk çekimi yapar, sonra periyodik
 * tazelemeyi kurar. Uygulama açılışında bir kez çağrılmalıdır.
 */
export function initFuelStationCache() {
  const last = getLastPosition();
  if (last) void refresh(last.latitude, last.longitude);

  onPosition((position) => {
    if (!cache.fetchedForPosition) {
      void refresh(position.latitude, position.longitude);
      return;
    }
    const movedKm = haversineKm(
      cache.fetchedForPosition.lat, cache.fetchedForPosition.lon,
      position.latitude, position.longitude,
    );
    if (movedKm > REFRESH_DISTANCE_KM) {
      void refresh(position.latitude, position.longitude);
    }
  });

  setInterval(() => {
    const current = getLastPosition();
    if (current) void refresh(current.latitude, current.longitude);
  }, REFRESH_INTERVAL_MS);
}

/**
 * @returns {FuelStationCache}
 */
export function getFuelStationCache() {
  return { ...cache };
}

/**
 * Önbellek her tazelendiğinde çağrılacak dinleyici ekler.
 * @param {(cache: FuelStationCache) => void} callback
 * @returns {() => void}
 */
export function onFuelStationCacheUpdate(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Önbelleği hemen (bekleme aralığını yoksayarak) tazelemeye zorlar - ör.
 * kullanıcı Harita ekranında elle "yenile" isterse kullanılabilir.
 * @returns {Promise<void>}
 */
export async function forceRefreshFuelStationCache() {
  const current = getLastPosition();
  if (current) await refresh(current.latitude, current.longitude);
}

/**
 * @param {number} lat
 * @param {number} lon
 */
async function refresh(lat, lon) {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    let stations = await findNearbyPoi('fuel', lat, lon, 7000);
    if (stations.length === 0) {
      stations = await findNearbyPoi('fuel', lat, lon, 20000);
    }

    const location = await reverseGeocodeIlIlce(lat, lon);
    const prices = location ? await getFuelPrices(location.il, location.ilce, lon) : [];

    cache = {
      stations,
      prices,
      location,
      fetchedAt: Date.now(),
      fetchedForPosition: { lat, lon },
    };

    logInfo('fuel-station-cache', `Önbellek tazelendi: ${stations.length} istasyon, ${prices.length} fiyat kaydı`);
    for (const listener of listeners) listener(getFuelStationCache());
  } catch (error) {
    logWarn('fuel-station-cache', 'Önbellek tazeleme başarısız', error);
  } finally {
    refreshInProgress = false;
  }
}

/**
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
