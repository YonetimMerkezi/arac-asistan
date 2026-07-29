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
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { estimateAverageConsumption, estimateFuelCost } from '../fuel/route-cost-estimator.js';
import { getFuelStationCache, onFuelStationCacheUpdate, forceRefreshFuelStationCache } from '../maps/fuel-station-cache.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { renderFuelPanel, clearFuelPanel } from './navigation-fuel-panel.js';
import { mountGpsDetailCard } from './components/gps-detail-card.js';
import { iconMarkup } from './icons.js';
import { logWarn } from '../core/logger.js';

/** @type {[number, number]} Konum yokken haritanın açılacağı varsayılan merkez (Türkiye geneli). */
const DEFAULT_CENTER = [39.0, 35.0];

/** @type {Record<string, {icon: string, color: string}>} Kategori düğmesi görseli - "renkli renkli" gereksinimi. */
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

/** @type {import('leaflet').Polyline|null} */
let routeLine = null;

/** @type {import('leaflet').Marker[]} Yalnızca yakıt DIŞI kategorilerin işaretçileri (Yakıt kendi listesini navigation-fuel-panel.js'te tutar). */
let poiMarkers = [];

/** @type {import('leaflet').Marker|null} */
let favoritePickerMarker = null;

/** @type {boolean} Harita ilk konum geldiğinde bir kez ortalanır, sonra kullanıcı serbestçe gezdirebilir. */
let hasAutoCentered = false;

/** @type {'home'|'work'|null} Şu an haritada nokta seçme modunda mıyız (hangi favori için). */
let pendingFavoriteSelection = null;

/** @type {string|null} Şu an aktif kategori ('fuel'|'parking'|'service'|'hospital'|null). */
let activeCategory = null;

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
    <div data-map style="height: 48vh; border-radius: var(--sda-radius-md); overflow:hidden;"></div>
    <p data-status class="sda-card__label" style="margin-top:8px;"></p>
    <div data-gps-detail style="margin-top:8px;"></div>
    <div data-poi-list style="margin-top:8px;"></div>
    <div data-price-table style="margin-top:16px;"></div>
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

  const gpsDetailContainer = container.querySelector('[data-gps-detail]');
  if (gpsDetailContainer) mountGpsDetailCard(gpsDetailContainer);

  // "Kaydırarak yenile" - yakıt istasyonu önbelleğini zorla tazeler; Yakıt
  // kategorisi açıksa mevcut onFuelStationCacheUpdate aboneliği paneli
  // otomatik yeniden çizer (kod tekrarı yok).
  registerRefreshHandler('navigation', () => forceRefreshFuelStationCache());

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
 * @param {string} category
 * @returns {string}
 */
function categoryLabel(category) {
  const labels = { fuel: 'Yakıt', parking: 'Otopark', service: 'Servis', hospital: 'Hastane' };
  return labels[category] ?? category;
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

  void appendRouteFuelCost(statusEl, current, route.distanceKm);
}

/**
 * Rota mesafesine göre yaklaşık yakıt maliyetini hesaplayıp durum satırına
 * ekler - hesaplama bittiğinde eklenir (rota anında görünsün, maliyet
 * hesaplaması ağ isteği gerektirdiği için biraz gecikebilir).
 * @param {HTMLElement|null} statusEl
 * @param {import('../core/gps-tracker.js').LivePosition} current
 * @param {number} distanceKm
 */
async function appendRouteFuelCost(statusEl, current, distanceKm) {
  try {
    const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
    if (!location) return;

    const prices = await getFuelPrices(location.il, location.ilce, current.longitude);
    const withPrice = prices.find((p) => p.benzin !== null);
    if (!withPrice) return;

    const litersPer100Km = await estimateAverageConsumption();
    const { liters, cost } = estimateFuelCost(distanceKm, litersPer100Km, withPrice.benzin);

    if (statusEl) {
      statusEl.textContent += ` · ~${liters.toFixed(1)} L, ~${cost.toFixed(0)} ₺ (yakıt tahmini)`;
    }
  } catch (error) {
    logWarn('navigation-view', 'Rota yakıt maliyeti hesaplanamadı', error);
  }
}

