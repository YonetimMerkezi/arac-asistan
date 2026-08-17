/**
 * Smart Drive AI — Navigation Drive View
 * Faz 2 navigasyon UX: Google Maps benzeri sürüş görünümü.
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

const S = {
  map: null,
  vehicleMarker: null,
  routeLine: null,
  destMarker: null,
  cameraMarkers: [],
  posUnsubscribe: null,
  liveUnsubscribe: null,
  cameraUnsubscribe: null,
  follow: false,
  navigationActive: false,
  dest: null,
  lastPos: null,
  speedLimit: null,
  lastHeading: 0,
  lastSearchAt: 0,
  searchTimer: null,
  fullscreen: false,
  lastZoom: null,
};

const el = (id) => document.getElementById(id);
const setTxt = (id, value) => { const n = el(id); if (n) n.textContent = value ?? ''; };
const setDisplay = (id, value) => { const n = el(id); if (n) n.style.display = value; };
const setMsg = (value) => setTxt('ndv-msg', value);

function ensureLayout() {
  const view = document.querySelector('[data-view="navigation-drive"]');
  if (!view) return null;
  if (view.querySelector('#ndv-root')) return view;

  view.innerHTML = `
    <div id="ndv-root">
      <div id="ndv-search-row">
        <div id="ndv-search-box">
          <span id="ndv-search-icon">⌕</span>
          <input id="ndv-input" type="search" placeholder="Nereye gidiyorsun?" autocomplete="off" />
          <button id="ndv-clear-search" type="button" aria-label="Temizle">×</button>
        </div>
        <button id="ndv-search-btn" class="ndv-btn ndv-btn--green" type="button">Ara</button>
      </div>
      <div id="ndv-suggestions"></div>

      <div id="ndv-map-wrap">
        <div id="ndv-map"></div>
        <div id="ndv-loading"><div class="ndv-spinner"></div><strong>Harita hazırlanıyor</strong><span>Konum alınıyor…</span></div>
        <div id="ndv-top-info">
          <div id="ndv-speed-card"><strong id="ndv-speed-val">0</strong><span>km/sa</span></div>
          <div id="ndv-limit-badge"><span id="ndv-limit-val">--</span></div>
        </div>
        <div id="ndv-camera-badge" style="display:none"><span>●</span> Radar</div>
        <button id="ndv-follow-btn" type="button" title="Aracı takip et" aria-label="Aracı takip et">◎</button>
        <button id="ndv-fullscreen-exit" type="button" aria-label="Tam ekrandan çık">×</button>
        <div id="ndv-heading-badge">N</div>
      </div>

      <div id="ndv-stats">
        <div class="ndv-stat"><span>HIZ</span><strong id="ndv-stat-speed">0</strong><small>km/sa</small></div>
        <div class="ndv-stat"><span>LİMİT</span><strong id="ndv-stat-limit">--</strong><small>km/sa</small></div>
        <div class="ndv-stat"><span>TÜKETİM</span><strong id="ndv-stat-cons">--</strong><small>L/100 km</small></div>
        <div class="ndv-stat"><span>MESAFE</span><strong id="ndv-stat-dist">--</strong><small>km</small></div>
        <div class="ndv-stat"><span>VARIŞ</span><strong id="ndv-stat-eta">--</strong><small>ETA</small></div>
      </div>

      <div id="ndv-shortcuts">
        <button type="button" data-dest="locate"><span>⌖</span><span>Konumum</span></button>
        <button type="button" data-dest="home"><span>⌂</span><span>Ev</span></button>
        <button type="button" data-dest="work"><span>▣</span><span>İş</span></button>
      </div>

      <div id="ndv-summary">
        <div class="ndv-summary-main"><span class="ndv-summary-icon">➤</span><div class="ndv-summary-label-wrap"><strong id="ndv-sum-label">--</strong><small>Hedef</small></div></div>
        <div class="ndv-summary-item"><strong id="ndv-sum-dist">--</strong><small>Mesafe</small></div>
        <div class="ndv-summary-item"><strong id="ndv-sum-dur">--</strong><small>Süre</small></div>
      </div>

      <div id="ndv-action-row">
        <button id="ndv-start-btn" type="button"><span>➤</span> Navigasyonu Başlat</button>
        <button id="ndv-cancel-btn" type="button">İptal</button>
      </div>
      <p id="ndv-msg">Navigasyon hazır.</p>
    </div>`;
  return view;
}

function injectCss() {
  if (document.getElementById('ndv-style')) return;
  const style = document.createElement('style');
  style.id = 'ndv-style';
  style.textContent = `
[data-view="navigation-drive"]{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;box-sizing:border-box!important;background:var(--sda-bg-base,#0f1218);color:var(--sda-text-primary,#fff)}
#ndv-root{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;padding:8px 8px 6px;gap:7px;overflow:hidden}
#ndv-search-row{display:flex;gap:7px;flex:0 0 auto;min-width:0}
#ndv-search-box{position:relative;display:flex;align-items:center;flex:1;min-width:0;height:44px;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));border-radius:14px;background:var(--sda-bg-elevated,#191e27);overflow:hidden}
#ndv-search-icon{margin-left:12px;font-size:22px;opacity:.7}#ndv-input{width:100%;height:100%;min-width:0;padding:0 38px 0 10px;border:0;outline:0;background:transparent;color:var(--sda-text-primary,#fff);font-size:14px;box-sizing:border-box}#ndv-input::placeholder{color:var(--sda-text-muted,#8992a3)}
#ndv-clear-search{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:var(--sda-text-muted,#8992a3);font-size:20px}
.ndv-btn{height:44px;padding:0 15px;border:0;border-radius:14px;color:#fff;font-weight:800;font-size:13px}.ndv-btn--green{background:linear-gradient(135deg,#22c55e,#16a34a)}
#ndv-suggestions{display:none;max-height:210px;overflow-y:auto;flex:0 0 auto;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));border-radius:13px;background:var(--sda-bg-elevated,#191e27);box-shadow:0 12px 30px rgba(0,0,0,.3);z-index:5000}
#ndv-suggestions button{width:100%;padding:12px 13px;text-align:left;border:0;border-bottom:1px solid var(--sda-hairline,rgba(255,255,255,.08));background:transparent;color:var(--sda-text-primary,#fff);font-size:13px}
#ndv-map-wrap{position:relative;flex:1 1 0;min-width:0;min-height:0;overflow:hidden;border-radius:18px;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));background:#d8dde4;box-shadow:0 5px 20px rgba(0,0,0,.18)}
#ndv-map{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
#ndv-map .leaflet-map-pane{will-change:transform}
/* Leaflet core ile çakışmaması için map pane değil, alt katmanlar döndürülür. */
#ndv-map.ndv-bearing .leaflet-tile-pane,#ndv-map.ndv-bearing .leaflet-overlay-pane,#ndv-map.ndv-bearing .leaflet-shadow-pane,#ndv-map.ndv-bearing .leaflet-marker-pane,#ndv-map.ndv-bearing .leaflet-tooltip-pane,#ndv-map.ndv-bearing .leaflet-popup-pane{transform:rotate(var(--ndv-bearing,0deg));transform-origin:50% 50%;will-change:transform}
#ndv-loading{position:absolute;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:rgba(8,12,18,.82);color:#fff}.ndv-spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,.18);border-top-color:#22c55e;border-radius:50%;animation:ndvSpin .8s linear infinite}@keyframes ndvSpin{to{transform:rotate(360deg)}}#ndv-loading.hidden{display:none}
#ndv-top-info{position:absolute;top:10px;left:50px;z-index:900;display:flex;align-items:center;gap:8px;pointer-events:none}.ndv-bearing-active #ndv-top-info{transform:none}
#ndv-speed-card{width:62px;height:62px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(14,17,24,.92);border:3px solid rgba(255,255,255,.25);box-shadow:0 2px 10px rgba(0,0,0,.45)}#ndv-speed-card strong{font-size:21px;line-height:1;color:#fff}#ndv-speed-card span{font-size:8px;color:#b7bec9;margin-top:3px}
#ndv-limit-badge{width:46px;height:46px;border-radius:50%;background:#fff;border:4px solid #e02020;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.35)}#ndv-limit-val{color:#1a1a1a;font-weight:900;font-size:14px}
#ndv-camera-badge{position:absolute;bottom:62px;right:10px;z-index:900;background:rgba(220,38,38,.9);color:#fff;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:800}
#ndv-follow-btn{position:absolute;right:10px;bottom:10px;z-index:900;width:46px;height:46px;border:0;border-radius:50%;background:rgba(14,17,24,.92);color:#fff;font-size:21px;box-shadow:0 3px 12px rgba(0,0,0,.35)}#ndv-follow-btn.active{outline:3px solid #22c55e}
#ndv-fullscreen-exit{display:none;position:absolute;right:10px;top:10px;z-index:1200;width:42px;height:42px;border:0;border-radius:50%;background:rgba(14,17,24,.8);color:#fff;font-size:25px}
#ndv-heading-badge{position:absolute;top:14px;right:62px;z-index:900;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.92);color:#dc2626;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
#ndv-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;flex:0 0 auto}.ndv-stat{min-width:0;padding:8px 3px;text-align:center;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:11px;background:var(--sda-bg-elevated,#191e27);overflow:hidden}.ndv-stat span,.ndv-stat small{display:block;font-size:7px;color:var(--sda-text-muted,#8992a3)}.ndv-stat strong{display:block;font-size:14px;line-height:18px;color:var(--sda-text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ndv-shortcuts{display:flex;gap:7px;flex:0 0 auto}#ndv-shortcuts button{flex:1;min-width:0;padding:9px 4px;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:11px;background:var(--sda-bg-elevated,#191e27);color:var(--sda-text-primary,#fff);font-size:11px;font-weight:700}#ndv-shortcuts button span:first-child{font-size:17px;display:block}
#ndv-summary{display:none;align-items:center;gap:8px;min-width:0;flex:0 0 auto;padding:9px 10px;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:13px;background:var(--sda-bg-elevated,#191e27)}.ndv-summary-main{display:flex;align-items:center;gap:8px;flex:1 1 0;min-width:0}.ndv-summary-icon{flex:0 0 auto;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#16a34a;color:#fff}.ndv-summary-label-wrap{min-width:0;overflow:hidden}.ndv-summary-main strong{display:block;max-width:100%;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ndv-summary-main small,.ndv-summary-item small{display:block;font-size:8px;color:var(--sda-text-muted,#8992a3)}.ndv-summary-item{flex:0 0 auto;min-width:58px;text-align:right}.ndv-summary-item strong{display:block;font-size:12px;white-space:nowrap}
#ndv-action-row{display:none;gap:7px;flex:0 0 auto}#ndv-start-btn{flex:1;min-width:0;padding:12px;border:0;border-radius:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:14px;font-weight:900}#ndv-cancel-btn{padding:12px 14px;border:0;border-radius:13px;background:var(--sda-danger-soft,rgba(255,90,95,.14));color:var(--sda-danger,#ff5a5f);font-weight:800}
#ndv-msg{flex:0 0 auto;margin:0;text-align:center;font-size:10px;color:var(--sda-text-muted,#8992a3)}
/* Gerçek sürüş tam ekranı: browser fullscreen olmasa bile uygulama içinde sabit overlay. */
#ndv-root.ndv-fullscreen{position:fixed;inset:0;z-index:99999;width:100vw!important;height:100dvh!important;max-width:none!important;padding:0!important;gap:0!important;background:#10141b}#ndv-root.ndv-fullscreen #ndv-search-row,#ndv-root.ndv-fullscreen #ndv-suggestions,#ndv-root.ndv-fullscreen #ndv-stats,#ndv-root.ndv-fullscreen #ndv-shortcuts,#ndv-root.ndv-fullscreen #ndv-summary,#ndv-root.ndv-fullscreen #ndv-action-row,#ndv-root.ndv-fullscreen #ndv-msg{display:none!important}#ndv-root.ndv-fullscreen #ndv-map-wrap{flex:1;border-radius:0;border:0}#ndv-root.ndv-fullscreen #ndv-fullscreen-exit{display:block}
@media(max-width:380px){#ndv-root{padding:6px 6px 4px;gap:5px}.ndv-stat strong{font-size:12px}.ndv-stat span,.ndv-stat small{font-size:6px}.ndv-btn{padding:0 11px}}
`;
  document.head.appendChild(style);
}

function buildArrowIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="ndv-car-arrow"><div class="ndv-car-arrow-tip"></div><div class="ndv-car-arrow-dot"></div></div>',
    iconSize: [34, 44],
    iconAnchor: [17, 22],
  });
}

function hideLoading() { el('ndv-loading')?.classList.add('hidden'); }

function initMap(lat, lon) {
  if (S.map) return;
  const container = el('ndv-map');
  if (!container) return;
  S.map = L.map(container, { center: [lat, lon], zoom: 17, zoomControl: true, attributionControl: true, preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '© OpenStreetMap' }).addTo(S.map);
  S.vehicleMarker = L.marker([lat, lon], { icon: buildArrowIcon(), zIndexOffset: 1000 }).addTo(S.map);
  S.map.on('dragstart', () => { if (!S.navigationActive) return; S.follow = false; el('ndv-follow-btn')?.classList.remove('active'); });
  [0, 100, 300, 700].forEach((ms) => setTimeout(() => { try { S.map?.invalidateSize(true); } catch {} }, ms));
  hideLoading();
}

function bearingBetween(aLat, aLon, bLat, bLon) {
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function smoothBearing(next) {
  let delta = ((next - S.lastHeading + 540) % 360) - 180;
  if (Math.abs(delta) > 70) delta *= 0.45;
  S.lastHeading = (S.lastHeading + delta * 0.22 + 360) % 360;
  return S.lastHeading;
}

function applyBearing(heading) {
  if (!S.map || !S.navigationActive) return;
  const mapEl = el('ndv-map');
  if (!mapEl) return;
  mapEl.classList.add('ndv-bearing');
  mapEl.style.setProperty('--ndv-bearing', `${-heading}deg`);
  const h = Math.round(heading);
  const letters = ['N','NE','E','SE','S','SW','W','NW'];
  setTxt('ndv-heading-badge', letters[Math.round(h / 45) % 8]);
}

function zoomForSpeed(speed) {
  if (speed < 12) return 18;
  if (speed < 30) return 17;
  if (speed < 55) return 16;
  if (speed < 85) return 15;
  if (speed < 115) return 14;
  return 13;
}

function updateNavigationCamera(pos) {
  if (!S.map || !S.navigationActive || !S.follow) return;
  const speed = Number(pos.speedKmh) || 0;
  const zoom = zoomForSpeed(speed);
  if (S.lastZoom !== zoom) {
    S.lastZoom = zoom;
    S.map.setZoom(zoom, { animate: true });
  }
  const target = L.latLng(pos.latitude, pos.longitude);
  S.map.panTo(target, { animate: true, duration: 0.35, easeLinearity: 0.2 });
}

function onNewPosition(pos) {
  if (!pos) return;
  S.lastPos = pos;
  if (!S.map) initMap(pos.latitude, pos.longitude);
  if (!S.map) return;
  const latlng = [pos.latitude, pos.longitude];
  S.vehicleMarker?.setLatLng(latlng);

  const speed = Math.round(Number(pos.speedKmh) || 0);
  setTxt('ndv-speed-val', speed);
  setTxt('ndv-stat-speed', speed);

  let heading = Number(pos.headingDeg);
  if (!Number.isFinite(heading) || heading < 0 || heading > 360) {
    heading = S.dest ? bearingBetween(pos.latitude, pos.longitude, S.dest.lat, S.dest.lon) : S.lastHeading;
  }
  if (S.navigationActive && speed >= 3) applyBearing(smoothBearing(heading));
  updateNavigationCamera(pos);

  const speedEl = el('ndv-speed-val');
  speedEl?.classList.toggle('over', S.speedLimit !== null && speed > S.speedLimit);

  if (S.dest) {
    const remaining = haversineKm(pos.latitude, pos.longitude, S.dest.lat, S.dest.lon);
    const routeSpeed = speed >= 5 ? speed : Math.max(20, (S.dest.durationMin > 0 ? S.dest.distKm / (S.dest.durationMin / 60) : 40));
    updateStats(remaining, remaining / routeSpeed * 60);
  }

  const now = Date.now();
  if (now - S.lastSearchAt > 5000) {
    S.lastSearchAt = now;
    getSpeedLimitNear(pos.latitude, pos.longitude).then((limit) => {
      S.speedLimit = limit;
      const text = limit == null ? '--' : String(limit);
      setTxt('ndv-limit-val', text); setTxt('ndv-stat-limit', text);
      speedEl?.classList.toggle('over', limit != null && speed > limit);
    }).catch(() => {});
  }

  if (now - S.lastSearchAt < 1000) checkCameras(pos.latitude, pos.longitude);
}

function onLiveData() {
  const maf = getLivePidValue('10');
  const spd = getLivePidValue('0D');
  if (!maf) return;
  const lph = estimateLitersPerHour(maf.value);
  const kmh = spd ? spd.value : (S.lastPos?.speedKmh ?? 0);
  const l100 = estimateLitersPer100Km(lph, kmh);
  setTxt('ndv-stat-cons', l100 != null ? l100.toFixed(1) : lph.toFixed(1));
}

function checkCameras(lat, lon) {
  const cameras = getCachedCameras();
  const badge = el('ndv-camera-badge');
  if (badge) badge.style.display = cameras.length ? 'block' : 'none';
}

function renderCameraMarkers(cameras) {
  if (!S.map) return;
  S.cameraMarkers.forEach((m) => S.map.removeLayer(m));
  S.cameraMarkers = (cameras || []).slice(0, 20).map((c) => L.circleMarker([c.lat, c.lon], { radius: 7, color: '#dc2626', fillOpacity: .75 }).addTo(S.map).bindPopup('📸 Radar'));
}

function updateStats(dist, etaMin) {
  if (dist != null) setTxt('ndv-stat-dist', dist >= 1 ? `${dist.toFixed(1)} km` : `${Math.round(dist * 1000)} m`);
  if (etaMin != null && Number.isFinite(etaMin)) {
    const d = new Date(Date.now() + etaMin * 60000);
    setTxt('ndv-stat-eta', `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
  }
}
function clearStats() { setTxt('ndv-stat-dist','--'); setTxt('ndv-stat-eta','--'); }

