/**
 * navigation-view.js
 * ---------------------------------------------------------------------------
 * Navigasyon ekranı: canlı konum/pusula, ev/iş konumu SEÇME ve rota çizimi,
 * "konumumu bul", yakındaki otopark/akaryakıt/servis/hastane arama.
 *
 * Harita: Leaflet. Rota: route-service.js (OSRM). POI: poi-search.js.
 * Favoriler: favorites-store.js. Konum: core/gps-tracker.js (paylaşılan).
 *
 * DÜZELTME: Önceki sürümde "Eve Git" ilk dokunuşta SESSİZCE mevcut konumu
 * ev olarak kaydediyordu - bu, kullanıcının haritada GERÇEKTEN istediği
 * noktayı seçmesine izin vermiyordu. Artık "Evi Ayarla"/"İşi Ayarla"
 * düğmeleriyle haritada istediğin noktaya dokunarak açıkça seçiyorsun.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { onPosition, getLastPosition, ensureGpsTracking } from '../core/gps-tracker.js';
import { onViewChange } from '../core/view-router.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { findNearbyPoi } from '../maps/poi-search.js';
import { getFavoriteLocation, setFavoriteLocation } from '../maps/favorites-store.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices, matchStationByName } from '../maps/fuel-price-service.js';
import { iconMarkup } from './icons.js';
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

/** @type {import('leaflet').Marker|null} */
let favoritePickerMarker = null;

/** @type {boolean} Harita ilk konum geldiğinde bir kez ortalanır, sonra kullanıcı serbestçe gezdirebilir. */
let hasAutoCentered = false;

/** @type {'home'|'work'|null} Şu an haritada nokta seçme modunda mıyız (hangi favori için). */
let pendingFavoriteSelection = null;

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
      <button type="button" data-quick="home" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex-direction:row; gap:4px;">${iconMarkup('home', { size: 16 })}<span>Eve Git</span></button>
      <button type="button" data-quick="work" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex-direction:row; gap:4px;">${iconMarkup('work', { size: 16 })}<span>İşe Git</span></button>
      <button type="button" data-locate class="sda-nav-btn" style="background:var(--sda-bg-elevated); flex-direction:row; gap:4px;">${iconMarkup('location', { size: 16 })}<span>Konumumu Bul</span></button>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
      <button type="button" data-set-favorite="home" class="sda-nav-btn" style="background:var(--sda-bg-elevated); font-size:0.65rem;">Evi Ayarla</button>
      <button type="button" data-set-favorite="work" class="sda-nav-btn" style="background:var(--sda-bg-elevated); font-size:0.65rem;">İşi Ayarla</button>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
      <button type="button" data-poi="fuel" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Yakıt</button>
      <button type="button" data-poi="parking" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Otopark</button>
      <button type="button" data-poi="service" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Servis</button>
      <button type="button" data-poi="hospital" class="sda-nav-btn" style="background:var(--sda-bg-elevated);">Hastane</button>
    </div>
    <div data-map style="height: 55vh; border-radius: var(--sda-radius-md); overflow:hidden;"></div>
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

  // Harita ekranı araca bağlı olunmasa bile konum kullanır - izni burada iste.
  void ensureGpsTracking();

  bindQuickNavButtons(container);
  bindFavoritePickerButtons(container);
  bindLocateButton(container);
  bindPoiButtons(container);
  bindMapClickForFavoriteSelection(container);

  // KRİTİK: Bu harita, uygulama açılışında (Panel varsayılan sekme olduğu
  // için Harita o an GİZLİ/hidden durumdayken) oluşturuluyor. Leaflet,
  // gizli bir kapsayıcının gerçek boyutunu ÖLÇEMEZ, bu yüzden haritayı
  // yanlış (genelde ekranın sol üst köşesine sıkışmış) boyutta çizer.
  // Kullanıcı Harita sekmesine her girdiğinde map.invalidateSize() çağırıp
  // Leaflet'e "artık görünürsün, boyutunu yeniden ölç" demek gerekir.
  onViewChange((viewName) => {
    if (viewName === 'navigation' && map) {
      requestAnimationFrame(() => map.invalidateSize());
    }
  });
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
 * "Eve Git" / "İşe Git" düğmelerini bağlar. Favori tanımlı değilse artık
 * SESSİZCE mevcut konumu ATAMAZ - kullanıcıyı "Evi/İşi Ayarla" düğmesine yönlendirir.
 * @param {HTMLElement} container
 */
