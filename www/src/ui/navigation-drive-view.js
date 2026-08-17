/**
 * navigation-drive-view.js
 * ---------------------------------------------------------------------------
 * Sürüş navigasyonu ekranı — tam özellikli yeniden yazım.
 *
 * ✅ Büyük harita (flex ile kalan alanı doldurur)
 * ✅ Araç konumu (paylaşılan gps-tracker.js)
 * ✅ Otomatik araç takip + elle kaydırınca takip durur
 * ✅ Takip butonu ile tekrar araç merkezlenir
 * ✅ Araç yönü göstergesi (heading)
 * ✅ Adres arama → Nominatim geocoding → OSRM rota
 * ✅ Hız limiti (speed-limit-service.js)
 * ✅ Radar/kamera uyarısı (speed-camera-service.js)
 * ✅ Anlık tüketim (vehicle-live-data-store.js / MAF)
 * ✅ Kalan mesafe + tahmini varış (ETA)
 * ✅ Rota özeti
 * ✅ Leaflet invalidateSize düzeltmesi (gizli view'da init)
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { searchAddress } from '../maps/forward-geocode.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { getSpeedLimitNear } from '../maps/speed-limit-service.js';
import { getCachedCameras, onCamerasUpdate } from '../maps/speed-camera-service.js';
import { getLivePidValue, onLiveDataChange } from '../core/vehicle-live-data-store.js';
import { estimateLitersPerHour, estimateLitersPer100Km } from '../fuel/instant-consumption.js';
import { onViewChange } from '../core/view-router.js';

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

/** @type {{ map: L.Map|null, vehicleMarker: L.Marker|null, routeLine: L.Polyline|null, destMarker: L.Marker|null, cameraMarkers: L.Marker[], posUnsubscribe: (()=>void)|null, liveUnsubscribe: (()=>void)|null, watchId: number|null, follow: boolean, dest: {lat:number,lon:number,label:string,distKm:number,durationMin:number}|null, lastPos: {latitude:number,longitude:number,speedKmh:number,headingDeg:number}|null, speedLimit: number|null }} */
const S = {
  map: null,
  vehicleMarker: null,
  routeLine: null,
  destMarker: null,
  cameraMarkers: [],
  posUnsubscribe: null,
  liveUnsubscribe: null,
  watchId: null,
  follow: true,
  dest: null,
  lastPos: null,
  speedLimit: null,
};

// ---------------------------------------------------------------------------
// DOM yardımcıları
// ---------------------------------------------------------------------------

/** @param {string} id @returns {HTMLElement|null} */
const el = (id) => document.getElementById(id);

function setTxt(id, text) {
  const e = el(id);
  if (e) e.textContent = text;
}

function setStyle(id, css) {
  const e = el(id);
  if (e) e.style.cssText = css;
}

// ---------------------------------------------------------------------------
// Layout kurulumu (yalnızca bir kez)
// ---------------------------------------------------------------------------