async function routeTo(dest) {
  if (!S.map || !dest) return;
  const from = S.lastPos || getLastPosition();
  if (!from) { setMsg('Konum henüz alınamadı.'); return; }
  hideSuggestions(); setMsg('Rota hesaplanıyor…'); clearStats();
  try {
    const routes = await getDrivingRoute({lat: from.latitude, lon: from.longitude}, {lat: dest.lat, lon: dest.lon}, {destinationLabel: dest.label});
    if (!routes?.length) { setMsg('Rota bulunamadı. İnternet bağlantısını kontrol edin.'); return; }
    const best = routes[0];
    if (S.routeLine) S.map.removeLayer(S.routeLine);
    if (S.destMarker) S.map.removeLayer(S.destMarker);
    S.routeLine = L.polyline(best.coordinates, {color:'#2563eb', weight:6, opacity:.92, lineJoin:'round'}).addTo(S.map);
    S.destMarker = L.marker([dest.lat,dest.lon]).addTo(S.map).bindPopup(dest.label);
    S.dest = { ...dest, distKm: best.distanceKm, durationMin: best.durationMinutes };
    const distText = best.distanceKm >= 1 ? `${best.distanceKm.toFixed(1)} km` : `${Math.round(best.distanceKm*1000)} m`;
    setTxt('ndv-sum-label', dest.label); setTxt('ndv-sum-dist', distText); setTxt('ndv-sum-dur', `~${Math.round(best.durationMinutes)} dk`);
    setDisplay('ndv-summary','flex'); setDisplay('ndv-action-row','flex'); setDisplay('ndv-shortcuts','none');
    updateStats(best.distanceKm, best.durationMinutes);
    S.follow = false; el('ndv-follow-btn')?.classList.remove('active');
    S.map.fitBounds(S.routeLine.getBounds(), {padding:[45,45], maxZoom:16, animate:true});
    setMsg(`${dest.label} · ${distText} · ~${Math.round(best.durationMinutes)} dk`);
  } catch (error) { setMsg('Rota hesaplanamadı. İnternet bağlantısını kontrol edin.'); console.error(error); }
}

