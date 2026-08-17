/**
 * navigation-view.js
 * ---------------------------------------------------------------------------
 * Navigasyon ekranı: canlı konum/pusula, ev/iş konumu SEÇME ve rota çizimi,
 * "konumumu bul", yakındaki otopark/akaryakıt/servis/hastane arama.
 *
 * Akaryakıt (Yakıt) kategorisinin zengin davranışı (marka filtreleri, renkli
 * işaretçiler, marka atama modalı, bölge fiyat tablosu) navigation-fuel-panel.js'e
 * taşındı (kod standardı: dosya başına maks. 500 satır) - bu dosya yalnızca
 * haritayı/favorileri/rotayı ve yakıt DIŞI kategorileri yönetir, Yakıt
 * kategorisi için o modülün render/clear fonksiyonlarını çağırır.
 *
 * Harita: Leaflet. Rota: route-service.js (OSRM). POI: poi-search.js.
 * Favoriler: favorites-store.js. Konum: core/gps-tracker.js (paylaşılan).
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { onPosition, getLastPosition, ensureGpsTracking } from '../core/gps-tracker.js';
import { onViewChange } from '../core/view-router.js';
import { findNearbyPoi } from '../maps/poi-search.js';
import { getFavoriteLocation, setFavoriteLocation } from '../maps/favorites-store.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { drawRouteTo, openGoogleMapsGeneral } from './navigation-route-panel.js';
import { bindLiveSpeedLimitCard, bindFullscreenToggle, bindSatelliteToggle, renderVehicleMarker } from './navigation-map-overlay.js';
import { openOfflineRegionPanel } from './offline-region-panel.js';
import { bindTapRouteMode } from './navigation-tap-route.js';
import { openAddressSearchModal } from './components/address-search-modal.js';
import { getFuelStationCache, onFuelStationCacheUpdate, forceRefreshFuelStationCache } from '../maps/fuel-station-cache.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { renderFuelPanel, clearFuelPanel } from './navigation-fuel-panel.js';
import { mountGpsDetailCard } from './components/gps-detail-card.js';
import { iconMarkup } from './icons.js';
import { logWarn } from '../core/logger.js';

/** @type {[number, number]} Konum yokken haritanın açılacağı varsayılan merkez (Türkiye geneli). */
const DEFAULT_CENTER = [39.0, 35.0];

/** @type {number} Bu mesafeden daha eski konuma ait yakıt önbelleği ekranda gösterilmez. */
const FUEL_CACHE_MAX_DISTANCE_KM = 5;

/** @type {Record<string, {icon: string, color: string}>} Kategori düğmesi görseli. */
const CATEGORY_VISUALS = {
  fuel: { icon: 'fuel', color: '#F7941E' },
  parking: { icon: 'parking', color: '#4FD8E0' },
  service: { icon: 'service', color: '#9B8CFF' },
  hospital: { icon: 'hospital', color: '#FF5A5F' },
};

/** @type {import('leaflet').Map|null} */
let map = null;
/** @type {import('leaflet').Marker|null} */
let vehicleMarker = null;
/** @type {import('leaflet').Marker[]} */
let poiMarkers = [];
/** @type {import('leaflet').Marker|null} */
let favoritePickerMarker = null;
let hasAutoCentered = false;
/** @type {'home'|'work'|null} */
let pendingFavoriteSelection = null;
/** @type {string|null} */
let activeCategory = null;

