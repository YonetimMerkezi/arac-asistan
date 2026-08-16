/*
 * SmartDriveAI - Navigation Drive View
 * Robust visible-first initialization.
 */

import { searchAddress } from '../maps/forward-geocode.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { getLastPosition } from '../core/gps-tracker.js';

let navState = {
  map: null,
  marker: null,
  routeLine: null,
  destMarker: null,
  watchId: null,
  ready: false,
  follow: true,
  lastPos: null,
  currentDest: null,
};

function getContainer() {
  return document.getElementById('navigation-drive-map') ||
         document.querySelector('[data-view="navigation-drive"] [data-navigation-map]') ||
         document.querySelector('[data-view="navigation-drive"] .navigation-map') ||
         document.querySelector('[data-view="navigation-drive"] .map-container');
}

function ensureLayout() {
  const view = document.querySelector('[data-view="navigation-drive"]');
  if (!view) return null;

  if (!view.querySelector('.sda-nav-real')) {
    view.innerHTML = `
      <div class="sda-nav-real">
        <div class="sda-nav-top">
          <div>
            <div class="sda-nav-title">🧭 Navigasyon</div>
            <div class="sda-nav-subtitle">Hedef belirleyin ve yola çıkın</div>
          </div>
          <button class="sda-nav-gps" id="sda-nav-gps">◎ Konum</button>
        </div>

        <div class="sda-nav-search">
          <input id="sda-nav-destination" type="search" placeholder="Nereye gidiyorsun?" autocomplete="off">
          <button id="sda-nav-search-btn">Ara</button>
        </div>

        <div id="sda-nav-suggestions" style="display:none; background:var(--sda-bg-elevated,#1c1f26); border-radius:8px; margin-bottom:6px; overflow:hidden; max-height:200px; overflow-y:auto;"></div>

        <div class="sda-nav-map-wrap">
          <div id="navigation-drive-map" class="sda-nav-map"></div>
          <div id="sda-nav-map-loading" class="sda-nav-map-loading">
            <div class="sda-spinner"></div>
            <strong>Harita hazırlanıyor</strong>
            <span>Konum alınıyor…</span>
          </div>
          <button id="sda-nav-follow" class="sda-nav-follow" title="Aracı takip et">◎</button>
        </div>

        <div class="sda-nav-stats">
          <div><span>HIZ</span><strong id="sda-nav-speed">0</strong><small>km/sa</small></div>
          <div><span>MESAFE</span><strong id="sda-nav-distance">—</strong><small>km</small></div>
          <div><span>VARIŞ</span><strong id="sda-nav-eta">—</strong><small>ETA</small></div>
        </div>

        <div class="sda-nav-shortcuts">
          <button data-dest="current">📍 Konumum</button>
          <button data-dest="home">🏠 Ev</button>
          <button data-dest="fuel">⛽ Yakıt</button>
          <button data-dest="hospital">🏥 Hastane</button>
        </div>

        <div id="sda-nav-message" class="sda-nav-message">Navigasyon hazır.</div>
      </div>`;
  }
  return view;
}

function showLoading(show, text = 'Harita hazırlanıyor') {
  const el = document.getElementById('sda-nav-map-loading');
  if (!el) return;
  el.classList.toggle('is-hidden', !show);
  const strong = el.querySelector('strong');
  if (strong) strong.textContent = text;
}

function setMessage(text) {
  const el = document.getElementById('sda-nav-message');
  if (el) el.textContent = text;
}

function setSpeed(v) {
  const el = document.getElementById('sda-nav-speed');
  if (el) el.textContent = Math.round(Number(v) || 0);
}

function setStats(distanceKm, durationMinutes) {
  const distEl = document.getElementById('sda-nav-distance');
  const etaEl = document.getElementById('sda-nav-eta');

  if (distEl) distEl.textContent = distanceKm >= 1
    ? `${distanceKm.toFixed(1)} km`
    : `${Math.round(distanceKm * 1000)} m`;

  if (etaEl) {
    const now = new Date(Date.now() + durationMinutes * 60 * 1000);
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    etaEl.textContent = `${h}:${m}`;
  }
}

function clearStats() {
  const distEl = document.getElementById('sda-nav-distance');
  const etaEl = document.getElementById('sda-nav-eta');
  if (distEl) distEl.textContent = '—';
  if (etaEl) etaEl.textContent = '—';
}

