/**
 * speed-limit-service.js
 * ---------------------------------------------------------------------------
 * Aracın bulunduğu yolun hız limitini OpenStreetMap verisinden okur.
 *
 * Konum çok sık değiştiği için HER konum güncellemesinde Overpass'e sorgu
 * atmak hem gereksiz ağ trafiği yaratır hem servisi yorar - bu yüzden
 * yalnızca belirli bir mesafe (MIN_QUERY_DISTANCE_METERS) kat edildiğinde
 * veya belirli bir süre geçtiğinde yeniden sorgulanır.
 * ---------------------------------------------------------------------------
 */

import { runOverpassQuery, buildNearestRoadQuery } from './overpass-client.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { logInfo } from '../core/logger.js';

/** @type {number} İki sorgu arasında araç en az bu kadar (metre) yol almalı. */
const MIN_QUERY_DISTANCE_METERS = 300;

/** @type {number} İki sorgu arasında en az bu kadar süre (ms) geçmeli. */
const MIN_QUERY_INTERVAL_MS = 20000;

/** @type {{lat: number, lon: number, at: number}|null} */
let lastQueryLocation = null;

/** @type {number|null} Son bilinen hız limiti (km/h), bulunamadıysa null. */
let lastKnownLimit = null;

/**
 * Verilen konum için güncel hız limitini döndürür. Gerekirse Overpass'e
 * sorgu atar, gerekmiyorsa (yeterince yakınsa/yeniyse) önbellekten döner.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<number|null>} km/h cinsinden hız limiti, bulunamazsa null.
 */
export async function getSpeedLimitNear(lat, lon) {
  const now = Date.now();
  const shouldQuery = !lastQueryLocation
    || now - lastQueryLocation.at > MIN_QUERY_INTERVAL_MS
    || haversineDistanceKm(lastQueryLocation.lat, lastQueryLocation.lon, lat, lon) * 1000 > MIN_QUERY_DISTANCE_METERS;

  if (!shouldQuery) {
    return lastKnownLimit;
  }

  lastQueryLocation = { lat, lon, at: now };

  const elements = await runOverpassQuery(buildNearestRoadQuery(lat, lon, 60));
  const withMaxspeed = elements.find((el) => el.tags?.maxspeed);

  if (!withMaxspeed) {
    lastKnownLimit = null;
    return null;
  }

  const parsed = parseMaxspeedTag(withMaxspeed.tags.maxspeed);
  lastKnownLimit = parsed;
  if (parsed) {
    logInfo('speed-limit-service', `Hız limiti güncellendi: ${parsed} km/h`);
  }
  return parsed;
}

/**
 * OSM'nin "maxspeed" etiketini (ör. "50", "50 mph", "TR:urban") km/h'ye çevirir.
 * @param {string} tagValue
 * @returns {number|null}
 */
function parseMaxspeedTag(tagValue) {
  const numericMatch = tagValue.match(/(\d+)/);
  if (!numericMatch) return null;

  const value = parseInt(numericMatch[1], 10);
  return tagValue.includes('mph') ? Math.round(value * 1.60934) : value;
}