export function initNavigationView() {
  const container = document.querySelector('[data-view="navigation"]');
  if (!container) {
    logWarn('navigation-view', 'Navigasyon konteyneri bulunamadı');
    return;
  }

  container.innerHTML = `
    <div data-nav-chrome>
      <div data-speed-card style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
        <div data-speed-dial style="width:76px; height:76px; border-radius:50%; background:#1c1f26; border:3px solid #3a3f4a; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0;">
          <p data-live-speed style="font-family:var(--sda-font-display); font-size:1.7rem; margin:0; font-weight:800; color:#ffffff; line-height:1;">--</p>
          <p style="margin:2px 0 0 0; font-size:0.6rem; color:#9aa1ad; letter-spacing:0.02em;">Km/sa</p>
        </div>
        <div style="width:56px; height:56px; border-radius:50%; background:white; border:4px solid #E02020; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <span data-live-speed-limit style="color:#1a1a1a; font-weight:800; font-size:1.15rem; font-family:var(--sda-font-display);">--</span>
        </div>
      </div>
      <button type="button" data-address-search class="sda-btn sda-btn--primary" style="width:100%; margin-bottom:8px;">
        ${iconMarkup('search', { size: 18 })} Nereye Gidiyorsun? (Adres Ara)
      </button>
      <button type="button" data-open-google-maps-general class="sda-nav-btn" style="width:100%; margin-bottom:8px; background:var(--sda-bg-elevated); flex-direction:row; justify-content:center; gap:8px;">
        ${iconMarkup('map', { size: 18 })}<span>Google Haritalar'ı Doğrudan Aç</span>
      </button>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:8px;">
        <button type="button" data-quick="home" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex-direction:row; gap:4px; justify-content:center;">${iconMarkup('home', { size: 16 })}<span>Eve Git</span></button>
        <button type="button" data-quick="work" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex-direction:row; gap:4px; justify-content:center;">${iconMarkup('work', { size: 16 })}<span>İşe Git</span></button>
        <button type="button" data-locate class="sda-nav-btn" style="background:var(--sda-bg-elevated); flex-direction:row; gap:4px; justify-content:center;">${iconMarkup('location', { size: 16 })}<span>Konumum</span></button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px;">
        <button type="button" data-set-favorite="home" class="sda-nav-btn" style="background:var(--sda-bg-elevated); font-size:0.65rem; justify-content:center;">Evi Ayarla</button>
        <button type="button" data-set-favorite="work" class="sda-nav-btn" style="background:var(--sda-bg-elevated); font-size:0.65rem; justify-content:center;">İşi Ayarla</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px;">
        ${Object.entries(CATEGORY_VISUALS).map(([category, visual]) => `
          <button type="button" data-poi="${category}" class="sda-category-btn" style="background:${visual.color}; justify-content:center;">
            ${iconMarkup(visual.icon, { size: 16 })}<span>${categoryLabel(category)}</span>
          </button>
        `).join('')}
      </div>
      <div data-brand-filter style="display:flex; gap:6px; overflow-x:auto; margin-bottom:8px; padding-bottom:2px;"></div>
    </div>
    <div data-map-wrapper style="position:relative;">
      <div data-map style="height: 48vh; border-radius: var(--sda-radius-md); overflow:hidden;"></div>
      <div style="position:absolute; top:8px; right:8px; z-index:1200; display:flex; flex-direction:column; gap:6px;">
        <button type="button" data-fullscreen-toggle class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('fullscreen', { size: 20 })}</button>
        <button type="button" data-satellite-toggle class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('satellite', { size: 20 })}</button>
        <button type="button" data-tap-route-toggle title="Haritaya dokunarak nokta nokta rota oluştur" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('add-location', { size: 20 })}</button>
        <button type="button" data-offline-region-toggle title="Bu bölgeyi çevrimdışı kullanım için indir" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">${iconMarkup('download', { size: 20 })}</button>
      </div>
      <div data-tap-route-controls style="display:none; position:absolute; bottom:8px; left:8px; right:8px; z-index:1200; gap:8px;">
        <button type="button" data-tap-route-undo class="sda-nav-btn" style="flex:1; background:var(--sda-bg-elevated); box-shadow:var(--sda-shadow-elevated);">Son Noktayı Sil</button>
        <button type="button" data-tap-route-clear class="sda-nav-btn" style="flex:1; background:var(--sda-danger-soft); box-shadow:var(--sda-shadow-elevated);">Tümünü Temizle</button>
      </div>
    </div>
    <p data-status class="sda-card__label" style="margin-top:8px;"></p>
    <button type="button" data-open-google-maps class="sda-nav-btn" style="display:none; width:100%; margin-top:8px; background:var(--sda-accent-soft); flex-direction:row; justify-content:center; gap:8px;">
      ${iconMarkup('map', { size: 18 })}<span>Google Haritalar'da Yol Tarifi Al</span>
    </button>
    <div data-route-summary class="sda-card sda-card--elevated" style="display:none; margin-top:8px;">
      <p data-route-destination class="sda-card__label" style="margin:0 0 4px 0;">--</p>
      <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:8px;">
        <span data-route-duration style="font-family:var(--sda-font-display); font-size:2rem; font-weight:700; color:var(--sda-accent); line-height:1;">--</span>
        <span data-route-distance style="font-size:1rem; color:var(--sda-text-muted);">--</span>
        <span style="color:var(--sda-text-faint);">·</span>
        <span data-route-eta style="font-size:1rem; color:var(--sda-text-muted);">--</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--sda-text-muted);">
        <span data-route-fuel>--</span>
        <span data-route-alternatives>--</span>
      </div>
    </div>
    <div data-gps-detail style="margin-top:8px;"></div>
    <div data-poi-list style="margin-top:8px;"></div>
    <div data-price-table style="margin-top:16px;"></div>
  `;

  const mapElement = container.querySelector('[data-map]');
  if (!mapElement) {
    logWarn('navigation-view', 'Harita elementi bulunamadı');
    return;
  }

  map = L.map(mapElement, { center: DEFAULT_CENTER, zoom: 6, zoomControl: true, attributionControl: true });
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap katkıda bulunanlar', maxZoom: 19, crossOrigin: true,
  }).addTo(map);

  streetLayer.on('tileerror', () => {
    const statusEl = container.querySelector('[data-status]');
    if (statusEl && !statusEl.textContent) statusEl.textContent = 'Harita karoları yüklenemedi. İnternet bağlantınızı kontrol edin.';
  });

  const resizeMap = () => { try { map?.invalidateSize(true); } catch {} };
  requestAnimationFrame(resizeMap);
  setTimeout(resizeMap, 100);
  setTimeout(resizeMap, 350);
  setTimeout(resizeMap, 800);

  bindSatelliteToggle(container, map, streetLayer);
  onPosition(updateVehicleMarker);
  const last = getLastPosition();
  if (last) updateVehicleMarker(last);
  void ensureGpsTracking();

  bindQuickNavButtons(container);
  bindFavoritePickerButtons(container);
  bindLocateButton(container);
  bindPoiButtons(container);
  bindMapClickForFavoriteSelection(container);

  activeCategory = 'fuel';
  const initialFuelCache = getFuelStationCache();
  if (isFuelCacheRelevant(initialFuelCache, last) && (initialFuelCache.stations.length > 0 || initialFuelCache.prices.length > 0)) {
    renderFuelPanel({ map, container, results: initialFuelCache.stations, prices: initialFuelCache.prices, location: initialFuelCache.location, fetchedAt: initialFuelCache.fetchedAt });
  } else if (last && initialFuelCache.fetchedForPosition) {
    void forceRefreshFuelStationCache();
  }

  const gpsDetailContainer = container.querySelector('[data-gps-detail]');
  if (gpsDetailContainer) mountGpsDetailCard(gpsDetailContainer);

  bindLiveSpeedLimitCard(container);
  bindFullscreenToggle(container, map);
  bindTapRouteMode(container, map);

  container.querySelector('[data-offline-region-toggle]')?.addEventListener('click', () => openOfflineRegionPanel(map));
  container.querySelector('[data-address-search]')?.addEventListener('click', () => openAddressSearchModal(map, container));
  container.querySelector('[data-open-google-maps-general]')?.addEventListener('click', () => {
    const current = getLastPosition();
    const center = current ? [current.latitude, current.longitude] : DEFAULT_CENTER;
    void openGoogleMapsGeneral(center[0], center[1]);
  });

  registerRefreshHandler('navigation', () => forceRefreshFuelStationCache());
  onViewChange((viewName) => {
    if (viewName === 'navigation' && map) requestAnimationFrame(() => map.invalidateSize());
  });
}

