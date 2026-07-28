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

/**
 * @type {string[]} Overpass halka açık ayna sunucuları, sırayla denenir.
 * TEK NEDENİ: overpass-api.de (birincil, resmi) yoğun saatlerde zaman
 * aşımına uğrayabiliyor/504 dönebiliyor - bu durumda sessizce "sonuç yok"
 * gibi görünüyordu, halbuki asıl sorun sunucuya ulaşılamamasıydı. Birden
 * fazla ayna denemek bu tek-sunucu kesintisini büyük ölçüde tolere eder.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

/** @type {number} İstek zaman aşımı (ms), her ayna için ayrı ayrı uygulanır. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Verilen Overpass QL sorgusunu çalıştırır - birincil sunucu başarısız
 * olursa (zaman aşımı, 5xx, ağ hatası) sırayla yedek aynaları dener.
 * @param {string} query - Overpass QL gövdesi (örn. "[out:json];node(...);out;").
 * @returns {Promise<Array<Object>>} `elements` dizisi; TÜM aynalar
 *   başarısız olursa boş dizi (bu durumda gerçekten "sonuç yok" ile
 *   "sunucuya ulaşılamadı" ayrımı yapılamaz - çağıran taraf isterse
 *   kullanıcıya "tekrar dene" önerebilir).
 */
export async function runOverpassQuery(query) {
  const attempts = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });

      if (!response.ok) {
        attempts.push(`${endpoint}: HTTP ${response.status}`);
        logWarn('overpass-client', `${endpoint} başarısız: HTTP ${response.status}, sıradaki ayna deneniyor`);
        continue;
      }

      const data = await response.json();
      const count = data.elements?.length ?? 0;
      // GEÇİCİ TEŞHİS: cihazda gerçekte ne olduğunu doğrudan göster.
      window.alert(`[Teşhis] Overpass başarılı: ${endpoint}\nSonuç sayısı: ${count}`);
      return data.elements ?? [];
    } catch (error) {
      attempts.push(`${endpoint}: ${error?.name ?? 'Hata'} - ${error?.message ?? error}`);
      logWarn('overpass-client', `${endpoint} sorgusu başarısız, sıradaki ayna deneniyor`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  logWarn('overpass-client', 'Tüm Overpass aynaları başarısız oldu');
  // GEÇİCİ TEŞHİS: tüm denemelerin gerçek hata mesajlarını doğrudan göster.
  window.alert(`[Teşhis] Tüm Overpass aynaları başarısız:\n${attempts.join('\n')}`);
  return [];
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