async function getCurrentPosition() {
  // Önce paylaşılan GPS tracker'dan dene (daha hızlı)
  const last = getLastPosition();
  if (last) return { latitude: last.latitude, longitude: last.longitude };

  if (!navigator.geolocation) throw new Error('GPS desteklenmiyor');
  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve(p.coords),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
  });
}

function createMap(coords) {
  if (!window.L) {
    showLoading(false);
    setMessage('Harita motoru yüklenemedi. Leaflet dosyalarını kontrol edin.');
    return false;
  }

  const container = getContainer();
  if (!container) return false;

  if (navState.map) {
    try { navState.map.invalidateSize(true); } catch {}
    return true;
  }

  navState.map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    center: [coords.latitude, coords.longitude],
    zoom: 16
  });

  L.control.zoom({ position: 'bottomleft' }).addTo(navState.map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(navState.map);

  navState.marker = L.marker(
    [coords.latitude, coords.longitude],
    { title: 'Aracınız' }
  ).addTo(navState.map);

  navState.ready = true;
  showLoading(false);
  setMessage('Konumunuz gösteriliyor.');

  requestAnimationFrame(() => {
    setTimeout(() => {
      try {
        navState.map.invalidateSize(true);
        navState.map.setView([coords.latitude, coords.longitude], 16, { animate: false });
      } catch {}
    }, 120);
  });

  return true;
}

function updatePosition(coords) {
  if (!navState.map || !navState.marker || !coords) return;
  navState.lastPos = coords;
  const latlng = [coords.latitude, coords.longitude];
  navState.marker.setLatLng(latlng);

  if (Number.isFinite(coords.speed)) {
    setSpeed(coords.speed * 3.6);
  }

  if (navState.follow) {
    navState.map.panTo(latlng, { animate: true, duration: 0.35 });
  }

  // Rota aktifse mesafe/ETA'yı güncelle
  if (navState.currentDest) {
    updateDistanceToDestination(coords);
  }
}

function updateDistanceToDestination(coords) {
  if (!navState.currentDest || !window.L) return;
  const from = L.latLng(coords.latitude, coords.longitude);
  const to = L.latLng(navState.currentDest.lat, navState.currentDest.lon);
  const distKm = from.distanceTo(to) / 1000;
  // Ortalama 60 km/sa şehir içi hız varsayımı
  const etaMin = (distKm / 60) * 60;
  setStats(distKm, etaMin);
}

async function startGps() {
  if (!navigator.geolocation) return;
  if (navState.watchId != null) navigator.geolocation.clearWatch(navState.watchId);

  navState.watchId = navigator.geolocation.watchPosition(
    p => updatePosition(p.coords),
    () => setMessage('GPS konumu alınamadı. Konum iznini kontrol edin.'),
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 8000 }
  );
}

/**
 * Verilen hedefe rota çizer.
 * @param {{lat: number, lon: number, label: string}} dest
 */
async function routeTo(dest) {
  if (!navState.map) return;

  setMessage('Rota hesaplanıyor…');
  clearStats();

  let from;
  try {
    from = await getCurrentPosition();
  } catch {
    setMessage('Konum alınamadı. GPS iznini kontrol edin.');
    return;
  }

  const routes = await getDrivingRoute(
    { lat: from.latitude, lon: from.longitude },
    { lat: dest.lat, lon: dest.lon },
    { destinationLabel: dest.label }
  );

  if (!routes || routes.length === 0) {
    setMessage('Rota bulunamadı. İnternet bağlantısını kontrol edin.');
    return;
  }

  const best = routes[0];

  // Önceki rota ve hedef işaretçisini temizle
  if (navState.routeLine) {
    navState.map.removeLayer(navState.routeLine);
    navState.routeLine = null;
  }
  if (navState.destMarker) {
    navState.map.removeLayer(navState.destMarker);
    navState.destMarker = null;
  }

  // Rota çizgisini çiz
  navState.routeLine = L.polyline(best.coordinates, {
    color: '#4A90E2',
    weight: 5,
    opacity: 0.85,
  }).addTo(navState.map);

  // Hedef işaretçisi
  navState.destMarker = L.marker([dest.lat, dest.lon])
    .addTo(navState.map)
    .bindPopup(dest.label)
    .openPopup();

  // Rotayı sığdır
  navState.map.fitBounds(navState.routeLine.getBounds(), { padding: [40, 40] });

  navState.currentDest = dest;
  navState.follow = false; // Rota görünürken otomatik takibi kapat

  const distText = best.distanceKm >= 1
    ? `${best.distanceKm.toFixed(1)} km`
    : `${Math.round(best.distanceKm * 1000)} m`;
  const etaMin = Math.round(best.durationMinutes);

  setStats(best.distanceKm, best.durationMinutes);
  setMessage(`${dest.label} · ${distText} · ~${etaMin} dk`);
}