function cancelRoute() {
  if (S.routeLine) S.map?.removeLayer(S.routeLine);
  if (S.destMarker) S.map?.removeLayer(S.destMarker);
  S.routeLine = null; S.destMarker = null; S.dest = null; S.navigationActive = false; S.follow = false;
  el('ndv-map')?.classList.remove('ndv-bearing');
  setDisplay('ndv-summary','none'); setDisplay('ndv-action-row','none'); setDisplay('ndv-shortcuts','flex'); clearStats();
  exitFullscreen(); setMsg('Rota iptal edildi.');
}

function showSuggestions(results) {
  const box = el('ndv-suggestions');
  if (!box) return;
  box.innerHTML = (results || []).map((r,i) => `<button type="button" data-si="${i}"><strong>${escapeHtml(shortLabel(r.label))}</strong></button>`).join('');
  if (!results?.length) { hideSuggestions(); return; }
  box.style.display = 'block';
  box.querySelectorAll('[data-si]').forEach((button) => button.addEventListener('click', async () => {
    const r = results[Number(button.dataset.si)];
    el('ndv-input').value = shortLabel(r.label); hideSuggestions(); await routeTo({lat:r.lat, lon:r.lon, label:shortLabel(r.label)});
  }));
}
function hideSuggestions() { const box=el('ndv-suggestions'); if(box){box.style.display='none';box.innerHTML='';} }
function shortLabel(label='') { return String(label).split(',').slice(0,3).join(',').trim(); }
function escapeHtml(value='') { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

async function searchAsYouType(q) {
  const query = q.trim();
  if (query.length < 3) { hideSuggestions(); return; }
  const stamp = Date.now(); S.lastSearchAt = stamp;
  try {
    const results = await searchAddress(query, 5);
    if (stamp !== S.lastSearchAt) return;
    showSuggestions(results);
  } catch { hideSuggestions(); }
}

async function routeToFavorite(id) {
  try {
    const {getFavoriteLocation} = await import('../maps/favorites-store.js');
    const fav = getFavoriteLocation(id);
    if (!fav) { setMsg(`${id === 'home' ? 'Ev' : 'İş'} konumu henüz ayarlanmadı.`); return; }
    await routeTo({lat:fav.lat, lon:fav.lon ?? fav.lng, label:fav.label ?? (id === 'home' ? 'Ev' : 'İş')});
  } catch { setMsg('Favori konuma rota çizilemedi.'); }
}

async function enterFullscreen() {
  const root = el('ndv-root');
  if (!root) return;
  root.classList.add('ndv-fullscreen'); S.fullscreen = true;
  document.body.classList.add('ndv-navigation-fullscreen');
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch {}
  setTimeout(() => { try { S.map?.invalidateSize(true); } catch {} }, 120);
}
async function exitFullscreen() {
  const root = el('ndv-root');
  root?.classList.remove('ndv-fullscreen'); S.fullscreen = false; document.body.classList.remove('ndv-navigation-fullscreen');
  try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); } catch {}
  setTimeout(() => { try { S.map?.invalidateSize(true); } catch {} }, 120);
}

