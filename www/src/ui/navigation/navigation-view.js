/**
 * navigation-view.js
 * ---------------------------------------------------------------------------
 * Smart Drive AI - Navigasyon V1
 *
 * V1 hedefleri:
 *  - GPS konumunu canlı izlemek
 *  - Koyu/açık temaya uyumlu harita kabuğu
 *  - OSM tabanlı interaktif harita
 *  - Kullanıcının doğrudan başlattığı adres araması
 *  - Favoriler ve son hedefler
 *  - Mevcut konuma dön
 *
 * Not:
 *  - OSM standart tile sunucusu yalnızca aktif görüntüleme için kullanılır.
 *  - Offline harita indirme bu sürümde YOKTUR. OSMF politikası gereği
 *    tile.openstreetmap.org üzerinden önceden tile indirmek yasaktır.
 *  - Offline V2 için self-hosted / offline izinli vector tile paketi gerekir.
 */

import './navigation.css';
import {
  addFavorite,
  addRecentDestination,
  getNavigationState,
  onNavigationStateChange,
  removeFavorite,
} from './navigation-store.js';
import {
  centerOnCurrentLocation,
  onLocationChange,
  startLocationTracking,
  stopLocationTracking,
} from './navigation-location.js';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let leafletPromise = null;
let map = null;
let userMarker = null;
let accuracyCircle = null;
let destinationMarker = null;
let routeLine = null;
let mounted = false;
let unsubscribeLocation = null;
let unsubscribeStore = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Harita motoru yüklenemedi.'));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

function icon(symbol) {
  return `<span class="sda-nav__quick-icon">${symbol}</span>`;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function searchNominatim(query) {
  // Kullanıcı tarafından doğrudan başlatılan tekil arama.
  // Otomatik tamamlama/polling yapılmaz.
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'tr');

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) throw new Error('Adres araması başarısız.');
  return response.json();
}

function renderSearchResults(container, results) {
  if (!results.length) {
    container.innerHTML = '<div class="sda-nav__result">Sonuç bulunamadı.</div>';
    container.style.display = 'block';
    return;
  }

  container.innerHTML = results.map((item, index) => `
    <button type="button" class="sda-nav__result" data-search-index="${index}">
      ${escapeHtml(item.display_name.split(',').slice(0, 2).join(', '))}
      <small>${escapeHtml(item.display_name)}</small>
    </button>
  `).join('');

  container.style.display = 'block';

  container.querySelectorAll('[data-search-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = results[Number(button.dataset.searchIndex)];
      setDestination({
        name: item.display_name.split(',').slice(0, 2).join(', '),
        lat: Number(item.lat),
        lon: Number(item.lon),
      });
      container.style.display = 'none';
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createMap(L, container) {
  if (map) return;

  map = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
  }).setView([39.0, 35.0], 6);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    crossOrigin: true,
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const attribution = document.createElement('div');
  attribution.className = 'sda-nav__attribution';
  attribution.innerHTML = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> katkıda bulunanlar';
  container.parentElement.appendChild(attribution);
}

function updateUserMarker(L, location) {
  if (!map) return;

  const latLng = [location.lat, location.lon];

  if (!userMarker) {
    userMarker = L.circleMarker(latLng, {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#ff4d4d',
      fillOpacity: 1,
    }).addTo(map);
  } else {
    userMarker.setLatLng(latLng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: Math.max(location.accuracy || 0, 8),
      color: '#ff4d4d',
      weight: 1,
      fillColor: '#ff4d4d',
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(Math.max(location.accuracy || 0, 8));
  }
}

function setDestination(place) {
  if (!map || !window.L) return;

  if (destinationMarker) map.removeLayer(destinationMarker);
  if (routeLine) map.removeLayer(routeLine);

  destinationMarker = window.L.marker([place.lat, place.lon]).addTo(map)
    .bindPopup(`<strong>${escapeHtml(place.name)}</strong>`)
    .openPopup();

  const current = userMarker?.getLatLng();
  if (current) {
    const start = { lat: current.lat, lon: current.lng };
    const meters = distanceMeters(start, place);

    routeLine = window.L.polyline(
      [[start.lat, start.lon], [place.lat, place.lon]],
      { color: '#ff4d4d', weight: 5, opacity: 0.85, dashArray: '10 8' },
    ).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });

    const routePanel = document.querySelector('[data-nav-route]');
    if (routePanel) {
      routePanel.style.display = 'flex';
      routePanel.innerHTML = `
        <div>
          <strong>${formatDistance(meters)}</strong>
          <span>Doğrudan mesafe · Rota motoru V2'de eklenecek</span>
        </div>
        <button type="button" class="sda-btn sda-btn--primary" data-nav-start>Başlat</button>
      `;
      routePanel.querySelector('[data-nav-start]')?.addEventListener('click', () => {
        addRecentDestination(place);
        routePanel.querySelector('strong').textContent = 'Navigasyon hazır';
        routePanel.querySelector('span').textContent = 'Gerçek yol rotası V2 rota motoruyla hesaplanacak.';
      });
    }
  } else {
    map.setView([place.lat, place.lon], 15);
  }
}