function ensureLayout() {
  const view = document.querySelector('[data-view="navigation-drive"]');
  if (!view) return null;
  if (view.querySelector('#ndv-root')) return view;

  view.innerHTML = `
<div id="ndv-root">

  <!-- Arama satırı -->
  <div id="ndv-search-row">
    <input id="ndv-input" type="search" placeholder="Nereye gidiyorsun?" autocomplete="off" />
    <button id="ndv-search-btn" class="ndv-btn ndv-btn--green">Ara</button>
  </div>

  <!-- Adres önerileri -->
  <div id="ndv-suggestions"></div>

  <!-- Harita sarmalayıcı -->
  <div id="ndv-map-wrap">
    <div id="ndv-map"></div>

    <!-- Yükleniyor overlay -->
    <div id="ndv-loading">
      <div class="ndv-spinner"></div>
      <strong>Harita hazırlanıyor</strong>
      <span id="ndv-loading-text">Konum alınıyor…</span>
    </div>

    <!-- Hız + limit overlay (sol üst, Leaflet zoom kontrolünün yanı sıra) -->
    <div id="ndv-speed-overlay">
      <div id="ndv-speed-dial">
        <span id="ndv-speed-val">--</span>
        <small>km/sa</small>
      </div>
      <div id="ndv-limit-badge">
        <span id="ndv-limit-val">--</span>
      </div>
    </div>

    <!-- Radar uyarı rozeti -->
    <div id="ndv-camera-badge" style="display:none;">📸 Radar</div>

    <!-- Takip butonu -->
    <button id="ndv-follow-btn" class="ndv-map-btn" title="Araç takibi">◎</button>
  </div>

  <!-- İstatistik barı -->
  <div id="ndv-stats">
    <div class="ndv-stat">
      <span>HIZ</span>
      <strong id="ndv-stat-speed">0</strong>
      <small>km/sa</small>
    </div>
    <div class="ndv-stat">
      <span>LİMİT</span>
      <strong id="ndv-stat-limit">--</strong>
      <small>km/sa</small>
    </div>
    <div class="ndv-stat">
      <span>TÜKETİM</span>
      <strong id="ndv-stat-cons">--</strong>
      <small>L/100</small>
    </div>
    <div class="ndv-stat">
      <span>MESAFE</span>
      <strong id="ndv-stat-dist">--</strong>
      <small>km</small>
    </div>
    <div class="ndv-stat">
      <span>VARIŞ</span>
      <strong id="ndv-stat-eta">--</strong>
      <small>ETA</small>
    </div>
  </div>

  <!-- Kısa yollar -->
  <div id="ndv-shortcuts">
    <button data-dest="locate">📍 Konum</button>
    <button data-dest="home">🏠 Ev</button>
    <button data-dest="work">💼 İş</button>
  </div>

  <!-- Rota özeti (rota aktifken gösterilir) -->
  <div id="ndv-summary" style="display:none;">
    <span id="ndv-sum-label">--</span>
    <span id="ndv-sum-dist">--</span>
    <span id="ndv-sum-dur">--</span>
    <button id="ndv-cancel-btn">✕ İptal</button>
  </div>

  <!-- Durum mesajı -->
  <p id="ndv-msg">Navigasyon hazır.</p>

</div>`;

  return view;
}

// ---------------------------------------------------------------------------
// CSS — inline olarak enjekte edilir (dışarıya bağımlılık yok)
// ---------------------------------------------------------------------------