export async function initNavigationDriveView() {
  injectCss();
  const view = ensureLayout();
  if (!view || S.initialized) return;
  S.initialized = true;

  S.posUnsubscribe = onPosition(onNewPosition);
  S.liveUnsubscribe = onLiveDataChange(onLiveData);
  S.cameraUnsubscribe = onCamerasUpdate(renderCameraMarkers);

  const last = getLastPosition();
  if (last) { initMap(last.latitude,last.longitude); onNewPosition(last); }
  else setTimeout(() => { if(!S.map) initMap(39,35); hideLoading(); setMsg('GPS konumu bekleniyor…'); }, 1500);

  el('ndv-search-btn')?.addEventListener('click', () => { const q=el('ndv-input')?.value?.trim(); if(q) routeToSearch(q); });
  el('ndv-input')?.addEventListener('input', (e) => { clearTimeout(S.searchTimer); S.searchTimer=setTimeout(()=>searchAsYouType(e.target.value),350); });
  el('ndv-input')?.addEventListener('keydown', (e) => { if(e.key==='Enter'){e.preventDefault();const q=e.target.value?.trim();if(q)routeToSearch(q);} });
  el('ndv-clear-search')?.addEventListener('click', () => { el('ndv-input').value=''; hideSuggestions(); el('ndv-input').focus(); });
  el('ndv-follow-btn')?.addEventListener('click', () => { S.follow=true; el('ndv-follow-btn')?.classList.add('active'); if(S.map&&S.lastPos){const speed=Number(S.lastPos.speedKmh)||0;S.lastZoom=zoomForSpeed(speed);S.map.setView([S.lastPos.latitude,S.lastPos.longitude],S.lastZoom,{animate:true});} });
  el('ndv-start-btn')?.addEventListener('click', async () => { S.navigationActive=true; S.follow=true; el('ndv-follow-btn')?.classList.add('active'); if(S.lastPos){const h=Number(S.lastPos.headingDeg);if(Number.isFinite(h))S.lastHeading=h;applyBearing(S.lastHeading);S.lastZoom=18;S.map?.setView([S.lastPos.latitude,S.lastPos.longitude],18,{animate:true});} await enterFullscreen(); setMsg('Navigasyon başladı. İyi yolculuklar!'); });
  el('ndv-fullscreen-exit')?.addEventListener('click', exitFullscreen);
  el('ndv-cancel-btn')?.addEventListener('click', cancelRoute);
  view.querySelectorAll('#ndv-shortcuts [data-dest]').forEach((btn)=>btn.addEventListener('click',async()=>{const id=btn.dataset.dest;if(id==='locate'){S.follow=true;if(S.lastPos)S.map?.setView([S.lastPos.latitude,S.lastPos.longitude],18,{animate:true});}else await routeToFavorite(id);}));

  onViewChange((viewName) => {
    if(viewName==='navigation-drive'){requestAnimationFrame(()=>{try{S.map?.invalidateSize(true);}catch{}});}
    else if(S.fullscreen) exitFullscreen();
  });

  document.addEventListener('click',(e)=>{if(!e.target.closest('#ndv-suggestions')&&!e.target.closest('#ndv-search-box'))hideSuggestions();},{passive:true});
  window.addEventListener('resize',()=>{try{S.map?.invalidateSize(true);}catch{}});
}

async function routeToSearch(q) {
  hideSuggestions(); setMsg('Adres aranıyor…');
  try {
    const results = await searchAddress(q,5);
    if(!results?.length){setMsg(`"${q}" için sonuç bulunamadı.`);return;}
    if(results.length===1){await routeTo({lat:results[0].lat,lon:results[0].lon,label:shortLabel(results[0].label)});return;}
    showSuggestions(results);
  } catch { setMsg('Adres aranamadı. İnternet bağlantısını kontrol edin.'); }
}

function haversineKm(lat1,lon1,lat2,lon2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}

export function destroyNavigationDriveView(){
  S.posUnsubscribe?.();S.liveUnsubscribe?.();S.cameraUnsubscribe?.();S.posUnsubscribe=null;S.liveUnsubscribe=null;S.cameraUnsubscribe=null;
  clearTimeout(S.searchTimer);exitFullscreen();S.cameraMarkers.forEach(m=>S.map?.removeLayer(m));S.cameraMarkers=[];try{S.map?.remove();}catch{}
  S.map=null;S.vehicleMarker=null;S.routeLine=null;S.destMarker=null;S.dest=null;S.lastPos=null;S.navigationActive=false;S.follow=false;S.initialized=false;
}