function bindQuickNavButtons(container) {
  container.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-quick');
      const label = id === 'home' ? 'Ev' : 'İş';
      const favorite = getFavoriteLocation(id);
      const statusEl = container.querySelector('[data-status]');

      if (!favorite) {
        if (statusEl) {
          statusEl.textContent = `${label} konumu henüz ayarlanmadı. Önce "${label}i Ayarla" düğmesine dokunup haritada bir nokta seçin.`;
        }
        return;
      }

      await drawRouteTo(favorite, container);
    });
  });
}

/**
 * "Evi Ayarla" / "İşi Ayarla" düğmelerini bağlar - basınca haritayı "nokta
 * seçme" moduna alır, kullanıcının bir sonraki harita dokunuşu o favoriyi kaydeder.
 * @param {HTMLElement} container
 */
function bindFavoritePickerButtons(container) {
  container.querySelectorAll('[data-set-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-set-favorite');
      const label = id === 'home' ? 'Ev' : 'İş';
      pendingFavoriteSelection = id;

      const statusEl = container.querySelector('[data-status]');
      if (statusEl) {
        statusEl.textContent = `Haritada ${label.toLowerCase()} olarak kaydetmek istediğin noktaya dokun.`;
      }
    });
  });
}

/**
 * Haritaya tıklama olayını dinler; "seçim modu" açıksa tıklanan noktayı
 * ilgili favoriye kaydeder.
 * @param {HTMLElement} container
 */
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

/**
 * "Konumumu Bul" düğmesini bağlar - haritayı anlık konuma ortalar/yakınlaştırır.
 * @param {HTMLElement} container
 */
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
 * Yakındaki POI düğmelerini bağlar. Sonuç boşsa arama yarıçapını genişletip
 * bir kez daha dener (özellikle "Hastane" gibi seyrek bulunan kategoriler
 * için ilk denemede sonuç bulunamama şikayetini gidermek için).
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

      let results = await findNearbyPoi(category, current.latitude, current.longitude, 7000);
      if (results.length === 0) {
        // İlk denemede sonuç yoksa yarıçapı genişletip bir kez daha dene -
        // özellikle hastane gibi seyrek kategori için yaygın şikayeti giderir.
        if (statusEl) statusEl.textContent = 'Yakında bulunamadı, arama genişletiliyor...';
        results = await findNearbyPoi(category, current.latitude, current.longitude, 20000);
      }

      // "Yakıt" kategorisinde, konumun il/ilçesine göre GÜNCEL FİYAT
      // LİSTESİNİ çekip her istasyonun markasıyla eşleştirmeyi dener.
      let fuelPricesByStation = null;
      if (category === 'fuel' && results.length > 0) {
        const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
        if (location) {
          const stations = await getFuelPrices(location.il, location.ilce, current.longitude);
          fuelPricesByStation = new Map(
            results.map((poi) => [poi, matchStationByName(stations, poi.brand ?? poi.name)]),
          );
        }
      }

      poiMarkers.forEach((m) => map.removeLayer(m));
      poiMarkers = results.slice(0, 15).map((poi) => {
        const price = fuelPricesByStation?.get(poi);
        const priceLine = price
          ? `<br>Benzin: ${price.benzin ?? '-'} ₺ · Motorin: ${price.motorin ?? '-'} ₺${price.lpg ? ` · LPG: ${price.lpg} ₺` : ''}`
          : '';
        return L.marker([poi.lat, poi.lon])
          .bindPopup(`${poi.name} (${poi.distanceKm.toFixed(1)} km)${priceLine}`)
          .addTo(map);
      });

      if (results.length > 0) {
        const bounds = L.latLngBounds(results.slice(0, 15).map((p) => [p.lat, p.lon]));
        map.fitBounds(bounds, { padding: [32, 32] });
      }

      if (statusEl) {
        statusEl.textContent = results.length > 0
          ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km. Fiyat için işaretçiye dokun.`
          : 'Bu bölgede OpenStreetMap üzerinde kayıtlı sonuç bulunamadı.';
      }
    });
  });
}