function categoryLabel(category) {
  const labels = { fuel: 'Yakıt', parking: 'Otopark', service: 'Servis', hospital: 'Hastane' };
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

function bindQuickNavButtons(container) {
  container.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-quick');
      const label = id === 'home' ? 'Ev' : 'İş';
      const favorite = getFavoriteLocation(id);
      const statusEl = container.querySelector('[data-status]');
      if (!favorite) {
        if (statusEl) statusEl.textContent = `${label} konumu henüz ayarlanmadı. Önce "${label}i Ayarla" düğmesine dokunup haritada bir nokta seçin.`;
        return;
      }
      await drawRouteTo(map, favorite, container);
    });
  });
}

function bindFavoritePickerButtons(container) {
  container.querySelectorAll('[data-set-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-set-favorite');
      const label = id === 'home' ? 'Ev' : 'İş';
      pendingFavoriteSelection = id;
      const statusEl = container.querySelector('[data-status]');
      if (statusEl) statusEl.textContent = `Haritada ${label.toLowerCase()} olarak kaydetmek istediğin noktaya dokun.`;
    });
  });
}

function bindMapClickForFavoriteSelection(container) {
  map.on('click', async (event) => {
    if (!pendingFavoriteSelection) return;
    const id = pendingFavoriteSelection;
    const label = id === 'home' ? 'Ev' : 'İş';
    const { lat, lng } = event.latlng;
    await setFavoriteLocation({ id, label, lat, lon: lng });
    pendingFavoriteSelection = null;
    if (favoritePickerMarker) map.removeLayer(favoritePickerMarker);
    favoritePickerMarker = L.marker([lat, lng]).addTo(map).bindPopup(`${label} olarak kaydedildi`).openPopup();
    const statusEl = container.querySelector('[data-status]');
    if (statusEl) statusEl.textContent = `${label} konumu kaydedildi.`;
  });
}

