/**
 * route-service.js
 * ---------------------------------------------------------------------------
 * İki nokta arasında araç rotası hesaplar.
 *
 * OSRM'in halka açık demo sunucusunu kullanır (project.osrm.org). Bu bir
 * ücretsiz/topluluk servisidir - üretimde yoğun kullanım için kendi OSRM
 * sunucusu barındırmak gerekebilir (bkz. PLAN.md notu). "Beni eve götür"
 * gibi komutlar bu servisi kullanır.
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

/** @type {string} OSRM halka açık sunucusu (yalnızca "driving" profili). */
const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

/**
 * @typedef {Object} RouteResult
 * @property {[number, number][]} coordinates - [lat, lon] çiftleri (Leaflet formatında).
 * @property {number} distanceKm
 * @property {number} durationMinutes
 */

/**
 * İki nokta arasında sürüş rotası getirir.
 * @param {{lat: number, lon: number}} from
 * @param {{lat: number, lon: number}} to
 * @returns {Promise<RouteResult|null>}
 */
export async function getDrivingRoute(from, to) {
  const url = `${OSRM_ENDPOINT}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logWarn('route-service', `OSRM yanıtı başarısız: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const route = data.routes?.[0];
    if (!route) return null;

    return {
      // GeoJSON [lon, lat] sırasındadır - Leaflet [lat, lon] bekler, çeviriyoruz.
      coordinates: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      distanceKm: route.distance / 1000,
      durationMinutes: route.duration / 60,
    };
  } catch (error) {
    logWarn('route-service', 'Rota alınamadı (muhtemelen internet yok)', error);
    return null;
  }
}
