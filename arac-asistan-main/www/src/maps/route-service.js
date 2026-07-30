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
 * @typedef {Object} RouteStep
 * @property {string} instruction - Türkçeye çevrilmiş kısa yön talimatı (ör. "Sağa dönün").
 * @property {number} distanceMeters - Bu adımın kapladığı mesafe.
 * @property {[number, number]} location - [lat, lon] - talimatın uygulanacağı nokta.
 */

/**
 * @typedef {Object} RouteResult
 * @property {[number, number][]} coordinates - [lat, lon] çiftleri (Leaflet formatında).
 * @property {number} distanceKm
 * @property {number} durationMinutes
 * @property {RouteStep[]} steps - Sesli yönlendirme için dönüş talimatları.
 */

/**
 * Birden fazla nokta (ör. haritaya dokunularak eklenen duraklar) üzerinden
 * SIRAYLA geçen tek bir rota getirir. Alternatifler istenmez (OSRM, 2'den
 * fazla nokta olunca alternatifleri güvenilir desteklemiyor).
 * @param {{lat: number, lon: number}[]} waypoints - En az 2 nokta gerekir.
 * @returns {Promise<RouteResult|null>}
 */
export async function getMultiPointRoute(waypoints) {
  if (waypoints.length < 2) return null;

  const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(';');
  const url = `${OSRM_ENDPOINT}/${coords}?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logWarn('route-service', `OSRM (çok noktalı) yanıtı başarısız: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const route = data.routes?.[0];
    if (!route) return null;

    return parseRoute(route);
  } catch (error) {
    logWarn('route-service', 'Çok noktalı rota alınamadı (muhtemelen internet yok)', error);
    return null;
  }
}

/**
 * İki nokta arasında sürüş rotası (ve varsa alternatifleri) getirir.
 * @param {{lat: number, lon: number}} from
 * @param {{lat: number, lon: number}} to
 * @returns {Promise<RouteResult[]|null>} İlk eleman EN İYİ rota - boşsa null.
 */
export async function getDrivingRoute(from, to) {
  const url = `${OSRM_ENDPOINT}/${from.lon},${from.lat};${to.lon},${to.lat}`
    + '?overview=full&geometries=geojson&alternatives=true&steps=true';

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logWarn('route-service', `OSRM yanıtı başarısız: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const routes = data.routes ?? [];
    if (routes.length === 0) return null;

    return routes.map(parseRoute);
  } catch (error) {
    logWarn('route-service', 'Rota alınamadı (muhtemelen internet yok)', error);
    return null;
  }
}

/**
 * OSRM'in tek bir rota nesnesini uygulamanın kullandığı biçime çevirir.
 * @param {Object} osrmRoute
 * @returns {RouteResult}
 */
function parseRoute(osrmRoute) {
  const steps = (osrmRoute.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .map((step) => ({
      instruction: translateManeuver(step.maneuver),
      distanceMeters: step.distance,
      location: [step.maneuver.location[1], step.maneuver.location[0]],
    }))
    .filter((step) => step.instruction !== null);

  return {
    // GeoJSON [lon, lat] sırasındadır - Leaflet [lat, lon] bekler, çeviriyoruz.
    coordinates: osrmRoute.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distanceKm: osrmRoute.distance / 1000,
    durationMinutes: osrmRoute.duration / 60,
    steps,
  };
}

/** @type {Record<string, string>} OSRM manevra tipi -> Türkçe fiil. */
const MANEUVER_VERBS = {
  turn: 'dönün',
  'new name': 'yolda devam edin',
  depart: 'yola çıkın',
  arrive: 'hedefe ulaştınız',
  merge: 'yola katılın',
  'on ramp': 'rampaya girin',
  'off ramp': 'rampadan çıkın',
  fork: 'ayrımda ilerleyin',
  'end of road': 'yol sonunda dönün',
  roundabout: 'kavşağa girin',
  rotary: 'kavşağa girin',
  continue: 'devam edin',
};

/** @type {Record<string, string>} OSRM yön (modifier) -> Türkçe. */
const MANEUVER_DIRECTIONS = {
  left: 'sola',
  right: 'sağa',
  'slight left': 'hafif sola',
  'slight right': 'hafif sağa',
  'sharp left': 'keskin sola',
  'sharp right': 'keskin sağa',
  straight: 'düz',
  uturn: 'U dönüşü yapıp geri',
};

/**
 * OSRM'in maneuver nesnesini kısa bir Türkçe sesli talimata çevirir.
 * @param {{type: string, modifier?: string}} maneuver
 * @returns {string|null} Seslendirilecek değilse (ör. çok küçük ara adımlar) null.
 */
function translateManeuver(maneuver) {
  const verb = MANEUVER_VERBS[maneuver.type];
  if (!verb) return null;

  if (maneuver.type === 'depart' || maneuver.type === 'arrive') {
    return verb.charAt(0).toUpperCase() + verb.slice(1);
  }

  const direction = maneuver.modifier ? MANEUVER_DIRECTIONS[maneuver.modifier] : null;
  return direction ? `${direction.charAt(0).toUpperCase() + direction.slice(1)} ${verb}` : null;
}