function injectCss() {
  if (document.getElementById('ndv-style')) return;
  const style = document.createElement('style');
  style.id = 'ndv-style';
  style.textContent = `
[data-view="navigation-drive"] {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--sda-bg-base, #0b0e13);
  color: var(--sda-text-primary, #fff);
  box-sizing: border-box;
}
#ndv-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px 10px 0 10px;
  box-sizing: border-box;
  gap: 7px;
  overflow: hidden;
}
/* Arama */
#ndv-search-row {
  display: flex;
  gap: 7px;
  flex: 0 0 auto;
}
#ndv-input {
  flex: 1;
  min-width: 0;
  padding: 11px 13px;
  border-radius: 13px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: #fff;
  font-size: 14px;
  outline: none;
}
#ndv-input::placeholder { color: rgba(255,255,255,.35); }
.ndv-btn { border: none; border-radius: 12px; padding: 0 16px; font-weight: 700; cursor: pointer; color: #fff; }
.ndv-btn--green { background: #16a34a; }
/* Öneriler */
#ndv-suggestions {
  display: none;
  flex: 0 0 auto;
  background: var(--sda-bg-elevated, #1c1f26);
  border-radius: 10px;
  overflow: hidden;
  max-height: 160px;
  overflow-y: auto;
}
#ndv-suggestions button {
  display: block; width: 100%; text-align: left;
  padding: 10px 13px; background: none; border: none;
  border-bottom: 1px solid rgba(255,255,255,.06);
  color: #fff; font-size: 13px; cursor: pointer;
}
#ndv-suggestions button:hover { background: rgba(255,255,255,.07); }
/* Harita */
#ndv-map-wrap {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  background: #17202a;
  border: 1px solid rgba(255,255,255,.08);
}
#ndv-map {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
}
/* Yükleniyor */
#ndv-loading {
  position: absolute; inset: 0; z-index: 800;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  background: rgba(8,12,18,.85); color: #fff;
  pointer-events: none;
}
#ndv-loading.hidden { display: none; }
.ndv-spinner {
  width: 26px; height: 26px;
  border: 3px solid rgba(255,255,255,.18);
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: ndvSpin .8s linear infinite;
}
@keyframes ndvSpin { to { transform: rotate(360deg); } }
/* Hız overlay */
#ndv-speed-overlay {
  position: absolute;
  top: 10px; left: 50px; /* Leaflet zoom butonlarından sağda */
  z-index: 900;
  display: flex; gap: 6px; align-items: center;
  pointer-events: none;
}
#ndv-speed-dial {
  width: 60px; height: 60px; border-radius: 50%;
  background: rgba(20,23,30,.88);
  border: 3px solid rgba(255,255,255,.18);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
#ndv-speed-val { font-size: 20px; font-weight: 800; line-height: 1; color: #fff; }
#ndv-speed-dial small { font-size: 8px; color: rgba(255,255,255,.5); }
#ndv-limit-badge {
  width: 46px; height: 46px; border-radius: 50%;
  background: #fff;
  border: 4px solid #E02020;
  display: flex; align-items: center; justify-content: center;
}
#ndv-limit-val { color: #1a1a1a; font-weight: 800; font-size: 14px; }
/* Radar badge */
#ndv-camera-badge {
  position: absolute; bottom: 52px; right: 10px; z-index: 900;
  background: rgba(220,38,38,.88); color: #fff;
  padding: 5px 10px; border-radius: 10px; font-size: 11px; font-weight: 700;
  pointer-events: none;
}
/* Takip butonu */
#ndv-follow-btn {
  position: absolute; bottom: 10px; right: 10px; z-index: 900;
  width: 40px; height: 40px; border-radius: 50%;
  border: none; background: rgba(20,23,30,.88);
  color: #fff; font-size: 18px; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
}
#ndv-follow-btn.active { outline: 2px solid #22c55e; }
/* Stats */
#ndv-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 5px;
  flex: 0 0 auto;
}
.ndv-stat {
  background: rgba(255,255,255,.055);
  border-radius: 10px;
  padding: 7px 4px;
  text-align: center;
}
.ndv-stat span { display: block; font-size: 7px; opacity: .5; }
.ndv-stat strong { display: block; font-size: 14px; font-weight: 800; margin: 2px 0; }
.ndv-stat small { display: block; font-size: 7px; opacity: .5; }
/* Kısa yollar */
#ndv-shortcuts {
  display: flex; gap: 6px; flex: 0 0 auto;
}
#ndv-shortcuts button {
  flex: 1; border: none; border-radius: 10px;
  padding: 8px 4px; font-size: 10px; font-weight: 600;
  background: rgba(255,255,255,.08); color: #fff; cursor: pointer;
}
/* Rota özeti */
#ndv-summary {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  background: rgba(255,255,255,.07); border-radius: 10px; padding: 8px 12px;
  font-size: 12px;
}
#ndv-sum-label { flex: 1; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ndv-sum-dist, #ndv-sum-dur { opacity: .7; white-space: nowrap; }
#ndv-cancel-btn { border: none; background: rgba(255,80,80,.2); color: #ff5a5f; border-radius: 8px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
/* Mesaj */
#ndv-msg { flex: 0 0 auto; font-size: 10px; opacity: .5; text-align: center; margin: 2px 0 6px 0; }

/* Leaflet attribution küçük ekranda taşmasın */
#ndv-map .leaflet-control-attribution { font-size: 9px; }

/* Aşılmış limit: kırmızı hız */
#ndv-speed-val.over { color: #FF5A5F; }
`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Harita
// ---------------------------------------------------------------------------

function initMap(lat, lon) {
  if (S.map) return;

  const container = el('ndv-map');
  if (!container) return;

  S.map = L.map(container, {
    center: [lat, lon],
    zoom: 16,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(S.map);

  S.vehicleMarker = L.marker([lat, lon], {
    icon: buildArrowIcon(0),
    title: 'Aracınız',
  }).addTo(S.map);

  // Elle kaydırılınca takibi durdur
  S.map.on('dragstart', () => {
    S.follow = false;
    el('ndv-follow-btn')?.classList.remove('active');
  });

  // Birden fazla invalidateSize çağrısı — Leaflet gizli container sorununu çözer
  [0, 100, 300, 700].forEach((ms) =>
    setTimeout(() => { try { S.map?.invalidateSize(true); } catch {} }, ms)
  );

  hideLoading();
}

function buildArrowIcon(headingDeg) {
  return L.divIcon({
    className: '',
    html: `<div style="width:0;height:0;
      border-left:8px solid transparent;
      border-right:8px solid transparent;
      border-bottom:20px solid var(--sda-accent,#FF8A3D);
      transform:rotate(${headingDeg}deg);
      transition:transform 200ms linear;
      filter:drop-shadow(0 1px 4px rgba(0,0,0,.6));"></div>`,
    iconSize: [16, 20],
    iconAnchor: [8, 10],
  });
}

function hideLoading() {
  el('ndv-loading')?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Konum güncellemesi
// ---------------------------------------------------------------------------

function onNewPosition(pos) {
  S.lastPos = pos;

  // Harita henüz kurulmadıysa kur
  if (!S.map) {
    initMap(pos.latitude, pos.longitude);
    return;
  }

  // Araç işaretçisini güncelle
  const latlng = [pos.latitude, pos.longitude];
  if (S.vehicleMarker) {
    S.vehicleMarker.setLatLng(latlng);
    S.vehicleMarker.setIcon(buildArrowIcon(pos.headingDeg ?? 0));
  }

  // Takip aktifse haritayı araçla birlikte kaydır
  if (S.follow) {
    S.map.panTo(latlng, { animate: true, duration: 0.4 });
  }

  // Hız göstergeleri
  const spd = Math.round(pos.speedKmh ?? 0);
  setTxt('ndv-speed-val', spd);
  setTxt('ndv-stat-speed', spd);

  // Limit aşıldı mı?
  const speedValEl = el('ndv-speed-val');
  if (speedValEl) {
    speedValEl.classList.toggle('over', S.speedLimit !== null && spd > S.speedLimit);
  }

  // Rota aktifse kalan mesafeyi güncelle
  if (S.dest) {
    const remaining = haversineKm(pos.latitude, pos.longitude, S.dest.lat, S.dest.lon);
    const etaMin = remaining / 60 * 60; // 60 km/sa varsayımı
    updateStats({ dist: remaining, etaMin });
  }

  // Hız limiti güncelle (throttled, service içinde)
  getSpeedLimitNear(pos.latitude, pos.longitude).then((limit) => {
    S.speedLimit = limit;
    const txt = limit !== null ? String(limit) : '--';
    setTxt('ndv-limit-val', txt);
    setTxt('ndv-stat-limit', txt);
    if (speedValEl) {
      speedValEl.classList.toggle('over', limit !== null && spd > limit);
    }
  });

  // Radar kamerası kontrolü
  checkCameras(pos.latitude, pos.longitude);
}

// ---------------------------------------------------------------------------
// Canlı OBD verisi (tüketim)
// ---------------------------------------------------------------------------

function onLiveData() {
  const maf = getLivePidValue('10'); // MAF
  const spd = getLivePidValue('0D'); // Hız (OBD)
  if (!maf) return;

  const lph = estimateLitersPerHour(maf.value);
  const kmh = spd ? spd.value : (S.lastPos?.speedKmh ?? 0);
  const l100 = estimateLitersPer100Km(lph, kmh);
  setTxt('ndv-stat-cons', l100 !== null ? l100.toFixed(1) : lph.toFixed(1));
}

// ---------------------------------------------------------------------------
// Radar kameraları
// ---------------------------------------------------------------------------

function checkCameras(lat, lon) {
  const cameras = getCachedCameras();
  const badge = el('ndv-camera-badge');
  if (badge) badge.style.display = cameras.length > 0 ? 'block' : 'none';
}

function renderCameraMarkers(cameras) {
  if (!S.map) return;
  S.cameraMarkers.forEach((m) => S.map.removeLayer(m));
  S.cameraMarkers = cameras.slice(0, 10).map((c) =>
    L.circleMarker([c.lat, c.lon], { radius: 8, color: '#DC2626', fillOpacity: 0.7 })
      .addTo(S.map)
      .bindPopup('📸 Radar')
  );
}

// ---------------------------------------------------------------------------
// İstatistik paneli
// ---------------------------------------------------------------------------

function updateStats({ dist, etaMin }) {
  if (dist !== undefined) {
    setTxt('ndv-stat-dist', dist >= 1 ? dist.toFixed(1) : (dist * 1000).toFixed(0) + 'm');
  }
  if (etaMin !== undefined) {
    const arr = new Date(Date.now() + etaMin * 60 * 1000);
    const h = arr.getHours().toString().padStart(2, '0');
    const m = arr.getMinutes().toString().padStart(2, '0');
    setTxt('ndv-stat-eta', `${h}:${m}`);
  }
}

function clearStats() {
  setTxt('ndv-stat-dist', '--');
  setTxt('ndv-stat-eta', '--');
}

// ---------------------------------------------------------------------------
// Rota
// ---------------------------------------------------------------------------

async function routeTo(dest) {
  if (!S.map) return;
  setMsg('Rota hesaplanıyor…');
  clearStats();

  const from = S.lastPos ?? getLastPosition();
  if (!from) { setMsg('Konum henüz alınamadı.'); return; }

  const routes = await getDrivingRoute(
    { lat: from.latitude, lon: from.longitude },
    { lat: dest.lat, lon: dest.lon },
    { destinationLabel: dest.label }
  );

  if (!routes?.length) { setMsg('Rota bulunamadı. İnternet bağlantısını kontrol edin.'); return; }

  const best = routes[0];

  // Eski rota/hedef işaretçilerini temizle
  if (S.routeLine) { S.map.removeLayer(S.routeLine); S.routeLine = null; }
  if (S.destMarker) { S.map.removeLayer(S.destMarker); S.destMarker = null; }

  S.routeLine = L.polyline(best.coordinates, { color: '#4A90E2', weight: 5, opacity: 0.9 }).addTo(S.map);
  S.destMarker = L.marker([dest.lat, dest.lon]).addTo(S.map).bindPopup(dest.label).openPopup();
  S.map.fitBounds(S.routeLine.getBounds(), { padding: [50, 50] });

  S.dest = { ...dest, distKm: best.distanceKm, durationMin: best.durationMinutes };
  S.follow = false;
  el('ndv-follow-btn')?.classList.remove('active');

  // Rota özeti
  const distTxt = best.distanceKm >= 1 ? `${best.distanceKm.toFixed(1)} km` : `${Math.round(best.distanceKm * 1000)} m`;
  const durTxt = `~${Math.round(best.durationMinutes)} dk`;
  setTxt('ndv-sum-label', dest.label);
  setTxt('ndv-sum-dist', distTxt);
  setTxt('ndv-sum-dur', durTxt);
  const sum = el('ndv-summary');
  if (sum) sum.style.display = 'flex';

  updateStats({ dist: best.distanceKm, etaMin: best.durationMinutes });
  setMsg(`${dest.label} · ${distTxt} · ${durTxt}`);
}

function cancelRoute() {
  if (S.routeLine) { S.map?.removeLayer(S.routeLine); S.routeLine = null; }
  if (S.destMarker) { S.map?.removeLayer(S.destMarker); S.destMarker = null; }
  S.dest = null;
  const sum = el('ndv-summary');
  if (sum) sum.style.display = 'none';
  clearStats();
  setMsg('Rota iptal edildi.');
}

// ---------------------------------------------------------------------------
// Adres arama
// ---------------------------------------------------------------------------

async function doSearch(q) {
  if (!q) return;
  hideSuggestions();
  setMsg('Adres aranıyor…');

  const results = await searchAddress(q, 5);
  if (!results.length) { setMsg(`"${q}" için sonuç bulunamadı.`); return; }
  if (results.length === 1) { await routeTo({ lat: results[0].lat, lon: results[0].lon, label: shortLabel(results[0].label) }); return; }

  showSuggestions(results);
}

function showSuggestions(results) {
  const box = el('ndv-suggestions');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = results.map((r, i) =>
    `<button data-si="${i}">${shortLabel(r.label)}</button>`
  ).join('');
  box.querySelectorAll('[data-si]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = results[Number(btn.dataset.si)];
      hideSuggestions();
      const inp = el('ndv-input');
      if (inp) inp.value = shortLabel(r.label);
      await routeTo({ lat: r.lat, lon: r.lon, label: shortLabel(r.label) });
    });
  });
}

function hideSuggestions() {
  const box = el('ndv-suggestions');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function shortLabel(label) { return label.split(',').slice(0, 3).join(',').trim(); }

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function setMsg(text) { setTxt('ndv-msg', text); }

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Favori konumlar (ev/iş) — favorites-store.js'ten
// ---------------------------------------------------------------------------

async function routeToFavorite(id) {
  try {
    const { getFavoriteLocation } = await import('../maps/favorites-store.js');
    const fav = getFavoriteLocation(id);
    if (!fav) { setMsg(`${id === 'home' ? 'Ev' : 'İş'} konumu henüz ayarlanmadı.`); return; }
    await routeTo({ lat: fav.lat, lon: fav.lon ?? fav.lng, label: fav.label ?? (id === 'home' ? 'Ev' : 'İş') });
  } catch { setMsg('Favori konuma rota çizilemedi.'); }
}

// ---------------------------------------------------------------------------
// Ana init
// ---------------------------------------------------------------------------

export async function initNavigationDriveView() {
  injectCss();
  const view = ensureLayout();
  if (!view) return;

  // Konum aboneliği
  S.posUnsubscribe?.();
  S.posUnsubscribe = onPosition(onNewPosition);

  // Canlı OBD verisi aboneliği
  S.liveUnsubscribe?.();
  S.liveUnsubscribe = onLiveDataChange(onLiveData);

  // Harita görünür olduğunda invalidateSize tetikle
  onViewChange((viewName) => {
    if (viewName === 'navigation-drive' && S.map) {
      requestAnimationFrame(() => {
        try { S.map.invalidateSize(true); } catch {}
        setTimeout(() => { try { S.map?.invalidateSize(true); } catch {}; }, 200);
      });
      // Takibi yeniden aktive et
      if (S.lastPos) {
        S.follow = true;
        el('ndv-follow-btn')?.classList.add('active');
      }
    }
  });

  // Mevcut konum varsa hemen haritayı kur
  const last = getLastPosition();
  if (last) {
    initMap(last.latitude, last.longitude);
    onNewPosition(last);
  } else {
    // GPS bekle, ama fallback olarak Türkiye merkezini göster
    setTimeout(() => {
      if (!S.map) {
        initMap(39.0, 35.0);
        setMsg('GPS konumu bekleniyor…');
      }
    }, 2000);
  }

  // Ara butonu
  el('ndv-search-btn')?.addEventListener('click', () => {
    const q = el('ndv-input')?.value?.trim();
    if (q) doSearch(q);
  });

  // Enter tuşu
  el('ndv-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const q = e.target.value?.trim(); if (q) doSearch(q); }
  });

  // Takip butonu
  el('ndv-follow-btn')?.addEventListener('click', () => {
    S.follow = true;
    el('ndv-follow-btn')?.classList.add('active');
    if (S.map && S.lastPos) {
      S.map.setView([S.lastPos.latitude, S.lastPos.longitude], 16, { animate: true });
    }
  });

  // İptal butonu
  el('ndv-cancel-btn')?.addEventListener('click', cancelRoute);

  // Kısa yollar
  view.querySelectorAll('#ndv-shortcuts [data-dest]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dest = btn.dataset.dest;
      if (dest === 'locate') {
        S.follow = true;
        el('ndv-follow-btn')?.classList.add('active');
        if (S.map && S.lastPos) S.map.setView([S.lastPos.latitude, S.lastPos.longitude], 16, { animate: true });
      } else {
        await routeToFavorite(dest);
      }
    });
  });

  // Kamera önbelleği güncellenince işaretçileri yeniden çiz
  onCamerasUpdate(renderCameraMarkers);

  // Öneri kutusunu dışarı tıklayınca kapat
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ndv-suggestions') && !e.target.closest('#ndv-input')) hideSuggestions();
  }, { passive: true });

  // Pencere boyutu değişince invalidateSize
  window.addEventListener('resize', () => { try { S.map?.invalidateSize(true); } catch {} });

  // Başlangıçta takip aktif
  el('ndv-follow-btn')?.classList.add('active');
}

export function destroyNavigationDriveView() {
  S.posUnsubscribe?.(); S.posUnsubscribe = null;
  S.liveUnsubscribe?.(); S.liveUnsubscribe = null;
  if (S.watchId != null) { navigator.geolocation?.clearWatch(S.watchId); S.watchId = null; }
  S.cameraMarkers.forEach((m) => S.map?.removeLayer(m)); S.cameraMarkers = [];
  try { S.map?.remove(); } catch {}
  S.map = null; S.vehicleMarker = null; S.routeLine = null; S.destMarker = null;
  S.dest = null; S.lastPos = null; S.follow = true;
}
