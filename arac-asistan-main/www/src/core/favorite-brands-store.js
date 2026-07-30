/**
 * favorite-brands-store.js
 * ---------------------------------------------------------------------------
 * Kullanıcının favori akaryakıt markalarını (ör. hep Opet'e gidiyorsa) kalıcı
 * olarak saklar. Yakıt fiyat listesinde bu markalar en üstte gösterilir.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError } from './logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_favorite_fuel_brands';

/** @type {string[]} */
let favorites = [];

/**
 * Kayıtlı favori markaları yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<string[]>}
 */
export async function initFavoriteBrandsStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    favorites = value ? JSON.parse(value) : [];
  } catch (error) {
    logError('favorite-brands-store', 'Favori markalar okunamadı', error);
    favorites = [];
  }
  return favorites;
}

/**
 * @returns {string[]}
 */
export function getFavoriteBrands() {
  return [...favorites];
}

/**
 * @param {string} brand
 * @returns {boolean}
 */
export function isFavoriteBrand(brand) {
  return favorites.some((b) => b.toLocaleLowerCase('tr') === brand.toLocaleLowerCase('tr'));
}

/**
 * Bir markayı favorilere ekler/çıkarır.
 * @param {string} brand
 * @returns {Promise<void>}
 */
export async function toggleFavoriteBrand(brand) {
  if (isFavoriteBrand(brand)) {
    favorites = favorites.filter((b) => b.toLocaleLowerCase('tr') !== brand.toLocaleLowerCase('tr'));
  } else {
    favorites = [...favorites, brand];
  }
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(favorites) });
  } catch (error) {
    logError('favorite-brands-store', 'Favori markalar kaydedilemedi', error);
  }
}
