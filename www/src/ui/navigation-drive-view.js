/*
 * SmartDriveAI - Navigation Drive View
 * Robust visible-first initialization.
 */
let navState = {
  map: null,
  marker: null,
  routeLine: null,
  watchId: null,
  ready: false,
  follow: true,
  lastPos: null
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getGps() {
  return window.gpsTracker || window.GPSTracker || window.gps || null;
}

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

async function getCurrentPosition() {
  const gps = getGps();
  if (gps) {
    try {
      if (typeof gps.getCurrentPosition === 'function') {
        const p = await gps.getCurrentPosition();
        if (p?.coords) return p.coords;
      }
      if (gps.currentPosition?.coords) return gps.currentPosition.coords;
      if (gps.lastPosition?.coords) return gps.lastPosition.coords;
    } catch {}
  }

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

  // Critical for Leaflet when a view was previously hidden.
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
  const latlng = [coords.latitude, coords.longitude];
  navState.marker.setLatLng(latlng);

  if (Number.isFinite(coords.speed)) {
    setSpeed(coords.speed * 3.6);
  }

  if (navState.follow) {
    navState.map.panTo(latlng, { animate: true, duration: 0.35 });
  }
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
    } catch {
      setMessage('Konum alınamadı. Android konum iznini açın.');
    }
  });

  document.getElementById('sda-nav-search-btn')?.addEventListener('click', () => {
    const q = document.getElementById('sda-nav-destination')?.value?.trim();
    if (q) setMessage(`Hedef: ${q} — rota hesaplama hazır.`);
  });

  try {
    const c = await getCurrentPosition();
    createMap(c);
    updatePosition(c);
    startGps();
  } catch {
    // Still create a visible map even if GPS permission is denied.
    createMap({ latitude: 39.9208, longitude: 32.8541 });
    setMessage('GPS izni verilmedi. Konum butonuna basarak tekrar deneyin.');
  }

  window.addEventListener('resize', () => {
    try { navState.map?.invalidateSize(true); } catch {}
  });
}

export function destroyNavigationDriveView() {
  if (navState.watchId != null) navigator.geolocation?.clearWatch(navState.watchId);
  navState.watchId = null;
  try { navState.map?.remove(); } catch {}
  navState.map = null;
  navState.marker = null;
  navState.ready = false;
}