function bindLocateButton(container) {
  container.querySelector('[data-locate]')?.addEventListener('click', () => {
    const current = getLastPosition();
    const statusEl = container.querySelector('[data-status]');
    if (!current) {
      if (statusEl) statusEl.textContent = 'Konum henüz alınamadı. GPS sinyali bekleniyor...';
      return;
    }
    map.setView([current.latitude, current.longitude], 16);
    if (statusEl) statusEl.textContent = '';
  });
}

function bindPoiButtons(container) {
  container.querySelectorAll('[data-poi]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = button.getAttribute('data-poi');
      activeCategory = category;
      const current = getLastPosition();
      const statusEl = container.querySelector('[data-status]');
      const listEl = container.querySelector('[data-poi-list]');
      const priceTableEl = container.querySelector('[data-price-table]');
      const filterEl = container.querySelector('[data-brand-filter]');
      if (priceTableEl) priceTableEl.innerHTML = '';
      if (filterEl) filterEl.innerHTML = '';

      if (category === 'fuel') {
        poiMarkers.forEach((m) => map.removeLayer(m));
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
          renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location, fetchedAt: cached.fetchedAt });
          const ageMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
          const ageText = ageMinutes > 0 ? `${ageMinutes} dk önce güncellendi` : 'az önce güncellendi';
          const priceNote = cached.prices.length > 0 ? '' : ' · fiyat verisi henüz gelmedi, birazdan otomatik tekrar denenecek';
          if (statusEl) statusEl.textContent += ` (${ageText}${priceNote})`;
          return;
        }
        if (statusEl) statusEl.textContent = cached.fetchedForPosition
          ? 'Konum değişti, yakındaki istasyonlar güncelleniyor...'
          : 'İlk kez aranıyor (bir dahaki sefere anında gelecek)...';
        void forceRefreshFuelStationCache();
      } else if (statusEl) {
        statusEl.textContent = 'Aranıyor...';
      }
      if (listEl) listEl.innerHTML = '';

      let results = await findNearbyPoi(category, current.latitude, current.longitude, 7000);
      if (results.length === 0) {
        if (statusEl) statusEl.textContent = 'Yakında bulunamadı, arama genişletiliyor...';
        results = await findNearbyPoi(category, current.latitude, current.longitude, 20000);
      }

      if (category === 'fuel') {
        const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
        const prices = location ? await getFuelPrices(location.il, location.ilce, current.longitude) : [];
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
    renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location, fetchedAt: cached.fetchedAt });
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
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderPoiMarkersAndList(results, listEl, statusEl, category) {
  poiMarkers.forEach((m) => map.removeLayer(m));
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
    const bounds = L.latLngBounds(results.slice(0, 15).map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }

  if (statusEl) {
    const isOffline = results.length > 0 && results.every((p) => p.isOffline);
    const offlineNote = isOffline ? ' · çevrimdışı önbellekten (indirildiği tarihten sonraki değişiklikler yansımaz)' : '';
    statusEl.textContent = results.length > 0
      ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km${offlineNote}`
      : 'Bu bölgede OpenStreetMap üzerinde kayıtlı sonuç bulunamadı.';
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
      const index = Number(row.getAttribute('data-poi-row'));
      const marker = poiMarkers[index];
      if (!marker) return;
      map.setView(marker.getLatLng(), 16);
      marker.openPopup();
    });
  });
}
