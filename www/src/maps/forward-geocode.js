/**
 * forward-geocode.js
 * ---------------------------------------------------------------------------
 * Bir adres/yer adı metnini (ör. "Elazığ Kültür Mahallesi") koordinatlara
 * çevirir - reverse-geocode.js'in TERSİ (koordinat -> il/ilçe yerine,
 * metin -> koordinat listesi).
 *
 * Nominatim'in `/search` uç noktasını kullanır - aynı istek "Yazarken
 * öneriler" (autocomplete) için de kullanılabilir, çağıran taraf
 * (ui/components/address-search-modal.js) kendi debounce'ını uygular
 * (Nominatim kullanım politikası: saniyede en fazla 1 istek).
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

/** @type {string} Nominatim halka açık arama uç noktası. */
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * @typedef {Object} AddressSuggestion
 * @property {string} label - Görüntülenecek tam adres metni.
 * @property {number} lat
 * @property {number} lon
 */

/**
 * Verilen metne uyan adres/yer önerilerini getirir - Türkiye ile sınırlı,
 * en alakalı sonuçlar önce gelir (Nominatim'in kendi sıralaması).
 * @param {string} query - En az 3 karakter olmalı (kısa sorgular çok gürültülü sonuç verir).
 * @param {number} [limit=5]
 * @returns {Promise<AddressSuggestion[]>}
 */
export async function searchAddress(query, limit = 5) {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  try {
    const url = `${NOMINATIM_SEARCH_ENDPOINT}?format=jsonv2&q=${encodeURIComponent(trimmed)}`
      + `&countrycodes=tr&limit=${limit}&accept-language=tr`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const results = await response.json();
    return results.map((r) => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));
  } catch (error) {
    logWarn('forward-geocode', `Adres araması başarısız: "${trimmed}"`, error);
    return [];
  }
}