/**
 * Yakındaki POI düğmelerini bağlar. Yakıt kategorisi navigation-fuel-panel.js'e
 * devredilir; diğerleri (otopark/servis/hastane) burada sade işlenir. Sonuç
 * boşsa arama yarıçapını genişletip bir kez daha dener.
 * @param {HTMLElement} container
 */
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

      // Kategori değişince ÖNCEKİ kategorinin işaretçilerini temizle -
      // ikisi ayrı dizilerde tutulduğu için (bkz. dosya başı notu) elle yapılmalı.
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

      // YAKIT: önce ÖNBELLEKTEN anında göster (uygulama açılışından beri
      // arka planda tutulan veri) - "istasyonları çok geç buluyor"
      // şikayetinin çözümü budur. Önbellek henüz doluysa ağ beklenmez.
      if (category === 'fuel') {
        const cached = getFuelStationCache();
        if (cached.stations.length > 0) {
          renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location });
          const ageMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
          const ageText = ageMinutes > 0 ? `${ageMinutes} dk önce güncellendi` : 'az önce güncellendi';
          const priceNote = cached.prices.length > 0 ? '' : ' · fiyat verisi henüz gelmedi, birazdan otomatik tekrar denenecek';
          if (statusEl) statusEl.textContent += ` (${ageText}${priceNote})`;
          return;
        }
        // Önbellek henüz hiç dolmadıysa (ör. açılışta konum çok yeni geldi)
        // bu SEFERLİK canlı arama yap - bir sonraki dokunuşta önbellek hazır olacak.
        if (statusEl) statusEl.textContent = 'İlk kez aranıyor (bir dahaki sefere anında gelecek)...';
      } else {
        if (statusEl) statusEl.textContent = 'Aranıyor...';
      }
      if (listEl) listEl.innerHTML = '';

      let results = await findNearbyPoi(category, current.latitude, current.longitude, 7000);
      if (results.length === 0) {
        // İlk denemede sonuç yoksa yarıçapı genişletip bir kez daha dene -
        // özellikle hastane gibi seyrek kategori için yaygın şikayeti giderir.
        if (statusEl) statusEl.textContent = 'Yakında bulunamadı, arama genişletiliyor...';
        results = await findNearbyPoi(category, current.latitude, current.longitude, 20000);
      }

      if (category === 'fuel') {
        const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
        const prices = location ? await getFuelPrices(location.il, location.ilce, current.longitude) : [];
        renderFuelPanel({ map, container, results, prices, location });
      } else {
        renderPoiMarkersAndList(results, listEl, statusEl, category);
      }
    });
  });

  // Önbellek arka planda periyodik/konum-tabanlı olarak tazelendiğinde,
  // kullanıcı o an Yakıt sonuçlarını görüyorsa listeyi/fiyatları sessizce güncelle.
  onFuelStationCacheUpdate((cached) => {
    if (activeCategory !== 'fuel') return; // Yakıt sonuçları açık değilse dokunma.
    renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location });
  });
}

/**
 * Yakıt DIŞI kategoriler (otopark/servis/hastane) için sade işaretçi + liste -
 * marka/fiyat kavramı olmadığından basit tutulur.
 * @param {import('../maps/poi-search.js').PoiResult[]} results
 * @param {HTMLElement|null} listEl
 * @param {HTMLElement|null} statusEl
 * @param {string} category
 */
function renderPoiMarkersAndList(results, listEl, statusEl, category) {
  poiMarkers.forEach((m) => map.removeLayer(m));
  const visual = CATEGORY_VISUALS[category] ?? { color: '#4FD8E0' };
  poiMarkers = results.slice(0, 15).map((poi) => L.marker([poi.lat, poi.lon], {
    icon: L.divIcon({
      className: 'sda-poi-marker',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${visual.color};border:2px solid white;"></div>`,
      iconSize: [16, 16],
    }),
  })
    .bindPopup(`${poi.name} (${poi.distanceKm.toFixed(1)} km)`)
    .addTo(map));

  renderPoiList(listEl, results.slice(0, 15));

  if (results.length > 0) {
    const bounds = L.latLngBounds(results.slice(0, 15).map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }

  if (statusEl) {
    statusEl.textContent = results.length > 0
      ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km`
      : 'Bu bölgede OpenStreetMap üzerinde kayıtlı sonuç bulunamadı.';
  }
}

/**
 * Sonuçları, en yakından en uzağa doğru haritanın altına bir liste olarak
 * çizer. Bir satıra dokunmak haritayı o noktaya ortalayıp popup'ını açar.
 * (Yalnızca yakıt DIŞI kategoriler için.)
 * @param {HTMLElement|null} listEl
 * @param {import('../maps/poi-search.js').PoiResult[]} results
 */
function renderPoiList(listEl, results) {
  if (!listEl) return;
  if (results.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = results.map((poi, index) => `
    <button type="button" data-poi-row="${index}" class="sda-card" style="display:flex; justify-content:space-between; align-items:center; width:100%; text-align:left; margin-bottom:6px; border:none;">
      <span>
        <span class="sda-card__value" style="font-size:0.95rem;">${poi.name}</span>
      </span>
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
