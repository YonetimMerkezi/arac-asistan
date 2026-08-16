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
import { findNearbyPoi } from '../maps/poi-search.js';
import { getFavoriteLocation, setFavoriteLocation } from '../maps/favorites-store.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { drawRouteTo, openGoogleMapsGeneral } from './navigation-route-panel.js';
import { bindLiveSpeedLimitCard, bindFullscreenToggle, bindSatelliteToggle, renderVehicleMarker } from './navigation-map-overlay.js';
import { offlineTileLayer } from '../maps/offline-tile-layer.js';
import { openOfflineRegionPanel } from './offline-region-panel.js';
import { bindTapRouteMode } from './navigation-tap-route.js';
import { openAddressSearchModal } from './components/address-search-modal.js';
import { getFuelStationCache, onFuelStationCacheUpdate, forceRefreshFuelStationCache } from '../maps/fuel-station-cache.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { renderFuelPanel, clearFuelPanel } from './navigation-fuel-panel.js';
import { mountGpsDetailCard } from './components/gps-detail-card.js';
import { iconMarkup } from './icons.js';
import { logWarn } from '../core/logger.js';
import { onGuidanceEvent, stopGuidance } from '../maps/turn-by-turn.js';

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
    <div data-navigation-hud class="sda-navigation-hud" aria-live="polite">
      <div class="sda-navigation-hud__top">
        <span class="sda-navigation-hud__arrow" data-nav-turn-arrow>↑</span>
        <div class="sda-navigation-hud__instruction">
          <strong data-nav-instruction>Rota hazır</strong>
          <span data-nav-step-distance>--</span>
        </div>
        <button type="button" data-stop-guidance class="sda-navigation-hud__close" aria-label="Navigasyonu durdur">×</button>
      </div>
      <div class="sda-navigation-hud__stats">
        <div><strong data-nav-remaining>--</strong><span>KALAN</span></div>
        <div><strong data-nav-eta>--</strong><span>VARIŞ</span></div>
        <div><strong data-nav-status>Hazır</strong><span>DURUM</span></div>
      </div>
      <div class="sda-navigation-hud__fuel" data-nav-fuel>⛽ Yakıt tahmini hazırlanıyor…</div>
    </div>

      <div style="position:absolute; top:8px; right:8px; z-index:1200; display:flex; flex-direction:column; gap:6px;">
        <button type="button" data-fullscreen-toggle class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">
          ${iconMarkup('fullscreen', { size: 20 })}
        </button>
        <button type="button" data-satellite-toggle class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">
          ${iconMarkup('satellite', { size: 20 })}
        </button>
        <button type="button" data-tap-route-toggle title="Haritaya dokunarak nokta nokta rota oluştur" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">
          ${iconMarkup('add-location', { size: 20 })}
        </button>
        <button type="button" data-offline-region-toggle title="Bu bölgeyi çevrimdışı kullanım için indir" class="sda-nav-btn" style="background:var(--sda-bg-elevated); padding:8px; box-shadow:var(--sda-shadow-elevated);">
          ${iconMarkup('download', { size: 20 })}
        </button>
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

  map = L.map(container.querySelector('[data-map]')).setView(DEFAULT_CENTER, 6);

  // DÜZELTME: Harita bazen kısmen GRİ/BOŞ görünüyordu - Leaflet, konteynerin
  // boyutunu SAYFA DÜZENİ TAM OTURMADAN ÖNCE ölçüyordu (üstteki yeni harita
  // düğmeleri sayfanın toplam yüksekliğini değiştirdiği için), bu yüzden
  // döşeme (tile) ızgarasını olduğundan küçük hesaplayıp kenarları boş
  // bırakıyordu. Düzen kesinlikle oturduktan sonra yeniden ölçmeye
  // ZORLANIYOR.
  setTimeout(() => map?.invalidateSize(), 200);
  setTimeout(() => map?.invalidateSize(), 600);

  const streetLayer = offlineTileLayer({
    attribution: '© OpenStreetMap katkıda bulunanlar',
    maxZoom: 19,
  }).addTo(map);

  bindSatelliteToggle(container, map, streetLayer);

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

  // Yakıt fiyatları artık kullanıcı "Yakıt" düğmesine dokunmadan, harita
  // açılır açılmaz haritanın altında görünsün isteniyor. Önbellek
  // (fuel-station-cache.js, uygulama açılışında zaten arka planda
  // dolduruluyor) o an doluysa hemen gösterilir; henüz boşsa
  // onFuelStationCacheUpdate dinleyicisi (aşağıda, activeCategory === 'fuel'
  // kontrolüyle) ilk dolduğunda otomatik devreye girer.
  activeCategory = 'fuel';
  const initialFuelCache = getFuelStationCache();
  if (initialFuelCache.stations.length > 0 || initialFuelCache.prices.length > 0) {
    renderFuelPanel({ map, container, results: initialFuelCache.stations, prices: initialFuelCache.prices, location: initialFuelCache.location, fetchedAt: initialFuelCache.fetchedAt });
  }

  const gpsDetailContainer = container.querySelector('[data-gps-detail]');
  if (gpsDetailContainer) mountGpsDetailCard(gpsDetailContainer);

  bindLiveSpeedLimitCard(container);
  bindFullscreenToggle(container, map);
  bindTapRouteMode(container, map);

  const guidanceOff = onGuidanceEvent((type, detail) => {
    const hud = container.querySelector('[data-navigation-hud]');
    if (!hud) return;
    const instruction = container.querySelector('[data-nav-instruction]');
    const stepDistance = container.querySelector('[data-nav-step-distance]');
    const remaining = container.querySelector('[data-nav-remaining]');
    const eta = container.querySelector('[data-nav-eta]');
    const status = container.querySelector('[data-nav-status]');
    const arrow = container.querySelector('[data-nav-turn-arrow]');

    if (type === 'started' || type === 'rerouted' || type === 'step') {
      hud.classList.add('is-active');
      const step = detail.step ?? detail.route?.steps?.[0] ?? detail.nextStep;
      if (instruction && step?.instruction) instruction.textContent = step.instruction;
      if (status) status.textContent = type === 'rerouted' ? 'Yeni rota' : 'Navigasyon';
      if (arrow) arrow.textContent = maneuverArrow(step?.instruction);
    } else if (type === 'progress') {
      hud.classList.add('is-active');
      if (instruction && detail.step?.instruction) instruction.textContent = detail.step.instruction;
      if (stepDistance && Number.isFinite(detail.distanceToStepMeters)) stepDistance.textContent = `${Math.max(0, Math.round(detail.distanceToStepMeters))} m`;
      if (remaining && detail.routeDistanceMeters != null) remaining.textContent = `${Math.max(0, (detail.routeDistanceMeters / 1000)).toFixed(1).replace('.', ',')} km`;
      if (eta && detail.routeDistanceMeters != null) {
        const kmh = Math.max(25, detail.position?.speedKmh || 50);
        const mins = Math.max(1, Math.round((detail.routeDistanceMeters / 1000) / kmh * 60));
        eta.textContent = new Date(Date.now() + mins * 60000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      }
    } else if (type === 'rerouting') {
      hud.classList.add('is-active');
      if (instruction) instruction.textContent = 'Rotadan çıktınız, yeni rota hesaplanıyor…';
      if (status) status.textContent = 'Yeniden rota';
    } else if (type === 'arrived' || type === 'stopped') {
      hud.classList.remove('is-active');
      if (instruction) instruction.textContent = type === 'arrived' ? 'Hedefe ulaştınız' : 'Rota durduruldu';
    }
  });

  container.querySelector('[data-stop-guidance]')?.addEventListener('click', () => stopGuidance(true));
  container._sdaGuidanceOff = guidanceOff;

  container.querySelector('[data-offline-region-toggle]')?.addEventListener('click', () => {
    openOfflineRegionPanel(map);
  });

  container.querySelector('[data-address-search]')?.addEventListener('click', () => {
    openAddressSearchModal(map, container);
  });

  container.querySelector('[data-open-google-maps-general]')?.addEventListener('click', () => {
    const current = getLastPosition();
    const center = current ? [current.latitude, current.longitude] : DEFAULT_CENTER;
    void openGoogleMapsGeneral(center[0], center[1]);
  });

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
function maneuverArrow(instruction = '') {
  const t = instruction.toLowerCase();
  if (t.includes('u dönüş')) return '↶';
  if (t.includes('sol')) return '↰';
  if (t.includes('sağ')) return '↱';
  if (t.includes('kavşak') || t.includes('göbek')) return '⟳';
  return '↑';
}

function categoryLabel(category) {
  const labels = { fuel: 'Yakıt', parking: 'Otopark', service: 'Servis', hospital: 'Hastane' };
  return labels[category] ?? category;
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function updateVehicleMarker(position) {
  if (!map) return;
  vehicleMarker = renderVehicleMarker(map, vehicleMarker, position);

  if (!hasAutoCentered) {
    hasAutoCentered = true;
    map.setView([position.latitude, position.longitude], 15);
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

      await drawRouteTo(map, favorite, container);
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
          renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location, fetchedAt: cached.fetchedAt });
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
        renderFuelPanel({ map, container, results, prices, location, fetchedAt: Date.now() });
      } else {
        renderPoiMarkersAndList(results, listEl, statusEl, category);
      }
    });
  });

  // Önbellek arka planda periyodik/konum-tabanlı olarak tazelendiğinde,
  // kullanıcı o an Yakıt sonuçlarını görüyorsa listeyi/fiyatları sessizce güncelle.
  onFuelStationCacheUpdate((cached) => {
    if (activeCategory !== 'fuel') return; // Yakıt sonuçları açık değilse dokunma.
    renderFuelPanel({ map, container, results: cached.stations, prices: cached.prices, location: cached.location, fetchedAt: cached.fetchedAt });
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
    const isOffline = results.length > 0 && results.every((p) => p.isOffline);
    const offlineNote = isOffline ? ' · çevrimdışı önbellekten (indirildiği tarihten sonraki değişiklikler yansımaz)' : '';
    statusEl.textContent = results.length > 0
      ? `${results.length} sonuç bulundu, en yakını ${results[0].distanceKm.toFixed(1)} km${offlineNote}`
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
