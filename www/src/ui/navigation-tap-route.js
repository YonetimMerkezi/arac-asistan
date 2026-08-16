/**
 * navigation-tap-route.js
 * ---------------------------------------------------------------------------
 * Haritaya dokunarak nokta nokta rota oluşturma ("tap route" modu).
 *
 * Kullanıcı "Noktayla Rota" düğmesine basıp haritaya sırayla dokunur - her
 * dokunuş bir durak ekler; 2. dokunuştan itibaren duraklar SIRAYLA
 * birleştirilerek tek bir rota çizilir (route-service.js'in çoklu nokta
 * desteğiyle - bkz. getMultiPointRoute).
 *
 * DÜZELTME: Önceki sürümde yanlışlıkla eklenen bir noktayı SİLMENİN hiçbir
 * yolu yoktu - modu tamamen kapatıp her şeyi silmek zorunda kalıyordunuz.
 * Artık "Son Noktayı Sil" (undo) ve "Tümünü Temizle" ayrı düğmeler.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { getMultiPointRoute } from '../maps/route-service.js';
import { startGuidance } from '../maps/turn-by-turn.js';
import { logWarn } from '../core/logger.js';

/** @type {{lat: number, lon: number}[]} */
let waypoints = [];

/** @type {import('leaflet').Marker[]} */
let waypointMarkers = [];

/** @type {import('leaflet').Polyline|null} */
let tapRouteLine = null;

/** @type {boolean} */
let modeActive = false;

/**
 * "Noktayla Rota" düğmesini, haritaya dokunma dinleyicisini ve sil/temizle
 * düğmelerini bağlar.
 * @param {HTMLElement} container
 * @param {import('leaflet').Map} map
 */
export function bindTapRouteMode(container, map) {
  const toggleButton = container.querySelector('[data-tap-route-toggle]');
  const controlsEl = container.querySelector('[data-tap-route-controls]');
  const undoButton = container.querySelector('[data-tap-route-undo]');
  const clearButton = container.querySelector('[data-tap-route-clear]');
  const statusEl = container.querySelector('[data-status]');
  if (!toggleButton) return;

  toggleButton.addEventListener('click', () => {
    modeActive = !modeActive;
    // Mod AÇIKKEN düğme belirgin şekilde vurgulanır - "bu mod şu an aktif,
    // haritaya dokunabilirsin" net görülsün diye (önceki sürümde bu ayrım
    // belirsizdi).
    toggleButton.style.background = modeActive ? 'var(--sda-accent)' : 'var(--sda-bg-elevated)';
    toggleButton.style.color = modeActive ? 'white' : '';

    if (!modeActive) {
      clearAll(map, statusEl, controlsEl);
    } else if (statusEl) {
      statusEl.textContent = 'Haritaya dokunarak durak ekleyin (en az 2 nokta).';
    }
  });

  undoButton?.addEventListener('click', () => {
    undoLastWaypoint(map, statusEl, controlsEl);
  });

  clearButton?.addEventListener('click', () => {
    clearAll(map, statusEl, controlsEl);
  });

  map.on('click', (event) => {
    if (!modeActive) return;
    addWaypoint(map, event.latlng, statusEl, controlsEl);
  });
}

/**
 * @param {import('leaflet').Map} map
 * @param {import('leaflet').LatLng} latlng
 * @param {HTMLElement|null} statusEl
 * @param {HTMLElement|null} controlsEl
 */
function addWaypoint(map, latlng, statusEl, controlsEl) {
  const point = { lat: latlng.lat, lon: latlng.lng };
  waypoints.push(point);

  const marker = L.marker([point.lat, point.lon], {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:var(--sda-accent); color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; box-shadow:0 1px 4px rgba(0,0,0,0.4);">${waypoints.length}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  }).addTo(map);
  waypointMarkers.push(marker);

  if (controlsEl) controlsEl.style.display = 'flex';

  if (waypoints.length >= 2) {
    void drawTapRoute(map, statusEl);
  } else if (statusEl) {
    statusEl.textContent = '1 durak eklendi - en az bir tane daha ekleyin.';
  }
}

/**
 * Son eklenen noktayı kaldırır - yanlışlıkla yanlış yere dokunulduğunda
 * her şeyi silmeye gerek kalmadan düzeltme imkânı verir.
 * @param {import('leaflet').Map} map
 * @param {HTMLElement|null} statusEl
 * @param {HTMLElement|null} controlsEl
 */
function undoLastWaypoint(map, statusEl, controlsEl) {
  if (waypoints.length === 0) return;

  waypoints.pop();
  const lastMarker = waypointMarkers.pop();
  if (lastMarker) map.removeLayer(lastMarker);

  if (tapRouteLine) {
    map.removeLayer(tapRouteLine);
    tapRouteLine = null;
  }

  if (waypoints.length === 0) {
    if (controlsEl) controlsEl.style.display = 'none';
    if (statusEl) statusEl.textContent = 'Haritaya dokunarak durak ekleyin (en az 2 nokta).';
  } else if (waypoints.length === 1) {
    if (statusEl) statusEl.textContent = '1 durak eklendi - en az bir tane daha ekleyin.';
  } else {
    void drawTapRoute(map, statusEl);
  }
}

/**
 * @param {import('leaflet').Map} map
 * @param {HTMLElement|null} statusEl
 */
async function drawTapRoute(map, statusEl) {
  if (statusEl) statusEl.textContent = 'Rota hesaplanıyor...';

  try {
    const route = await getMultiPointRoute(waypoints);
    if (!route) {
      if (statusEl) statusEl.textContent = 'Rota alınamadı - duraklar arasında yol bulunamadı olabilir.';
      return;
    }

    if (tapRouteLine) map.removeLayer(tapRouteLine);
    tapRouteLine = L.polyline(route.coordinates, { color: '#4FD8E0', weight: 5 }).addTo(map);
    map.fitBounds(tapRouteLine.getBounds(), { padding: [24, 24] });

    if (statusEl) {
      statusEl.textContent = `${waypoints.length} durak: ${route.distanceKm.toFixed(1)} km, ~${Math.round(route.durationMinutes)} dk. Daha fazla durak eklemek için dokunmaya devam edin.`;
    }

    startGuidance(route);
  } catch (error) {
    logWarn('navigation-tap-route', 'Çok noktalı rota çizilemedi', error);
    if (statusEl) statusEl.textContent = 'Rota hesaplanırken bir hata oluştu.';
  }
}

/**
 * @param {import('leaflet').Map} map
 * @param {HTMLElement|null} statusEl
 * @param {HTMLElement|null} controlsEl
 */
function clearAll(map, statusEl, controlsEl) {
  waypointMarkers.forEach((marker) => map.removeLayer(marker));
  waypointMarkers = [];
  waypoints = [];
  if (tapRouteLine) {
    map.removeLayer(tapRouteLine);
    tapRouteLine = null;
  }
  if (controlsEl) controlsEl.style.display = 'none';
  if (statusEl) statusEl.textContent = '';
}
