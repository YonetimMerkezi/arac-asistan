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
 * TEK NEDENİ: overpass-api.de (birincil, resmi) Nisan 2026'dan beri
 * belgelenmiş, süregelen bir aşırı yük/kötüye kullanım sorunu yaşıyor
 * (bkz. wiki.openstreetmap.org/wiki/Overpass_API/status) - bu bizim
 * kodumuzdan bağımsız, servisin kendi güvenilirlik sorunu. Birden fazla
 * ayna denemek bu kesintiyi büyük ölçüde tolere eder.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** @type {number} İstek zaman aşımı (ms), her ayna için ayrı ayrı uygulanır. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * @type {string} Sedat'ın POI proxy worker adresi. Boş bırakılırsa (henüz
 * deploy edilmediyse) doğrudan Overpass aynalarına düşülür.
 */
const POI_WORKER_ENDPOINT = 'https://istasyon.sedonet23.workers.dev/';

/**
 * Bir merkez nokta etrafında belirli bir etikete sahip node'ları getirir.
 * ÖNCE Sedat'ın Cloudflare Worker'ını dener (telefon ağından doğrudan
 * Overpass'a erişimin bazı ağlarda başarısız olduğu gözlemlendi - worker
 * isteği Cloudflare'in sunucusundan yaparak bunu atlar). Worker
 * başarısız olursa (henüz deploy edilmemiş, kendi hatası vb.) doğrudan
 * Overpass aynalarına düşer.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @param {string} tagKey - ör. "amenity"
 * @param {string} tagValue - ör. "fuel"
 * @returns {Promise<Array<{id:number, lat:number, lon:number, name:string|null, brand:string|null}>>}
 */
export async function queryNearbyTaggedNodes(lat, lon, radiusMeters, tagKey, tagValue) {
  try {
    const url = `${POI_WORKER_ENDPOINT}?lat=${lat}&lon=${lon}&radius=${radiusMeters}&tag=${tagKey}=${tagValue}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.success) return data.elements ?? [];
    }
    logWarn('overpass-client', 'POI worker başarısız, doğrudan Overpass aynalarına düşülüyor');
  } catch (error) {
    logWarn('overpass-client', 'POI worker\'a ulaşılamadı, doğrudan Overpass aynalarına düşülüyor', error);
  }

  // Yedek: worker yoksa/başarısızsa doğrudan Overpass aynalarını dene.
  const elements = await runOverpassQuery(buildRadiusNodeQuery(lat, lon, radiusMeters, `"${tagKey}"="${tagValue}"`));
  return elements.map((el) => ({
    id: el.id,
    lat: el.lat,
    lon: el.lon,
    name: el.tags?.name ?? null,
    brand: el.tags?.brand ?? null,
  }));
}

/**
 * Verilen Overpass QL sorgusunu çalıştırır - birincil sunucu başarısız
 * olursa (zaman aşımı, 5xx, ağ hatası) sırayla yedek aynaları dener.
 * @param {string} query - Overpass QL gövdesi (örn. "[out:json];node(...);out;").
 * @returns {Promise<Array<Object>>} `elements` dizisi; TÜM aynalar
 *   başarısız olursa boş dizi.
 */
export async function runOverpassQuery(query) {
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
        logWarn('overpass-client', `${endpoint} başarısız: HTTP ${response.status}, sıradaki ayna deneniyor`);
        continue;
      }

      const data = await response.json();
      return data.elements ?? [];
    } catch (error) {
      // Ağ yokken (offline) bu beklenen bir durumdur - OBD özellikleri
      // etkilenmeden çalışmaya devam etmeli, bu yüzden warn seviyesinde kalır.
      logWarn('overpass-client', `${endpoint} sorgusu başarısız, sıradaki ayna deneniyor`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  logWarn('overpass-client', 'Tüm Overpass aynaları başarısız oldu (bilinen dış servis kesintisi olabilir)');
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
 * Verilen dikdörtgen (bbox) sınırları içindeki, belirli etikete sahip TÜM
 * node'ları getiren sorguyu oluşturur - offline-region-download.js'in
 * "bölge indir" özelliği bunu kullanır (tek bir yarıçap yerine, indirilen
 * harita karolarıyla AYNI dikdörtgen alan taranır).
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {string} tagFilter - Overpass etiket filtresi, ör. `"amenity"="fuel"`.
 * @returns {string}
 */
export function buildBboxNodeQuery(bbox, tagFilter) {
  return `[out:json][timeout:25];node[${tagFilter}](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out;`;
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
