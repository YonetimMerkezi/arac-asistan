/**
 * average-speed-zone-finder.js
 * ---------------------------------------------------------------------------
 * Ortalama hız denetim koridorlarını OTOMATIK tespit eder - kullanıcının
 * giriş/çıkış koordinatlarını ve limiti ELLE girmesine gerek kalmadan.
 *
 * İKİ AYRI TESPİT YÖNTEMİ, sırayla denenir:
 *  1) RESMİ OSM ŞEMASI: `enforcement=average_speed` ilişkisi (relation) -
 *     giriş/çıkış kamera node'larını VE limiti doğrudan içerir. En güvenilir
 *     kaynak ama Türkiye'de haritalanma oranı düşük olabilir.
 *  2) SEZGİSEL EŞLEŞTİRME: speed-camera-service.js'in zaten bulduğu tekil
 *     sabit nokta kameralarından, AYNI YOL üzerinde makul bir mesafede
 *     (300m-20km) iki tanesini eşleştirir - gerçek dünyada çoğu ortalama
 *     hız sistemi tam olarak böyle iki ayrı kamera noktasıdır. Limit,
 *     aradaki yolun kendi `maxspeed` etiketinden (speed-limit-service.js
 *     ile aynı yöntem) okunur.
 *
 * Yöntem 2 KESİN DOĞRU DEĞİLDİR (iki alakasız kamera aynı yolda olabilir) -
 * bu yüzden yalnızca "aynı yol" ve "makul mesafe" koşulları sağlanınca
 * aday üretir; çağıran taraf (average-speed-corridor.js) bunu Plan A
 * gereği SESSİZCE kaydeder (kullanıcı onayı istenmez).
 * ---------------------------------------------------------------------------
 */

import { runOverpassQuery, buildNearestRoadQuery } from './overpass-client.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { logInfo, logWarn } from '../core/logger.js';

/** @type {number} İki kamera arası bu aralıkta değilse ortalama hız çifti sayılmaz (metre). */
const MIN_PAIR_DISTANCE_METERS = 300;
const MAX_PAIR_DISTANCE_METERS = 20000;

/**
 * @typedef {Object} DetectedZone
 * @property {string} name
 * @property {number} entryLat
 * @property {number} entryLon
 * @property {number} exitLat
 * @property {number} exitLon
 * @property {number} limitKmh
 */

/**
 * Verilen konum çevresinde RESMİ OSM ortalama hız ilişkisini arar.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<DetectedZone[]>}
 */
export async function findOfficialAverageSpeedZones(lat, lon, radiusMeters) {
  const query = `[out:json][timeout:10];relation["enforcement"="average_speed"](around:${radiusMeters},${lat},${lon});out body;>;out skel qt;`;
  const elements = await runOverpassQuery(query);

  const relations = elements.filter((el) => el.type === 'relation');
  const nodesById = new Map(elements.filter((el) => el.type === 'node').map((n) => [n.id, n]));

  /** @type {DetectedZone[]} */
  const zones = [];

  for (const relation of relations) {
    const deviceMembers = (relation.members ?? []).filter((m) => m.type === 'node' && (m.role === 'device' || m.role === 'from' || m.role === 'to'));
    const points = deviceMembers.map((m) => nodesById.get(m.ref)).filter(Boolean);
    const limitKmh = Number(relation.tags?.maxspeed);

    if (points.length >= 2 && Number.isFinite(limitKmh)) {
      zones.push({
        name: relation.tags?.name ?? 'Ortalama Hız Denetimi',
        entryLat: points[0].lat,
        entryLon: points[0].lon,
        exitLat: points[points.length - 1].lat,
        exitLon: points[points.length - 1].lon,
        limitKmh,
      });
    }
  }

  return zones;
}

/**
 * speed-camera-service.js'in önbelleğindeki tekil kamera noktalarından,
 * aynı yol üzerinde makul mesafedeki ikilileri eşleştirip aday koridor üretir.
 * @param {{lat: number, lon: number}[]} cameras
 * @returns {Promise<DetectedZone[]>}
 */
export async function findHeuristicZonesFromCameraPairs(cameras) {
  /** @type {DetectedZone[]} */
  const zones = [];

  for (let i = 0; i < cameras.length; i += 1) {
    for (let j = i + 1; j < cameras.length; j += 1) {
      const a = cameras[i];
      const b = cameras[j];
      const distanceMeters = haversineDistanceKm(a.lat, a.lon, b.lat, b.lon) * 1000;

      if (distanceMeters < MIN_PAIR_DISTANCE_METERS || distanceMeters > MAX_PAIR_DISTANCE_METERS) continue;

      const midLat = (a.lat + b.lat) / 2;
      const midLon = (a.lon + b.lon) / 2;

      try {
        const limitKmh = await queryRoadMaxspeedNear(midLat, midLon);
        if (!limitKmh) continue; // Yol limiti bulunamadıysa güvenilir bir koridor kuramayız.

        zones.push({
          name: `Otomatik Tespit (${Math.round(distanceMeters / 1000 * 10) / 10} km)`,
          entryLat: a.lat,
          entryLon: a.lon,
          exitLat: b.lat,
          exitLon: b.lon,
          limitKmh,
        });
      } catch (error) {
        logWarn('average-speed-zone-finder', 'Yol limiti sorgulanamadı', error);
      }
    }
  }

  return zones;
}

/**
 * Verilen noktaya en yakın yolun hız limitini SORAR - speed-limit-service.js'in
 * DURUMSUZ (stateless) bir versiyonudur. O modül, aracın O ANKİ konumu için
 * paylaşılan bir önbellek tutar (speed-warning.js'in canlı hız-aşımı uyarısı
 * buna dayanır) - bu modül FARKLI (uzak, geçmiş kamera noktaları arası) bir
 * konum için sorgu yaptığından o paylaşılan önbelleği KULLANMAMALI/BOZMAMALI;
 * bu yüzden kendi bağımsız, durumsuz sorgusunu yapar.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<number|null>}
 */
async function queryRoadMaxspeedNear(lat, lon) {
  const elements = await runOverpassQuery(buildNearestRoadQuery(lat, lon, 60));
  const withMaxspeed = elements.find((el) => el.tags?.maxspeed);
  if (!withMaxspeed) return null;

  const numericMatch = withMaxspeed.tags.maxspeed.match(/(\d+)/);
  if (!numericMatch) return null;

  const value = parseInt(numericMatch[1], 10);
  return withMaxspeed.tags.maxspeed.includes('mph') ? Math.round(value * 1.60934) : value;
}

/**
 * Her iki yöntemi de dener (önce resmi ilişki, sonra sezgisel eşleştirme) ve
 * birleşik aday listesini döndürür.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @param {{lat: number, lon: number}[]} cachedCameras
 * @returns {Promise<DetectedZone[]>}
 */
export async function findAverageSpeedZones(lat, lon, radiusMeters, cachedCameras) {
  const official = await findOfficialAverageSpeedZones(lat, lon, radiusMeters);
  if (official.length > 0) {
    logInfo('average-speed-zone-finder', `${official.length} resmi OSM koridoru bulundu`);
    return official;
  }

  const heuristic = await findHeuristicZonesFromCameraPairs(cachedCameras);
  if (heuristic.length > 0) {
    logInfo('average-speed-zone-finder', `${heuristic.length} sezgisel (kamera çifti) koridor adayı bulundu`);
  }
  return heuristic;
}
