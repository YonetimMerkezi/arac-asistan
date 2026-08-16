/**
 * navigation-route.js
 * Smart Drive AI - V2 rota motoru
 *
 * Ücretsiz mimari:
 * 1) Öncelik: Android native bridge (yerel/offline routing motoru)
 * 2) Alternatif: Kullanıcının kendi kurduğu OSRM sunucusu
 *
 * Varsayılan olarak üçüncü taraf ücretli API kullanılmaz.
 */

const DEFAULTS = {
  provider: 'native',
  localOsrmUrl: 'http://127.0.0.1:5000',
};

let config = { ...DEFAULTS };

export function configureRouteEngine(options = {}) {
  config = { ...config, ...options };
}

function nativeRoute(start, end, options = {}) {
  const bridge = window.SmartDriveNavigation;
  if (!bridge || typeof bridge.route !== 'function') {
    return Promise.reject(new Error('Yerel rota motoru henüz Android tarafına bağlanmadı.'));
  }

  return new Promise((resolve, reject) => {
    const requestId = `route-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const previous = window[`__sdaRoute_${requestId}`];
    window[`__sdaRoute_${requestId}`] = (payload) => {
      delete window[`__sdaRoute_${requestId}`];
      if (payload?.error) reject(new Error(payload.error));
      else resolve(normalizeRoute(payload));
    };

    try {
      bridge.route(JSON.stringify({
        requestId,
        start,
        end,
        profile: options.profile || 'car',
        alternatives: Boolean(options.alternatives),
        language: 'tr',
        callback: `__sdaRoute_${requestId}`,
      }));
    } catch (error) {
      window[`__sdaRoute_${requestId}`] = previous;
      reject(error);
    }
  });
}

async function localOsrmRoute(start, end, options = {}) {
  const base = String(config.localOsrmUrl || '').replace(/\/$/, '');
  const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=${options.alternatives ? 'true' : 'false'}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Yerel OSRM HTTP ${response.status}`);

  const json = await response.json();
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new Error('Rota bulunamadı.');
  }

  return normalizeRoute(json.routes[0]);
}

function normalizeRoute(route) {
  const geometry = route.geometry?.coordinates
    ? route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
    : (route.geometry || []);

  const steps = (route.legs || []).flatMap((leg) =>
    (leg.steps || []).map((step) => ({
      distance: Number(step.distance || 0),
      duration: Number(step.duration || 0),
      name: step.name || '',
      instruction: step.maneuver?.instruction || buildInstruction(step),
      type: step.maneuver?.type || '',
      modifier: step.maneuver?.modifier || '',
      location: step.maneuver?.location
        ? [step.maneuver.location[1], step.maneuver.location[0]]
        : null,
    }))
  );

  return {
    distance: Number(route.distance || 0),
    duration: Number(route.duration || 0),
    geometry,
    steps,
    raw: route,
  };
}

function buildInstruction(step) {
  const modifier = step.maneuver?.modifier;
  const type = step.maneuver?.type;

  const directions = {
    'turn': modifier === 'left' ? 'Sola dönün' : modifier === 'right' ? 'Sağa dönün' : 'Dönün',
    'new name': 'Yola devam edin',
    'continue': 'Yola devam edin',
    'merge': 'Yola katılın',
    'roundabout': 'Göbekten ilerleyin',
    'depart': 'Harekete geçin',
    'arrive': 'Hedefinize ulaştınız',
  };

  return directions[type] || 'Yola devam edin';
}

export async function calculateRoute(start, end, options = {}) {
  if (!start || !end) throw new Error('Başlangıç ve hedef konumu gerekli.');

  const provider = options.provider || config.provider;

  if (provider === 'native') {
    return nativeRoute(start, end, options);
  }

  if (provider === 'osrm-local') {
    return localOsrmRoute(start, end, options);
  }

  throw new Error(`Bilinmeyen rota sağlayıcısı: ${provider}`);
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} sa ${mins} dk` : `${hours} sa`;
}

export function formatRouteDistance(meters) {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
