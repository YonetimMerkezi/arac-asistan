/**
 * favorites-store.js
 * ---------------------------------------------------------------------------
 * Ev/İş ve genel favori konumların kalıcı deposu.
 *
 * Sesli komutlar ("beni eve götür") ve navigasyon ekranındaki hızlı
 * erişim düğmeleri bu depoyu kullanır. Konumlar Capacitor Preferences'ta
 * saklanır (SQLite gerektirmeyecek kadar küçük bir veri kümesi).
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError, logInfo } from '../core/logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_favorite_locations';

/**
 * @typedef {Object} FavoriteLocation
 * @property {string} id - "home" | "work" | rastgele üretilmiş kimlik.
 * @property {string} label
 * @property {number} lat
 * @property {number} lon
 */

/** @type {FavoriteLocation[]} */
let cache = [];

/** @type {boolean} */
let loaded = false;

/**
 * Depoyu yükler (uygulama açılışında bir kez çağrılmalıdır).
 * @returns {Promise<void>}
 */
export async function initFavoritesStore() {
  if (loaded) return;
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    cache = value ? JSON.parse(value) : [];
    loaded = true;
    logInfo('favorites-store', `${cache.length} favori konum yüklendi`);
  } catch (error) {
    logError('favorites-store', 'Favoriler okunamadı', error);
    cache = [];
    loaded = true;
  }
}

/**
 * Bir favori konumu ekler veya (aynı id varsa) günceller.
 * @param {FavoriteLocation} location
 * @returns {Promise<void>}
 */
export async function setFavoriteLocation(location) {
  cache = cache.filter((f) => f.id !== location.id);
  cache.push(location);
  await persist();
}

/**
 * Belirli bir id'ye sahip favori konumu döndürür (ör. "home").
 * @param {string} id
 * @returns {FavoriteLocation|null}
 */
export function getFavoriteLocation(id) {
  return cache.find((f) => f.id === id) ?? null;
}

/**
 * Tüm favori konumları döndürür.
 * @returns {FavoriteLocation[]}
 */
export function listFavoriteLocations() {
  return [...cache];
}

/**
 * Bir favori konumu siler.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeFavoriteLocation(id) {
  cache = cache.filter((f) => f.id !== id);
  await persist();
}

/**
 * @returns {Promise<void>}
 */
async function persist() {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(cache) });
  } catch (error) {
    logError('favorites-store', 'Favoriler kaydedilemedi', error);
  }
}
