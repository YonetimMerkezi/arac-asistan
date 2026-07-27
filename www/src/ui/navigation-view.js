/**
 * navigation-view.js
 * ---------------------------------------------------------------------------
 * Navigasyon ekranı: canlı konum/pusula, ev/iş hızlı erişim (rota çizimi),
 * yakındaki otopark/akaryakıt/servis/hastane arama.
 *
 * Harita: Leaflet. Rota: route-service.js (OSRM). POI: poi-search.js.
 * Favoriler: favorites-store.js. Konum: core/gps-tracker.js (paylaşılan).
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { findNearbyPoi } from '../maps/poi-search.js';
import { getFavoriteLocation, setFavoriteLocation } from '../maps/favorites-store.js';
import { logWarn } from '../core/logger.js';

/** @type {[number, number]} Konum yokken haritanın açılacağı varsayılan merkez (Türkiye geneli). */
const DEFAULT_CENTER = [39.0, 35.0];

/** @type {import('leaflet').Map|null} */
let map = null;

/** @type {import('leaflet').Marker|null} */
let vehicleMarker = null;

/** @type {import('leaflet').Polyline|null} */
let routeLine = null;

/** @type {import('leaflet').Marker[]} */
let poiMarkers = [];

/** @type {boolean} Harita ilk konum geldiğinde bir kez ortalanır, sonra kullanıcı serbestçe gezdirebilir. */
let hasAutoCentered = false;

/**
 * Navigasyon görünümünü başlatır: haritayı kurar, konum/favori düğmelerini bağlar.
 */
export function initNavigationView() {
  const container = document.querySelector('[data-view="navigation"]');
  if (!container) {
    logWarn('navigation-view', 'Navigasyon konteyneri bulunamadı');
    return;
  }

  container.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
      <button type="button" data-quick="home" class="sda-nav-btn" style="background:var(--sda-accent-soft);">Eve Git</button>
      <button type="button" data-quick="work" class="sda-nav-btn" style="background:var(--sda-accent-soft);">İşe Git</button>
      <button type="button" data-poi="fuel" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Yakıt</button>
      <button type="button" data-poi="parking" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Otopark</button>
      <button type="button" data-poi="service" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Servis</button>
      <button type="button" data-poi="hospital" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Hastane</button>
    </div>
    <div data-map style="height: 60vh; border-radius: var(--sda-radius-md); overflow:hidden;"></div>
    <p data-status class="sda-card__label" style="margin-top:8px;"></p>
  `;

  map = L.map(container.querySelector('[data-map]')).setView(DEFAULT_CENTER, 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap katkıda bulunanlar',
    maxZoom: 19,
  }).addTo(map);

  onPosition(updateVehicleMarker);
  const last = getLastPosition();
  if (last) updateVehicleMarker(last);

  bindQuickNavButtons(container);
  bindPoiButtons(container);
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function updateVehicleMarker(position) {
  if (!map) return;
  const latLng = [position.latitude, position.longitude];

  if (!vehicleMarker) {
    vehicleMarker = L.marker(latLng, {
      icon: L.divIcon({
        className: 'sda-vehicle-marker',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#FF8A3D;border:2px solid white;"></div>',
        iconSize: [14, 14],
      }),
    }).addTo(map);
  } else {
    vehicleMarker.setLatLng(latLng);
  }

  if (!hasAutoCentered) {
    hasAutoCentered = true;
    map.setView(latLng, 15);
  }
}

/**
 * "Eve Git" / "İşe Git" düğmelerini bağlar.
 * @param {HTMLElement} container
 */
function bindQuickNavButtons(container) {
  container.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-quick');
      const favorite = getFavoriteLocation(id);
      const statusEl = container.querySelector('[data-status]');

      if (!favorite) {
        // İlk kullanımda konum tanımlı değilse, mevcut konumu o favoriye ata.
        const current = getLastPosition();
        if (!current) {
          if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
          return;
        }
        await setFavoriteLocation({
          id, label: id === 'home' ? 'Ev' : 'İş',
          lat: current.latitude, lon: current.longitude,
        });
        if (statusEl) statusEl.textContent = `${id === 'home' ? 'Ev' : 'İş'} konumu mevcut konumunuz olarak kaydedildi. Tekrar dokunun.`;
        return;
      }

      await drawRouteTo(favorite, container);
    });
  });
}

/**
 * Bir favori konuma rota çizer.
 * @param {import('../maps/favorites-store.js').FavoriteLocation} destination
 * @param {HTMLElement} container
 */
async function drawRouteTo(destination, container) {
  const current = getLastPosition();
  const statusEl = container.querySelector('[data-status]');
  if (!current) {
    if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Rota hesaplanıyor...';

  const route = await getDrivingRoute(
    { lat: current.latitude, lon: current.longitude },
    { lat: destination.lat, lon: destination.lon },
  );

  if (!route) {
    if (statusEl) statusEl.textContent = 'Rota alınamadı (internet bağlantınızı kontrol edin).';
    return;
  }

  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(route.coordinates, { color: '#4FD8E0', weight: 5 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });

  if (statusEl) {
    statusEl.textContent = `${destination.label}: ${route.distanceKm.toFixed(1)} km, ~${Math.round(route.durationMinutes)} dk`;
  }
}

/**
 * Yakındaki POI düğmelerini bağlar.
 * @param {HTMLElement} container
 */
function bindPoiButtons(container) {
  container.querySelectorAll('[data-poi]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = button.getAttribute('data-poi');
      const current = getLastPosition();
      const statusEl = container.querySelector('[data-status]');
      if (!current) {
        if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
        return;
      }

      if (statusEl) statusEl.textContent = 'Aranıyor...';
      const results = await findNearbyPoi(category, current.latitude, current.longitude);

      poiMarkers.forEach((m) => map.removeLayer(m));
      poiMarkers = results.slice(0, 15).map((poi) => L.marker([poi.lat, poi.lon])
        .bindPopup(`${poi.name} (${poi.distanceKm.toFixed(1)} km)`)
        .addTo(map));

      if (statusEl) {
        statusEl.textContent = results.length > 0
          ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km`
          : 'Yakında sonuç bulunamadı.';
      }
    });
  });
}
