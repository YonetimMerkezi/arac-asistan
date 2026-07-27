/**
 * overpass-client.js
 * ---------------------------------------------------------------------------
 * OpenStreetMap Overpass API için ortak sorgu istemcisi.
 *
 * speed-limit-service.js, speed-camera-service.js ve poi-search.js hepsi
 * "konuma yakın belirli etiketli öğeleri getir" ihtiyacını paylaşır - bu
 * dosya o tekrarı tek noktada toplar (kod tekrarından kaçınma ilkesi).
 *
 * Overpass halka açık, ücretsiz bir servistir; bu nedenle navigasyon
 * özellikleri (spesifikasyonda belirtildiği gibi) İNTERNET GEREKTİRİR -
 * OBD/gösterge panosu özellikleri ise offline çalışmaya devam eder.
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

/** @type {string} Overpass genel sunucu uç noktası. */
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** @type {number} İstek zaman aşımı (ms). */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Verilen Overpass QL sorgusunu çalıştırır.
 * @param {string} query - Overpass QL gövdesi (örn. "[out:json];node(...);out;").
 * @returns {Promise<Array<Object>>} `elements` dizisi, hata durumunda boş dizi.
 */
export async function runOverpassQuery(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });

    if (!response.ok) {
      logWarn('overpass-client', `Overpass yanıtı başarısız: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.elements ?? [];
  } catch (error) {
    // Ağ yokken (offline) bu beklenen bir durumdur - OBD özellikleri
    // etkilenmeden çalışmaya devam etmeli, bu yüzden warn seviyesinde kalır.
    logWarn('overpass-client', 'Overpass sorgusu başarısız (muhtemelen internet yok)', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Bir merkez nokta etrafında yarıçap (metre) içinde belirli bir etiket
 * eşleşmesine sahip node'ları getiren yaygın sorgu kalıbını oluşturur.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @param {string} tagFilter - Overpass etiket filtresi, ör. `"highway"="speed_camera"`.
 * @returns {string}
 */
export function buildRadiusNodeQuery(lat, lon, radiusMeters, tagFilter) {
  return `[out:json][timeout:8];node[${tagFilter}](around:${radiusMeters},${lat},${lon});out;`;
}

/**
 * Bir merkez nokta etrafındaki en yakın "way" (yol) üzerindeki bir etiketi
 * (ör. maxspeed) getiren sorguyu oluşturur.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {string}
 */
export function buildNearestRoadQuery(lat, lon, radiusMeters) {
  return `[out:json][timeout:8];way[highway][maxspeed](around:${radiusMeters},${lat},${lon});out tags 5;`;
}