function renderQuick(container) {
  const state = getNavigationState();
  const favorites = state.favorites.slice(0, 4);

  const buttons = [
    { key: 'location', icon: '📍', label: 'Konumum' },
    { key: 'home', icon: '🏠', label: 'Ev' },
    { key: 'school', icon: '🏫', label: 'Okul' },
    { key: 'favorites', icon: '⭐', label: 'Favoriler' },
  ];

  container.innerHTML = buttons.map((item) => `
    <button type="button" data-nav-quick="${item.key}">
      ${icon(item.icon)}
      <span class="sda-nav__quick-label">${item.label}</span>
    </button>
  `).join('');

  container.querySelector('[data-nav-quick="location"]')?.addEventListener('click', async () => {
    try {
      const position = await centerOnCurrentLocation();
      map?.setView([position.lat, position.lon], 16, { animate: true });
    } catch {
      setStatus('GPS konumu alınamadı.');
    }
  });

  container.querySelector('[data-nav-quick="favorites"]')?.addEventListener('click', () => {
    const first = state.favorites[0];
    if (first) setDestination(first);
    else setStatus('Henüz favori konum yok.');
  });

  // Ev/Okul için gelecekte ayrı sabit hedef ayarları kullanılacak.
  container.querySelector('[data-nav-quick="home"]')?.addEventListener('click', () => {
    const home = state.favorites.find((x) => x.name === 'Ev');
    home ? setDestination(home) : setStatus('Favorilerden "Ev" konumu ekleyin.');
  });

  container.querySelector('[data-nav-quick="school"]')?.addEventListener('click', () => {
    const school = state.favorites.find((x) => x.name === 'Okul');
    school ? setDestination(school) : setStatus('Favorilerden "Okul" konumu ekleyin.');
  });

  void favorites;
}

function setStatus(text) {
  const el = document.querySelector('[data-nav-status]');
  if (el) el.textContent = text;
}

function bindEvents(root) {
  const form = root.querySelector('[data-nav-search-form]');
  const input = root.querySelector('[data-nav-search]');
  const results = root.querySelector('[data-nav-results]');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input?.value?.trim();
    if (!query) return;

    setStatus('Adres aranıyor...');
    try {
      const found = await searchNominatim(query);
      renderSearchResults(results, found);
      setStatus(`${found.length} sonuç bulundu.`);
    } catch (error) {
      setStatus(error?.message || 'Adres araması başarısız.');
    }
  });

  root.querySelector('[data-nav-locate]')?.addEventListener('click', async () => {
    try {
      const location = await centerOnCurrentLocation();
      map?.setView([location.lat, location.lon], 16, { animate: true });
      setStatus(`Konum doğruluğu ±${Math.round(location.accuracy || 0)} m`);
    } catch {
      setStatus('GPS izni gerekli.');
    }
  });

  root.querySelector('[data-nav-save]')?.addEventListener('click', () => {
    if (!userMarker) {
      setStatus('Önce mevcut konumunuzu alın.');
      return;
    }
    const p = userMarker.getLatLng();
    const name = window.prompt('Favori adı:', 'Favori konum');
    if (!name?.trim()) return;
    addFavorite({ name: name.trim(), lat: p.lat, lon: p.lng });
    setStatus('Favori konum kaydedildi.');
  });

  root.querySelector('[data-nav-results-close]')?.addEventListener('click', () => {
    if (results) results.style.display = 'none';
  });
}

export async function initNavigationView() {
  const view = document.querySelector('[data-view="navigation"]');
  if (!view || mounted) return;

  mounted = true;

  view.innerHTML = `
    <section class="sda-nav">
      <div class="sda-nav__top">
        <form class="sda-nav__search" data-nav-search-form>
          <span aria-hidden="true">🔍</span>
          <input data-nav-search type="search" autocomplete="off"
                 placeholder="Nereye gitmek istiyorsun?">
          <button type="submit" class="sda-btn sda-btn--primary">Ara</button>
          <div class="sda-nav__results" data-nav-results></div>
        </form>
        <button type="button" class="sda-btn sda-btn--ghost"
                data-nav-locate title="Konumumu bul">📍</button>
      </div>

      <div class="sda-nav__map">
        <div id="sda-navigation-map"></div>
        <div class="sda-nav__map-controls">
          <button type="button" data-nav-locate aria-label="Konumuma git">◎</button>
          <button type="button" data-nav-save aria-label="Konumu favorilere ekle">☆</button>
        </div>
      </div>

      <div class="sda-nav__bottom">
        <div class="sda-nav__status">
          <strong>🧭 NAVİGASYON</strong>
          <span data-nav-status>GPS bekleniyor...</span>
        </div>
        <div class="sda-nav__quick" data-nav-quick-list></div>
        <div class="sda-nav__route" data-nav-route></div>
      </div>
    </section>
  `;

  bindEvents(view);
  renderQuick(view.querySelector('[data-nav-quick-list]'));

  try {
    const L = await loadLeaflet();
    createMap(L, view.querySelector('#sda-navigation-map'));

    unsubscribeLocation = onLocationChange((location, error) => {
      if (error) {
        setStatus('GPS izni verin.');
        return;
      }
      updateUserMarker(L, location);
      setStatus(`GPS ±${Math.round(location.accuracy || 0)} m`);

      if (map && !map.__sdaCenteredOnce) {
        map.setView([location.lat, location.lon], 15);
        map.__sdaCenteredOnce = true;
      }
    });

    unsubscribeStore = onNavigationStateChange(() => renderQuick(view.querySelector('[data-nav-quick-list]')));
    startLocationTracking();
  } catch (error) {
    setStatus(error?.message || 'Harita motoru başlatılamadı.');
  }
}

export function destroyNavigationView() {
  mounted = false;
  unsubscribeLocation?.();
  unsubscribeStore?.();
  unsubscribeLocation = null;
  unsubscribeStore = null;
  stopLocationTracking();

  if (map) {
    map.remove();
    map = null;
  }

  userMarker = null;
  accuracyCircle = null;
  destinationMarker = null;
  routeLine = null;
}