/**
 * Adres arama + rota: Nominatim ile geocode et, ilk sonuca rota çiz.
 * @param {string} query
 */
async function searchAndRoute(query) {
  if (!query) return;

  setMessage('Adres aranıyor…');
  hideSuggestions();

  const results = await searchAddress(query, 5);

  if (results.length === 0) {
    setMessage(`"${query}" için sonuç bulunamadı. Daha ayrıntılı bir adres deneyin.`);
    return;
  }

  if (results.length === 1) {
    // Tek sonuç: direkt rota çiz
    await routeTo({ lat: results[0].lat, lon: results[0].lon, label: results[0].label.split(',')[0] });
    return;
  }

  // Birden fazla sonuç: öneri listesi göster
  showSuggestions(results);
}

function showSuggestions(results) {
  const el = document.getElementById('sda-nav-suggestions');
  if (!el) return;

  el.style.display = 'block';
  el.innerHTML = results.map((r, i) => {
    const short = r.label.split(',').slice(0, 3).join(',');
    return `<button data-suggestion-index="${i}" style="display:block; width:100%; text-align:left; padding:10px 12px; background:none; border:none; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--sda-text-primary,#fff); font-size:0.85rem; cursor:pointer;">${short}</button>`;
  }).join('');

  el.querySelectorAll('[data-suggestion-index]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.getAttribute('data-suggestion-index'));
      hideSuggestions();
      const r = results[i];
      document.getElementById('sda-nav-destination').value = r.label.split(',')[0];
      await routeTo({ lat: r.lat, lon: r.lon, label: r.label.split(',')[0] });
    });
  });
}

function hideSuggestions() {
  const el = document.getElementById('sda-nav-suggestions');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

export async function initNavigationDriveView() {
  const view = ensureLayout();
  if (!view) return;

  showLoading(true);
  setMessage('GPS konumu bekleniyor…');

  const followBtn = document.getElementById('sda-nav-follow');
  followBtn?.addEventListener('click', () => {
    navState.follow = true;
    followBtn.classList.add('is-active');
    if (navState.map && navState.marker) {
      navState.map.panTo(navState.marker.getLatLng(), { animate: true });
    }
  });

  const gpsBtn = document.getElementById('sda-nav-gps');
  gpsBtn?.addEventListener('click', async () => {
    try {
      const c = await getCurrentPosition();
      if (!navState.map) createMap(c);
      updatePosition(c);
      navState.follow = true;
      navState.map?.setView([c.latitude, c.longitude], 16);
    } catch {
      setMessage('Konum alınamadı. Android konum iznini açın.');
    }
  });

  // Ara butonu — artık gerçek geocoding + rota çizimi
  document.getElementById('sda-nav-search-btn')?.addEventListener('click', async () => {
    const q = document.getElementById('sda-nav-destination')?.value?.trim();
    if (q) await searchAndRoute(q);
  });

  // Enter tuşu desteği
  document.getElementById('sda-nav-destination')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = e.target.value?.trim();
      if (q) await searchAndRoute(q);
    }
  });

  // Öneri listesini dışarıya tıklayınca kapat
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sda-nav-suggestions') && !e.target.closest('#sda-nav-destination')) {
      hideSuggestions();
    }
  }, { passive: true });

  try {
    const c = await getCurrentPosition();
    createMap(c);
    updatePosition(c);
    startGps();
  } catch {
    createMap({ latitude: 39.9208, longitude: 32.8541 });
    setMessage('GPS izni verilmedi. Konum butonuna basarak tekrar deneyin.');
  }

  window.addEventListener('resize', () => {
    try { navState.map?.invalidateSize(true); } catch {};
  });
}

export function destroyNavigationDriveView() {
  if (navState.watchId != null) navigator.geolocation?.clearWatch(navState.watchId);
  navState.watchId = null;
  try { navState.map?.remove(); } catch {}
  navState.map = null;
  navState.marker = null;
  navState.routeLine = null;
  navState.destMarker = null;
  navState.ready = false;
  navState.currentDest = null;
}
