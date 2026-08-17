/**
 * navigation-view.js
 * ---------------------------------------------------------------------------
 * Harita ekranı yalnızca harita/POI işlevlerine odaklanır.
 * Sürüşe ait hız, limit, adres arama, Ev/İş ve Google Haritalar kısayolları
 * navigation-drive-view.js içindeki Navigasyon ekranında tutulur.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { onPosition, getLastPosition, ensureGpsTracking } from '../core/gps-tracker.js';
import { onViewChange } from '../core/view-router.js';
import { findNearbyPoi } from '../maps/poi-search.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { bindFullscreenToggle, bindSatelliteToggle, renderVehicleMarker } from './navigation-map-overlay.js';
import { openOfflineRegionPanel } from './offline-region-panel.js';
import { bindTapRouteMode } from './navigation-tap-route.js';
import { getFuelStationCache, onFuelStationCacheUpdate, forceRefreshFuelStationCache } from '../maps/fuel-station-cache.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { renderFuelPanel, clearFuelPanel } from './navigation-fuel-panel.js';
import { mountGpsDetailCard } from './components/gps-detail-card.js';
import { iconMarkup } from './icons.js';
import { logWarn } from '../core/logger.js';

const DEFAULT_CENTER = [39.0, 35.0];
const FUEL_CACHE_MAX_DISTANCE_KM = 5;

const CATEGORY_VISUALS = {
  fuel: { icon: 'fuel', color: '#F7941E' },
  parking: { icon: 'parking', color: '#4FD8E0' },
  service: { icon: 'service', color: '#9B8CFF' },
  hospital: { icon: 'hospital', color: '#FF5A5F' },
};

let map = null;
let vehicleMarker = null;
let poiMarkers = [];
let hasAutoCentered = false;
let activeCategory = null;

export function initNavigationView() {
  const container = document.querySelector('[data-view="navigation"]');
  if (!container) {
    logWarn('navigation-view', 'Harita konteyneri bulunamadı');
    return;
  }

  container.innerHTML = `
    <div data-nav-chrome>
      <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin-bottom:8px;">
        ${Object.entries(CATEGORY_VISUALS).map(([category, visual]) => `
          <button type="button" data-poi="${category}" class="sda-category-btn" style="background:${visual.color}; justify-content:center; min-width:0;">
            ${iconMarkup(visual.icon, { size: 16 })}<span>${categoryLabel(category)}</span>
          </button>
        `).join('')}
      </div>
      <div data-brand-filter style="display:flex; gap:6px; overflow-x:auto; margin-bottom:8px; padding-bottom:2px;"></div>
    </div>

    <div data-map-wrapper style="position:relative;">
      <div data-map style="height:62vh; min-height:420px; border-radius:var(--sda-radius-md); overflow:hidden;"></div>
      <div style="position:absolute; top:8px; right:8px; z-index:1200; display:flex; flex-direction:column; gap:6px;">
        <button type="button" data-fullscreen-toggle class="sda-nav-btn" title="Tam ekran" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('fullscreen', { size: 20 })}</button>
        <button type="button" data-satellite-toggle class="sda-nav-btn" title="Uydu görünümü" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('satellite', { size: 20 })}</button>
        <button type="button" data-tap-route-toggle title="Haritaya dokunarak nokta nokta rota oluştur" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('add-location', { size: 20 })}</button>
        <button type="button" data-offline-region-toggle title="Bu bölgeyi çevrimdışı kullanım için indir" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('download', { size: 20 })}</button>
      </div>
      <div data-tap-route-controls style="display:none; position:absolute; bottom:8px; left:8px; right:8px; z-index:1200; gap:8px;">
        <button type="button" data-tap-route-undo class="sda-nav-btn" style="flex:1; background:var(--sda-bg-elevated); box-shadow:var(--sda-shadow-elevated);">Son Noktayı Sil</button>
        <button type="button" data-tap-route-clear class="sda-nav-btn" style="flex:1; background:var(--sda-danger-soft); box-shadow:var(--sda-shadow-elevated);">Tümünü Temizle</button>
      </div>
    </div>

    <p data-status class="sda-card__label" style="margin-top:8px;"></p>
    <div data-gps-detail style="margin-top:8px;"></div>
    <div data-poi-list style="margin-top:8px;"></div>
    <div data-price-table style="margin-top:16px;"></div>
  `;

  const mapElement = container.querySelector('[data-map]');
  if (!mapElement) {
    logWarn('navigation-view', 'Harita elementi bulunamadı');
    return;
  }

  map = L.map(mapElement, {
    center: DEFAULT_CENTER,
    zoom: 6,
    zoomControl: true,
    attributionControl: true,
  });

  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap katkıda bulunanlar',
    maxZoom: 19,
    crossOrigin: true,
  }).addTo(map);

  streetLayer.on('tileerror', () => {
    const statusEl = container.querySelector('[data-status]');
    if (statusEl && !statusEl.textContent) {
      statusEl.textContent = 'Harita karoları yüklenemedi. İnternet bağlantınızı kontrol edin.';
    }
  });

  const resizeMap = () => {
    try { map?.invalidateSize(true); } catch {}
  };
  requestAnimationFrame(resizeMap);
  setTimeout(resizeMap, 100);
  setTimeout(resizeMap, 350);
  setTimeout(resizeMap, 800);

  bindSatelliteToggle(container, map, streetLayer);
  bindFullscreenToggle(container, map);
  bindTapRouteMode(container, map);

  onPosition(updateVehicleMarker);
  const last = getLastPosition();
  if (last) updateVehicleMarker(last);
  void ensureGpsTracking();

  bindPoiButtons(container);

  activeCategory = 'fuel';
  const initialFuelCache = getFuelStationCache();
  if (isFuelCacheRelevant(initialFuelCache, last)
      && (initialFuelCache.stations.length > 0 || initialFuelCache.prices.length > 0)) {
    renderFuelPanel({
      map,
      container,
      results: initialFuelCache.stations,
      prices: initialFuelCache.prices,
      location: initialFuelCache.location,
      fetchedAt: initialFuelCache.fetchedAt,
    });
  } else if (last) {
    void forceRefreshFuelStationCache();
  }

  const gpsDetailContainer = container.querySelector('[data-gps-detail]');
  if (gpsDetailContainer) mountGpsDetailCard(gpsDetailContainer);

  container.querySelector('[data-offline-region-toggle]')?.addEventListener('click', () => {
    openOfflineRegionPanel(map);
  });

  registerRefreshHandler('navigation', () => forceRefreshFuelStationCache());

  onViewChange((viewName) => {
    if (viewName !== 'navigation' || !map) return;
    requestAnimationFrame(() => map.invalidateSize());
  });
}

function categoryLabel(category) {
  const labels = {
    fuel: 'Yakıt',
    parking: 'Otopark',
    service: 'Servis',
    hospital: 'Hastane',
  };
  return labels[category] ?? category;
}

function updateVehicleMarker(position) {
  if (!map) return;
  vehicleMarker = renderVehicleMarker(map, vehicleMarker, position);
  if (!hasAutoCentered) {
    hasAutoCentered = true;
    map.setView([position.latitude, position.longitude], 15);
  }
}

function bindPoiButtons(container) {
  container.querySelectorAll('[data-poi]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = button.getAttribute('data-poi');
      activeCategory = category;

      container.querySelectorAll('[data-poi]').forEach((item) => {
        item.style.outline = item === button ? '2px solid rgba(255,255,255,.9)' : '';
        item.style.outlineOffset = item === button ? '2px' : '';
      });

      const current = getLastPosition();
      const statusEl = container.querySelector('[data-status]');
      const listEl = container.querySelector('[data-poi-list]');
      const priceTableEl = container.querySelector('[data-price-table]');
      const filterEl = container.querySelector('[data-brand-filter]');

      if (priceTableEl) priceTableEl.innerHTML = '';
      if (filterEl) filterEl.innerHTML = '';
      if (listEl) listEl.innerHTML = '';

      if (category === 'fuel') {
        poiMarkers.forEach((marker) => map.removeLayer(marker));
        poiMarkers = [];
      } else {
        clearFuelPanel(map);
      }

      if (!current) {
        if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
        return;
      }

      if (category === 'fuel') {
        const cached = getFuelStationCache();
        if (isFuelCacheRelevant(cached, current) && cached.stations.length > 0) {
          renderFuelPanel({
            map,
            container,
            results: cached.stations,
            prices: cached.prices,
            location: cached.location,
            fetchedAt: cached.fetchedAt,
          });
          const ageMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
          const ageText = ageMinutes > 0 ? `${ageMinutes} dk önce güncellendi` : 'az önce güncellendi';
          const priceNote = cached.prices.length > 0 ? '' : ' · fiyat verisi güncelleniyor';
          if (statusEl) statusEl.textContent = `${cached.stations.length} istasyon · ${ageText}${priceNote}`;
          return;
        }

        if (statusEl) statusEl.textContent = 'Yakındaki istasyonlar güncelleniyor...';
        void forceRefreshFuelStationCache();
      } else if (statusEl) {
        statusEl.textContent = 'Aranıyor...';
      }

      let results = await findNearbyPoi(category, current.latitude, current.longitude, 7000);
      if (results.length === 0) {
        if (statusEl) statusEl.textContent = 'Yakında bulunamadı, arama genişletiliyor...';
        results = await findNearbyPoi(category, current.latitude, current.longitude, 20000);
      }

      if (category === 'fuel') {
        const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
        const prices = location
          ? await getFuelPrices(location.il, location.ilce, current.longitude)
          : [];
        renderFuelPanel({ map, container, results, prices, location, fetchedAt: Date.now() });
      } else {
        renderPoiMarkersAndList(results, listEl, statusEl, category);
      }
    });
  });

  onFuelStationCacheUpdate((cached) => {
    if (activeCategory !== 'fuel') return;
    const current = getLastPosition();
    if (!isFuelCacheRelevant(cached, current)) return;
    renderFuelPanel({
      map,
      container,
      results: cached.stations,
      prices: cached.prices,
      location: cached.location,
      fetchedAt: cached.fetchedAt,
    });
  });
}

function isFuelCacheRelevant(cached, current) {
  if (!cached?.fetchedForPosition) return !current;
  if (!current) return true;
  return haversineKm(
    cached.fetchedForPosition.lat,
    cached.fetchedForPosition.lon,
    current.latitude,
    current.longitude,
  ) <= FUEL_CACHE_MAX_DISTANCE_KM;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderPoiMarkersAndList(results, listEl, statusEl, category) {
  poiMarkers.forEach((marker) => map.removeLayer(marker));
  const visual = CATEGORY_VISUALS[category] ?? { color: '#4FD8E0' };

  poiMarkers = results.slice(0, 15).map((poi) => L.marker([poi.lat, poi.lon], {
    icon: L.divIcon({
      className: 'sda-poi-marker',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${visual.color};border:2px solid white;"></div>`,
      iconSize: [16, 16],
    }),
  }).bindPopup(`${poi.name} (${poi.distanceKm.toFixed(1)} km)`).addTo(map));

  renderPoiList(listEl, results.slice(0, 15));

  if (results.length > 0) {
    const bounds = L.latLngBounds(results.slice(0, 15).map((poi) => [poi.lat, poi.lon]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }

  if (statusEl) {
    const isOffline = results.length > 0 && results.every((poi) => poi.isOffline);
    const offlineNote = isOffline ? ' · çevrimdışı önbellekten' : '';
    statusEl.textContent = results.length > 0
      ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km${offlineNote}`
      : 'Bu bölgede kayıtlı sonuç bulunamadı.';
  }
}

function renderPoiList(listEl, results) {
  if (!listEl) return;
  if (results.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = results.map((poi, index) => `
    <button type="button" data-poi-row="${index}" class="sda-card" style="display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; margin-bottom:6px; border:none;">
      <span><span class="sda-card__value" style="font-size:0.95rem;">${poi.name}</span></span>
      <span class="sda-card__label">${poi.distanceKm.toFixed(1)} km</span>
    </button>
  `).join('');

  listEl.querySelectorAll('[data-poi-row]').forEach((row) => {
    row.addEventListener('click', () => {
      const marker = poiMarkers[Number(row.getAttribute('data-poi-row'))];
      if (!marker) return;
      map.setView(marker.getLatLng(), 16);
      marker.openPopup();
    });
  });
}
