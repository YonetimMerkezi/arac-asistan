/**
 * navigation-drive-view.js
 * Dedicated driving-navigation tab.
 * Keeps the existing "Harita" tab intact and provides a separate
 * automotive navigation screen.
 */
import L from 'leaflet';
import { onPosition, getLastPosition, ensureGpsTracking } from '../core/gps-tracker.js';
import { offlineTileLayer } from '../maps/offline-tile-layer.js';
import { openAddressSearchModal } from './components/address-search-modal.js';
import { drawRouteTo } from './navigation-route-panel.js';
import { iconMarkup } from './icons.js';

let map = null;
let marker = null;
let follow = true;
let firstFix = true;
let unsubscribe = null;
let containerRef = null;

const DEFAULT_CENTER = [39, 35];

function positionOf(p) {
  if (!p) return null;
  const lat = Number(p.latitude ?? p.lat);
  const lon = Number(p.longitude ?? p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, speed: Number(p.speedKmh ?? p.speed ?? 0), heading: Number(p.heading ?? p.course ?? 0) };
}

function carIcon(heading = 0) {
  return L.divIcon({
    className: 'sda-drive-car-icon',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div class="sda-drive-car-arrow" style="transform:rotate(${Number.isFinite(heading) ? heading : 0}deg)">
      <span>▲</span>
    </div>`,
  });
}

export function initNavigationDriveView() {
  const container = document.querySelector('[data-view="navigation-drive"]');
  if (!container) return;
  containerRef = container;

  container.innerHTML = `
    <div class="sda-drive-nav">
      <div class="sda-drive-nav__top">
        <div>
          <div class="sda-drive-nav__eyebrow">SÜRÜŞ NAVİGASYONU</div>
          <div class="sda-drive-nav__title">Nereye gidiyorsun?</div>
        </div>
        <button type="button" data-drive-follow class="sda-drive-icon-btn is-active" title="Aracı takip et">◎</button>
      </div>

      <div class="sda-drive-search">
        <button type="button" data-drive-search>
          ${iconMarkup('search', {size: 20})}
          <span>Adres, yer veya işletme ara</span>
        </button>
      </div>

      <div class="sda-drive-quick">
        <button type="button" data-drive-quick="home">${iconMarkup('home',{size:17})}<span>Ev</span></button>
        <button type="button" data-drive-quick="work">${iconMarkup('work',{size:17})}<span>İş</span></button>
        <button type="button" data-drive-locate>${iconMarkup('location',{size:17})}<span>Konumum</span></button>
      </div>

      <div class="sda-drive-map-wrap">
        <div data-drive-map class="sda-drive-map"></div>
        <div class="sda-drive-compass" data-drive-compass>↑</div>
        <div class="sda-drive-follow-hint" data-drive-follow-hint>Haritayı takip ediyor</div>
      </div>

      <div class="sda-drive-live">
        <div><strong data-drive-speed>--</strong><span>km/sa</span></div>
        <div><strong data-drive-distance>--</strong><span>kalan</span></div>
        <div><strong data-drive-eta>--</strong><span>varış</span></div>
      </div>

      <div class="sda-drive-safety">
        <div class="sda-drive-safety-card">
          <span class="sda-drive-safety-icon">🚦</span>
          <div><strong data-drive-limit>--</strong><small>Hız limiti</small></div>
        </div>
        <div class="sda-drive-safety-card">
          <span class="sda-drive-safety-icon">📸</span>
          <div><strong data-drive-radar>--</strong><small>Radar</small></div>
        </div>
        <div class="sda-drive-safety-card">
          <span class="sda-drive-safety-icon">⛽</span>
          <div><strong data-drive-fuel>--</strong><small>Tüketim</small></div>
        </div>
      </div>

      <div data-drive-status class="sda-drive-status">GPS bekleniyor...</div>
      <div data-drive-route-summary class="sda-drive-route-summary" hidden>
        <strong data-route-destination>--</strong>
        <span data-route-details>--</span>
      </div>
    </div>
  `;

  map = L.map(container.querySelector('[data-drive-map]'), {
    zoomControl: false,
    attributionControl: true,
  }).setView(DEFAULT_CENTER, 6);

  offlineTileLayer({
    attribution: '© OpenStreetMap katkıda bulunanlar',
    maxZoom: 19,
  }).addTo(map);

  L.control.zoom({position: 'bottomright'}).addTo(map);

  const search = container.querySelector('[data-drive-search]');
  search?.addEventListener('click', () => openAddressSearchModal(map, container));

  container.querySelector('[data-drive-follow]')?.addEventListener('click', () => {
    follow = true;
    updateFollowUI();
    recenter();
  });

  container.querySelector('[data-drive-locate]')?.addEventListener('click', () => {
    follow = true;
    updateFollowUI();
    recenter();
  });

  // Quick home/work: use the existing main navigation buttons if they exist.
  container.querySelectorAll('[data-drive-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.driveQuick;
      const legacy = document.querySelector(`[data-view="navigation"] [data-quick="${type}"]`);
      legacy?.click();
      // If the legacy view starts a route, it will be reflected on the shared map.
    });
  });

  // User manually touching/dragging the map pauses auto-follow.
  map.on('dragstart zoomstart', () => {
    follow = false;
    updateFollowUI();
  });

  unsubscribe?.();
  unsubscribe = onPosition(updatePosition);
  void ensureGpsTracking();

  const last = positionOf(getLastPosition());
  if (last) updatePosition(getLastPosition());
  setTimeout(() => map?.invalidateSize(), 150);
  setTimeout(() => map?.invalidateSize(), 500);

  // Existing route progress cards can update the dedicated summary through events.
  window.addEventListener('sda:navigation:progress', onRouteProgress);
  window.addEventListener('sda:navigation:route-updated', onRouteUpdated);
}

function updatePosition(raw) {
  const p = positionOf(raw);
  if (!p || !map) return;

  if (!marker) {
    marker = L.marker([p.lat, p.lon], {icon: carIcon(p.heading)}).addTo(map);
  } else {
    marker.setLatLng([p.lat, p.lon]);
    marker.setIcon(carIcon(p.heading));
  }

  const speed = p.speed > 0 ? Math.round(p.speed) : 0;
  const speedEl = containerRef?.querySelector('[data-drive-speed]');
  if (speedEl) speedEl.textContent = speed;

  const status = containerRef?.querySelector('[data-drive-status]');
  if (status) status.textContent = speed > 3 ? 'Sürüş aktif · Harita takipte' : 'Araç konumu sabit';

  if (firstFix || follow) {
    map.panTo([p.lat, p.lon], {animate: true, duration: .35});
    if (firstFix) map.setZoom(17, {animate: false});
    firstFix = false;
  }
}

function recenter() {
  const p = positionOf(getLastPosition());
  if (!p || !map) return;
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), 16), {animate: true});
}

function updateFollowUI() {
  const btn = containerRef?.querySelector('[data-drive-follow]');
  const hint = containerRef?.querySelector('[data-drive-follow-hint]');
  btn?.classList.toggle('is-active', follow);
  if (hint) hint.textContent = follow ? 'Haritayı takip ediyor' : 'Takip duraklatıldı';
}

function onRouteProgress(event) {
  const d = event.detail || {};
  const distance = Number(d.remainingMeters);
  if (Number.isFinite(distance)) {
    const el = containerRef?.querySelector('[data-drive-distance]');
    if (el) el.textContent = distance >= 1000
      ? `${(distance/1000).toFixed(1)} km`
      : `${Math.round(distance)} m`;
  }
}

function onRouteUpdated(event) {
  const route = event.detail?.route;
  if (!route) return;
  const box = containerRef?.querySelector('[data-drive-route-summary]');
  const destination = containerRef?.querySelector('[data-route-destination]');
  const details = containerRef?.querySelector('[data-route-details]');
  if (box) box.hidden = false;
  if (destination) destination.textContent = route.destination?.label || 'Navigasyon';
  if (details) details.textContent = `${(Number(route.distance || 0)/1000).toFixed(1)} km · ${Math.round(Number(route.duration || 0)/60)} dk`;
}
