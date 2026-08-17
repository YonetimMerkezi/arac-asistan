/**
 * navigation-drive-view.js
 * ============================================================================
 * Smart Drive AI — Faz 1 Navigasyon Sürüş Ekranı
 *
 * Bu sürüm:
 * - Leaflet haritasını güvenli şekilde başlatır.
 * - Gizli sekmeden açıldığında invalidateSize uygular.
 * - GPS konumunu takip eder.
 * - Araç yönünü gösterir.
 * - Elle harita hareket ettirilince otomatik takibi durdurur.
 * - Takip butonuyla yeniden merkezler.
 * - Adres arama + Nominatim
 * - OSRM rota
 * - Hız limiti
 * - Radar/kamera göstergesi
 * - OBD anlık tüketim
 * - Rota mesafesi / süre / ETA
 * - Ev / İş favorileri
 * - Açık/koyu tema uyumu
 *
 * NOT:
 * Mevcut proje modül yolları korunmuştur.
 * ============================================================================
 */

import L from 'leaflet';

import { searchAddress } from '../maps/forward-geocode.js';
import { getDrivingRoute } from '../maps/route-service.js';

import {
  onPosition,
  getLastPosition,
} from '../core/gps-tracker.js';

import {
  getSpeedLimitNear,
} from '../maps/speed-limit-service.js';

import {
  getCachedCameras,
  onCamerasUpdate,
} from '../maps/speed-camera-service.js';

import {
  getLivePidValue,
  onLiveDataChange,
} from '../core/vehicle-live-data-store.js';

import {
  estimateLitersPerHour,
  estimateLitersPer100Km,
} from '../fuel/instant-consumption.js';

import {
  onViewChange,
} from '../core/view-router.js';


/* ============================================================================
 * DURUM
 * ========================================================================== */

const S = {
  map: null,

  vehicleMarker: null,
  routeLine: null,
  destMarker: null,

  cameraMarkers: [],

  posUnsubscribe: null,
  liveUnsubscribe: null,
  cameraUnsubscribe: null,
  viewUnsubscribe: null,

  follow: true,

  dest: null,
  lastPos: null,

  speedLimit: null,

  initialized: false,

  resizeTimer: null,

  lastSpeedLimitRequest: 0,

  lastCameraCheck: 0,
};


/* ============================================================================
 * DOM
 * ========================================================================== */

function el(id) {
  return document.getElementById(id);
}

function setTxt(id, text) {
  const node = el(id);

  if (node) {
    node.textContent = text ?? '';
  }
}

function setDisplay(id, display) {
  const node = el(id);

  if (node) {
    node.style.display = display;
  }
}

function setMsg(text) {
  setTxt('ndv-msg', text);
}


/* ============================================================================
 * LAYOUT
 * ========================================================================== */

function ensureLayout() {
  const view = document.querySelector(
    '[data-view="navigation-drive"]'
  );

  if (!view) {
    return null;
  }

  /*
   * Daha önce oluşturulduysa tekrar oluşturma.
   */
  if (view.querySelector('#ndv-root')) {
    return view;
  }

  view.innerHTML = `
    <div id="ndv-root">

      <!-- ================================================================
           ARAMA
           ================================================================ -->

      <div id="ndv-search-row">

        <div id="ndv-search-box">

          <span id="ndv-search-icon">⌕</span>

          <input
            id="ndv-input"
            type="search"
            placeholder="Nereye gidiyorsun?"
            autocomplete="off"
            enterkeyhint="search"
          />

          <button
            id="ndv-clear-search"
            type="button"
            aria-label="Temizle"
          >
            ×
          </button>

        </div>

        <button
          id="ndv-search-btn"
          class="ndv-btn ndv-btn--green"
          type="button"
        >
          Ara
        </button>

      </div>


      <!-- ================================================================
           ÖNERİLER
           ================================================================ -->

      <div id="ndv-suggestions"></div>


      <!-- ================================================================
           HARİTA
           ================================================================ -->

      <div id="ndv-map-wrap">

        <div id="ndv-map"></div>


        <!-- Harita yükleniyor -->

        <div id="ndv-loading">

          <div class="ndv-spinner"></div>

          <strong>Harita hazırlanıyor</strong>

          <span id="ndv-loading-text">
            Konum alınıyor…
          </span>

        </div>


        <!-- Üst bilgi -->

        <div id="ndv-top-info">

          <div id="ndv-speed-card">

            <strong id="ndv-speed-val">0</strong>

            <span>km/sa</span>

          </div>


          <div id="ndv-limit-badge">

            <span id="ndv-limit-val">--</span>

          </div>

        </div>


        <!-- Radar -->

        <div
          id="ndv-camera-badge"
          style="display:none;"
        >
          <span>●</span>
          Radar
        </div>


        <!-- Konum takip -->

        <button
          id="ndv-follow-btn"
          type="button"
          title="Aracı takip et"
          aria-label="Aracı takip et"
        >
          ◎
        </button>

      </div>


      <!-- ================================================================
           İSTATİSTİKLER
           ================================================================ -->

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

          <small>L/100 km</small>

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


      <!-- ================================================================
           KISA YOLLAR
           ================================================================ -->

      <div id="ndv-shortcuts">

        <button
          type="button"
          data-dest="locate"
        >
          <span class="ndv-shortcut-icon">⌖</span>
          <span>Konumum</span>
        </button>


        <button
          type="button"
          data-dest="home"
        >
          <span class="ndv-shortcut-icon">⌂</span>
          <span>Ev</span>
        </button>


        <button
          type="button"
          data-dest="work"
        >
          <span class="ndv-shortcut-icon">▣</span>
          <span>İş</span>
        </button>

      </div>


      <!-- ================================================================
           ROTA ÖZETİ
           ================================================================ -->

      <div id="ndv-summary">

        <div class="ndv-summary-main">

          <span class="ndv-summary-icon">➤</span>

          <div>

            <strong id="ndv-sum-label">
              --
            </strong>

            <small>
              Hedef
            </small>

          </div>

        </div>


        <div class="ndv-summary-item">

          <strong id="ndv-sum-dist">
            --
          </strong>

          <small>
            Mesafe
          </small>

        </div>


        <div class="ndv-summary-item">

          <strong id="ndv-sum-dur">
            --
          </strong>

          <small>
            Süre
          </small>

        </div>

      </div>


      <!-- ================================================================
           AKSİYONLAR
           ================================================================ -->

      <div id="ndv-action-row">

        <button
          id="ndv-start-btn"
          type="button"
        >
          <span>➤</span>
          Navigasyonu Başlat
        </button>


        <button
          id="ndv-cancel-btn"
          type="button"
        >
          İptal
        </button>

      </div>


      <!-- ================================================================
           MESAJ
           ================================================================ -->

      <p id="ndv-msg">
        Navigasyon hazır.
      </p>

    </div>
  `;

  return view;
}


/* ============================================================================
 * CSS
 * ========================================================================== */

function injectCss() {

  if (document.getElementById('ndv-style')) {
    return;
  }

  const style = document.createElement('style');

  style.id = 'ndv-style';

  style.textContent = `

/* ==========================================================================
   ANA EKRAN
   ========================================================================== */

[data-view="navigation-drive"] {
  width: 100% !important;
  max-width: 100% !important;

  height: 100% !important;
  min-width: 0 !important;

  display: flex !important;
  flex-direction: column !important;

  overflow: hidden !important;

  box-sizing: border-box !important;

  background:
    var(--sda-bg-base, #0f1218);

  color:
    var(--sda-text-primary, #ffffff);
}


#ndv-root {
  width: 100%;
  max-width: 100%;

  height: 100%;

  min-width: 0;
  min-height: 0;

  display: flex;
  flex-direction: column;

  box-sizing: border-box;

  padding:
    8px
    8px
    6px;

  gap: 7px;

  overflow: hidden;
}


/* ==========================================================================
   ARAMA
   ========================================================================== */

#ndv-search-row {

  width: 100%;

  min-width: 0;

  display: flex;

  gap: 7px;

  flex: 0 0 auto;

  box-sizing: border-box;
}


#ndv-search-box {

  position: relative;

  flex: 1 1 auto;

  min-width: 0;

  height: 44px;

  display: flex;
  align-items: center;

  box-sizing: border-box;

  border-radius: 14px;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.12));

  background:
    var(--sda-bg-elevated, #191e27);

  overflow: hidden;
}


#ndv-search-icon {

  flex: 0 0 auto;

  margin-left: 13px;

  font-size: 22px;

  line-height: 1;

  opacity: .7;
}


#ndv-input {

  width: 100%;
  min-width: 0;

  height: 100%;

  padding:
    0
    36px
    0
    10px;

  border: 0;
  outline: 0;

  background: transparent;

  color:
    var(--sda-text-primary, #ffffff);

  font-size: 14px;

  box-sizing: border-box;
}


#ndv-input::placeholder {

  color:
    var(--sda-text-muted, #8992a3);
}


#ndv-clear-search {

  position: absolute;

  right: 8px;

  top: 50%;

  transform: translateY(-50%);

  width: 28px;
  height: 28px;

  padding: 0;

  border: 0;

  border-radius: 50%;

  background: transparent;

  color:
    var(--sda-text-muted, #8992a3);

  font-size: 20px;

  cursor: pointer;
}


.ndv-btn {

  flex: 0 0 auto;

  height: 44px;

  padding:
    0
    15px;

  border: 0;

  border-radius: 14px;

  color: #ffffff;

  font-weight: 800;

  font-size: 13px;

  cursor: pointer;

  box-sizing: border-box;
}


.ndv-btn--green {

  background:
    linear-gradient(
      135deg,
      #22c55e,
      #16a34a
    );

  box-shadow:
    0 5px 15px rgba(34,197,94,.18);
}


/* ==========================================================================
   ÖNERİLER
   ========================================================================== */

#ndv-suggestions {

  width: 100%;

  max-height: 180px;

  display: none;

  flex: 0 0 auto;

  overflow-y: auto;

  box-sizing: border-box;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.12));

  border-radius: 13px;

  background:
    var(--sda-bg-elevated, #191e27);

  box-shadow:
    0 12px 30px rgba(0,0,0,.25);

  z-index: 2000;
}


#ndv-suggestions button {

  width: 100%;

  padding:
    12px
    13px;

  text-align: left;

  border: 0;

  border-bottom:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.08));

  background: transparent;

  color:
    var(--sda-text-primary, #ffffff);

  font-size: 13px;

  cursor: pointer;
}


/* ==========================================================================
   HARİTA
   ========================================================================== */

#ndv-map-wrap {

  position: relative;

  width: 100%;

  flex:
    1
    1
    0;

  min-height: 0;
  min-width: 0;

  overflow: hidden;

  box-sizing: border-box;

  border-radius: 18px;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.12));

  background:
    #d8dde4;

  box-shadow:
    0 5px 20px rgba(0,0,0,.12);
}


#ndv-map {

  position: absolute !important;

  inset: 0 !important;

  width: 100% !important;

  height: 100% !important;

  min-width: 0 !important;
  min-height: 0 !important;

  z-index: 1;
}


/* ==========================================================================
   YÜKLENİYOR
   ========================================================================== */

#ndv-loading {

  position: absolute;

  inset: 0;

  z-index: 1000;

  display: flex;

  flex-direction: column;

  align-items: center;

  justify-content: center;

  gap: 8px;

  background:
    rgba(8,12,18,.82);

  color: #ffffff;

  pointer-events: none;

  transition:
    opacity .2s ease;
}


#ndv-loading.hidden {

  opacity: 0;

  visibility: hidden;
}


.ndv-spinner {

  width: 30px;
  height: 30px;

  border:
    3px solid
    rgba(255,255,255,.18);

  border-top-color:
    #22c55e;

  border-radius: 50%;

  animation:
    ndv-spin .8s linear infinite;
}


@keyframes ndv-spin {

  to {
    transform: rotate(360deg);
  }

}


/* ==========================================================================
   HIZ
   ========================================================================== */

#ndv-top-info {

  position: absolute;

  left: 10px;
  top: 10px;

  z-index: 900;

  display: flex;

  align-items: center;

  gap: 8px;

  pointer-events: none;
}


#ndv-speed-card {

  min-width: 68px;
  height: 68px;

  display: flex;

  flex-direction: column;

  align-items: center;

  justify-content: center;

  border-radius: 50%;

  box-sizing: border-box;

  background:
    rgba(12,16,23,.91);

  border:
    2px solid
    rgba(255,255,255,.22);

  color: #ffffff;

  box-shadow:
    0 5px 15px rgba(0,0,0,.3);
}


#ndv-speed-val {

  font-size: 23px;

  line-height: 22px;

  font-weight: 900;
}


#ndv-speed-val.over {

  color:
    #ff4d5a;
}


#ndv-speed-card span {

  margin-top: 3px;

  font-size: 8px;

  opacity: .65;
}


/* ==========================================================================
   HIZ LİMİTİ
   ========================================================================== */

#ndv-limit-badge {

  width: 49px;
  height: 49px;

  display: flex;

  align-items: center;

  justify-content: center;

  border-radius: 50%;

  box-sizing: border-box;

  background: #ffffff;

  border:
    4px solid
    #dc2626;

  color: #111111;

  box-shadow:
    0 4px 12px rgba(0,0,0,.3);
}


#ndv-limit-val {

  font-size: 15px;

  font-weight: 900;
}


/* ==========================================================================
   RADAR
   ========================================================================== */

#ndv-camera-badge {

  position: absolute;

  right: 10px;

  bottom: 63px;

  z-index: 900;

  padding:
    7px
    11px;

  border-radius: 12px;

  background:
    rgba(220,38,38,.92);

  color: #ffffff;

  font-size: 11px;

  font-weight: 800;

  box-shadow:
    0 4px 14px rgba(0,0,0,.25);
}


/* ==========================================================================
   TAKİP BUTONU
   ========================================================================== */

#ndv-follow-btn {

  position: absolute;

  right: 10px;

  bottom: 10px;

  z-index: 900;

  width: 44px;
  height: 44px;

  padding: 0;

  border: 0;

  border-radius: 50%;

  background:
    rgba(12,16,23,.92);

  color: #ffffff;

  font-size: 23px;

  cursor: pointer;

  box-shadow:
    0 5px 15px rgba(0,0,0,.3);
}


#ndv-follow-btn.active {

  outline:
    2px solid
    #22c55e;

  color:
    #22c55e;
}


/* ==========================================================================
   İSTATİSTİKLER
   ========================================================================== */

#ndv-stats {

  width: 100%;

  min-width: 0;

  display: grid;

  grid-template-columns:
    repeat(5, minmax(0, 1fr));

  gap: 5px;

  flex: 0 0 auto;
}


.ndv-stat {

  min-width: 0;

  padding:
    7px
    2px;

  text-align: center;

  box-sizing: border-box;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.1));

  border-radius: 11px;

  background:
    var(--sda-bg-elevated, #191e27);

  overflow: hidden;
}


.ndv-stat span {

  display: block;

  font-size: 7px;

  line-height: 9px;

  font-weight: 800;

  color:
    var(--sda-text-muted, #8992a3);
}


.ndv-stat strong {

  display: block;

  margin-top: 2px;

  font-size: 14px;

  line-height: 17px;

  font-weight: 900;

  color:
    var(--sda-text-primary, #ffffff);

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;
}


.ndv-stat small {

  display: block;

  font-size: 7px;

  line-height: 8px;

  color:
    var(--sda-text-muted, #8992a3);
}


/* ==========================================================================
   KISA YOLLAR
   ========================================================================== */

#ndv-shortcuts {

  width: 100%;

  min-width: 0;

  display: flex;

  gap: 6px;

  flex: 0 0 auto;
}


#ndv-shortcuts button {

  min-width: 0;

  flex: 1;

  height: 42px;

  display: flex;

  align-items: center;

  justify-content: center;

  gap: 6px;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.1));

  border-radius: 12px;

  background:
    var(--sda-bg-elevated, #191e27);

  color:
    var(--sda-text-primary, #ffffff);

  font-size: 11px;

  font-weight: 800;

  cursor: pointer;

  box-sizing: border-box;
}


.ndv-shortcut-icon {

  font-size: 17px;

  line-height: 1;
}


/* ==========================================================================
   ROTA ÖZETİ
   ========================================================================== */

#ndv-summary {

  width: 100%;

  min-width: 0;

  display: none;

  align-items: center;

  gap: 9px;

  padding:
    9px;

  box-sizing: border-box;

  border:
    1px solid
    var(--sda-hairline, rgba(255,255,255,.1));

  border-radius: 13px;

  background:
    var(--sda-bg-elevated, #191e27);
}


.ndv-summary-main {

  min-width: 0;

  flex: 1;

  display: flex;

  align-items: center;

  gap: 8px;
}


.ndv-summary-icon {

  width: 32px;
  height: 32px;

  flex: 0 0 32px;

  display: flex;

  align-items: center;

  justify-content: center;

  border-radius: 10px;

  background:
    rgba(34,197,94,.14);

  color:
    #22c55e;

  font-size: 17px;
}


.ndv-summary-main strong {

  display: block;

  max-width: 100%;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;

  font-size: 12px;
}


.ndv-summary-main small,
.ndv-summary-item small {

  display: block;

  margin-top: 1px;

  font-size: 7px;

  color:
    var(--sda-text-muted, #8992a3);
}


.ndv-summary-item {

  flex: 0 0 auto;

  text-align: center;
}


.ndv-summary-item strong {

  display: block;

  font-size: 12px;
}


/* ==========================================================================
   AKSİYON
   ========================================================================== */

#ndv-action-row {

  width: 100%;

  display: none;

  gap: 7px;

  flex: 0 0 auto;
}


#ndv-start-btn {

  flex: 1;

  height: 44px;

  border: 0;

  border-radius: 13px;

  background:
    linear-gradient(
      135deg,
      #22c55e,
      #16a34a
    );

  color: #ffffff;

  font-size: 13px;

  font-weight: 900;

  cursor: pointer;

  box-shadow:
    0 5px 15px rgba(34,197,94,.18);
}


#ndv-cancel-btn {

  height: 44px;

  padding:
    0
    15px;

  border: 0;

  border-radius: 13px;

  background:
    rgba(255,90,95,.13);

  color:
    #ff5a5f;

  font-weight: 800;

  cursor: pointer;
}


/* ==========================================================================
   MESAJ
   ========================================================================== */

#ndv-msg {

  flex: 0 0 auto;

  min-height: 13px;

  margin:
    0
    2px
    0;

  text-align: center;

  color:
    var(--sda-text-muted, #8992a3);

  font-size: 9px;

  line-height: 12px;

  overflow: hidden;

  text-overflow: ellipsis;

  white-space: nowrap;
}


/* ==========================================================================
   LEAFLET
   ========================================================================== */

#ndv-map .leaflet-control-attribution {

  font-size: 8px;
}


#ndv-map .leaflet-control-zoom {

  margin-top: 8px !important;

  margin-right: 8px !important;
}


/* ==========================================================================
   AÇIK TEMA
   ========================================================================== */

:root[data-theme="light"] #ndv-search-box,
:root[data-theme="light"] .ndv-stat,
:root[data-theme="light"] #ndv-shortcuts button,
:root[data-theme="light"] #ndv-summary {

  background:
    var(--sda-bg-elevated, #ffffff);
}


:root[data-theme="light"] #ndv-speed-card {

  background:
    rgba(255,255,255,.94);

  color:
    #14171c;

  border-color:
    rgba(20,23,28,.16);
}


:root[data-theme="light"] #ndv-speed-val {

  color:
    #14171c;
}


/* ==========================================================================
   DAR EKRAN
   ========================================================================== */

@media (max-width: 380px) {

  #ndv-root {

    padding:
      6px
      6px
      4px;

    gap: 5px;
  }


  #ndv-search-row {

    gap: 5px;
  }


  #ndv-search-box,
  .ndv-btn {

    height: 40px;
  }


  #ndv-speed-card {

    min-width: 60px;

    width: 60px;
    height: 60px;
  }


  #ndv-speed-val {

    font-size: 20px;
  }


  #ndv-limit-badge {

    width: 44px;
    height: 44px;
  }


  .ndv-stat {

    padding:
      6px
      1px;
  }


  .ndv-stat strong {

    font-size: 12px;
  }


  .ndv-stat span,
  .ndv-stat small {

    font-size: 6px;
  }


  #ndv-shortcuts button {

    height: 38px;

    font-size: 9px;
  }

}


/* ==========================================================================
   ÇOK DAR EKRAN
   ========================================================================== */

@media (max-width: 330px) {

  #ndv-stats {

    gap: 3px;
  }


  .ndv-stat strong {

    font-size: 11px;
  }


  .ndv-stat span,
  .ndv-stat small {

    font-size: 5px;
  }


  #ndv-shortcuts button {

    gap: 3px;

    font-size: 8px;
  }

}

`;

  document.head.appendChild(style);
}


/* ============================================================================
 * HARİTA BOYUTU
 * ========================================================================== */

function invalidateMapSize(delay = 0) {

  if (!S.map) {
    return;
  }

  const run = () => {

    try {
      S.map.invalidateSize(true);
    } catch {
      // Leaflet henüz hazır değilse sessizce geç.
    }

  };

  if (delay <= 0) {
    requestAnimationFrame(run);
    return;
  }

  setTimeout(run, delay);
}


function scheduleMapResize() {

  [0, 50, 150, 300, 600, 1000].forEach(
    (delay) => invalidateMapSize(delay)
  );

}


/* ============================================================================
 * HARİTA
 * ========================================================================== */

function initMap(lat, lon) {

  if (S.map) {
    invalidateMapSize();
    return;
  }

  const container = el('ndv-map');

  if (!container) {
    return;
  }

  /*
   * Leaflet daha önce initialize edilmiş olabilir.
   */
  if (container._leaflet_id) {

    try {
      delete container._leaflet_id;
    } catch {
      // ignore
    }

  }


  S.map = L.map(
    container,
    {
      center: [
        Number(lat) || 39,
        Number(lon) || 35,
      ],

      zoom: 16,

      zoomControl: true,

      attributionControl: true,

      preferCanvas: true,
    }
  );


  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,

      attribution:
        '© OpenStreetMap contributors',

      updateWhenZooming: false,

      updateWhenIdle: true,
    }
  ).addTo(S.map);


  /*
   * İlk araç işaretçisi.
   */

  S.vehicleMarker = L.marker(
    [
      Number(lat) || 39,
      Number(lon) || 35,
    ],
    {
      icon: buildArrowIcon(0),

      title: 'Aracınız',

      zIndexOffset: 1000,
    }
  ).addTo(S.map);


  /*
   * Kullanıcı haritayı sürüklerse
   * otomatik takip kapanır.
   */

  S.map.on(
    'dragstart',
    () => {

      S.follow = false;

      el('ndv-follow-btn')
        ?.classList
        .remove('active');

    }
  );


  /*
   * Harita zoom edilirse takip kapanmasın.
   * Sadece manuel sürükleme takip modunu kapatır.
   */


  S.map.whenReady(
    () => {

      scheduleMapResize();

      hideLoading();

    }
  );


  /*
   * Harita görünür/gizli sekme geçişlerinde
   * boyutunu yeniden hesaplar.
   */

  scheduleMapResize();
}


/* ============================================================================
 * ARAÇ İKONU
 * ========================================================================== */

function buildArrowIcon(headingDeg = 0) {

  const safeHeading =
    Number.isFinite(Number(headingDeg))
      ? Number(headingDeg)
      : 0;


  return L.divIcon(
    {
      className:
        'ndv-vehicle-arrow',

      html: `
        <div
          style="
            width:0;
            height:0;
            border-left:9px solid transparent;
            border-right:9px solid transparent;
            border-bottom:24px solid var(--sda-accent,#FF8A3D);
            transform:rotate(${safeHeading}deg);
            filter:
              drop-shadow(0 1px 3px rgba(0,0,0,.65));
            transition:
              transform .2s linear;
          "
        ></div>
      `,

      iconSize: [
        18,
        24,
      ],

      iconAnchor: [
        9,
        12,
      ],
    }
  );
}


/* ============================================================================
 * YÜKLENİYOR
 * ========================================================================== */

function hideLoading() {

  const node = el('ndv-loading');

  if (node) {
    node.classList.add('hidden');
  }

}


/* ============================================================================
 * GPS
 * ========================================================================== */

function onNewPosition(pos) {

  if (!pos) {
    return;
  }


  const latitude =
    Number(pos.latitude);

  const longitude =
    Number(pos.longitude);


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return;
  }


  S.lastPos = {
    ...pos,

    latitude,

    longitude,

    speedKmh:
      Number(pos.speedKmh) || 0,

    headingDeg:
      Number(pos.headingDeg) || 0,
  };


  /*
   * Harita yoksa oluştur.
   */

  if (!S.map) {

    initMap(
      latitude,
      longitude
    );

  }


  /*
   * Araç işaretçisi.
   */

  if (S.vehicleMarker) {

    const latlng = [
      latitude,
      longitude,
    ];


    S.vehicleMarker.setLatLng(
      latlng
    );


    S.vehicleMarker.setIcon(
      buildArrowIcon(
        S.lastPos.headingDeg
      )
    );

  }


  /*
   * Otomatik takip.
   */

  if (
    S.map &&
    S.follow
  ) {

    S.map.panTo(
      [
        latitude,
        longitude,
      ],
      {
        animate: true,

        duration: .35,
      }
    );

  }


  /*
   * Hız.
   */

  const speed =
    Math.max(
      0,
      Math.round(
        Number(S.lastPos.speedKmh) || 0
      )
    );


  setTxt(
    'ndv-speed-val',
    String(speed)
  );


  setTxt(
    'ndv-stat-speed',
    String(speed)
  );


  /*
   * Hız limiti aşımı.
   */

  updateSpeedLimitState(
    speed
  );


  /*
   * Rota varsa kalan mesafe.
   */

  if (S.dest) {

    updateRemainingRoute(
      latitude,
      longitude
    );

  }


  /*
   * Hız limiti.
   */

  void updateSpeedLimit(
    latitude,
    longitude,
    speed
  );


  /*
   * Radar.
   */

  updateCameraState(
    latitude,
    longitude
  );

}


/* ============================================================================
 * HIZ LİMİTİ
 * ========================================================================== */

async function updateSpeedLimit(
  lat,
  lon,
  speed
) {

  const now =
    Date.now();


  /*
   * Her GPS paketinde API çağırma.
   */

  if (
    now - S.lastSpeedLimitRequest < 10000
  ) {
    return;
  }


  S.lastSpeedLimitRequest =
    now;


  try {

    const limit =
      await getSpeedLimitNear(
        lat,
        lon
      );


    S.speedLimit =
      limit == null
        ? null
        : Number(limit);


    const text =
      S.speedLimit == null
        ? '--'
        : String(
            Math.round(
              S.speedLimit
            )
          );


    setTxt(
      'ndv-limit-val',
      text
    );


    setTxt(
      'ndv-stat-limit',
      text
    );


    updateSpeedLimitState(
      speed
    );

  } catch {
    // Hız limiti servisi çalışmazsa navigasyon çalışmaya devam eder.
  }

}


function updateSpeedLimitState(speed) {

  const node =
    el('ndv-speed-val');


  if (!node) {
    return;
  }


  const over =
    S.speedLimit !== null &&
    Number(speed) >
      Number(S.speedLimit);


  node.classList.toggle(
    'over',
    over
  );

}


/* ============================================================================
 * CANLI OBD
 * ========================================================================== */

function onLiveData() {

  try {

    const maf =
      getLivePidValue('10');


    if (!maf) {
      return;
    }


    const lph =
      estimateLitersPerHour(
        Number(maf.value)
      );


    if (
      !Number.isFinite(lph)
    ) {
      return;
    }


    const obdSpeed =
      getLivePidValue('0D');


    const kmh =
      obdSpeed
        ? Number(obdSpeed.value)
        : Number(
            S.lastPos?.speedKmh || 0
          );


    const l100 =
      estimateLitersPer100Km(
        lph,
        kmh
      );


    if (
      l100 !== null &&
      Number.isFinite(Number(l100))
    ) {

      setTxt(
        'ndv-stat-cons',
        Number(l100).toFixed(1)
      );

    } else {

      setTxt(
        'ndv-stat-cons',
        Number(lph).toFixed(1)
      );

    }

  } catch {
    // OBD tüketim verisi navigasyonu durdurmamalıdır.
  }

}


/* ============================================================================
 * RADAR
 * ========================================================================== */

function updateCameraState(lat, lon) {

  const now =
    Date.now();


  if (
    now - S.lastCameraCheck < 3000
  ) {
    return;
  }


  S.lastCameraCheck =
    now;


  const cameras =
    getCachedCameras();


  const badge =
    el('ndv-camera-badge');


  if (!badge) {
    return;
  }


  /*
   * Mevcut servis yalnızca cache sağlıyorsa
   * burada güvenli şekilde gösteriyoruz.
   */

  if (
    Array.isArray(cameras) &&
    cameras.length > 0
  ) {

    badge.style.display =
      'block';

  } else {

    badge.style.display =
      'none';

  }

}


function renderCameraMarkers(cameras) {

  if (!S.map) {
    return;
  }


  S.cameraMarkers.forEach(
    (marker) => {

      try {
        S.map.removeLayer(
          marker
        );
      } catch {
        // ignore
      }

    }
  );


  S.cameraMarkers = [];


  if (
    !Array.isArray(cameras)
  ) {
    return;
  }


  /*
   * Haritayı kalabalıklaştırmamak için
   * en fazla 15 kamera.
   */

  cameras
    .slice(0, 15)
    .forEach(
      (camera) => {

        const lat =
          Number(camera?.lat);

        const lon =
          Number(camera?.lon);


        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          return;
        }


        const marker =
          L.circleMarker(
            [
              lat,
              lon,
            ],
            {
              radius: 7,

              color: '#DC2626',

              weight: 2,

              fillColor: '#EF4444',

              fillOpacity: .75,
            }
          )
          .addTo(S.map);


        marker.bindPopup(
          '📸 Radar / Kamera'
        );


        S.cameraMarkers.push(
          marker
        );

      }
    );

}


/* ============================================================================
 * ROTA İSTATİSTİKLERİ
 * ========================================================================== */

function updateRemainingRoute(
  lat,
  lon
) {

  if (!S.dest) {
    return;
  }


  /*
   * Hedefe düz mesafe.
   * Rota servisi toplam rota mesafesini
   * başlangıçta verir; canlı kalan mesafede
   * güvenli yaklaşık değer kullanıyoruz.
   */

  const remaining =
    haversineKm(
      lat,
      lon,
      Number(S.dest.lat),
      Number(S.dest.lon)
    );


  /*
   * ETA için mevcut hız.
   */

  const speed =
    Number(
      S.lastPos?.speedKmh
    ) || 0;


  let etaMin;


  if (
    speed > 5
  ) {

    etaMin =
      remaining /
      speed *
      60;

  } else {

    /*
     * Araç duruyorsa rota tahmini
     * için 50 km/sa varsayımı.
     */

    etaMin =
      remaining /
      50 *
      60;

  }


  updateStats(
    {
      dist: remaining,

      etaMin,
    }
  );

}


function updateStats({
  dist,
  etaMin,
}) {

  if (
    dist !== undefined &&
    Number.isFinite(Number(dist))
  ) {

    const km =
      Number(dist);


    if (km >= 1) {

      setTxt(
        'ndv-stat-dist',
        `${km.toFixed(1)}`
      );

    } else {

      setTxt(
        'ndv-stat-dist',
        `${Math.round(km * 1000)} m`
      );

    }

  }


  if (
    etaMin !== undefined &&
    Number.isFinite(Number(etaMin))
  ) {

    const arrival =
      new Date(
        Date.now() +
        Number(etaMin) *
        60000
      );


    const hours =
      String(
        arrival.getHours()
      ).padStart(
        2,
        '0'
      );


    const minutes =
      String(
        arrival.getMinutes()
      ).padStart(
        2,
        '0'
      );


    setTxt(
      'ndv-stat-eta',
      `${hours}:${minutes}`
    );

  }

}


function clearStats() {

  setTxt(
    'ndv-stat-dist',
    '--'
  );


  setTxt(
    'ndv-stat-eta',
    '--'
  );

}


/* ============================================================================
 * ROTA HESAPLAMA
 * ========================================================================== */

async function routeTo(dest) {

  if (
    !S.map ||
    !dest
  ) {
    return;
  }


  const lat =
    Number(dest.lat);

  const lon =
    Number(
      dest.lon ?? dest.lng
    );


  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {

    setMsg(
      'Hedef konumu geçersiz.'
    );

    return;

  }


  setMsg(
    'Rota hesaplanıyor…'
  );


  clearStats();


  const from =
    S.lastPos ||
    getLastPosition();


  if (!from) {

    setMsg(
      'Konum henüz alınamadı.'
    );

    return;

  }


  try {

    const routes =
      await getDrivingRoute(
        {
          lat:
            Number(from.latitude),

          lon:
            Number(from.longitude),
        },

        {
          lat,

          lon,
        },

        {
          destinationLabel:
            dest.label ||
            'Hedef',
        }
      );


    if (
      !Array.isArray(routes) ||
      routes.length === 0
    ) {

      setMsg(
        'Rota bulunamadı. İnternet bağlantısını kontrol edin.'
      );

      return;

    }


    const best =
      routes[0];


    /*
     * Eski rota.
     */

    if (S.routeLine) {

      try {
        S.map.removeLayer(
          S.routeLine
        );
      } catch {
        // ignore
      }

      S.routeLine = null;

    }


    /*
     * Eski hedef.
     */

    if (S.destMarker) {

      try {
        S.map.removeLayer(
          S.destMarker
        );
      } catch {
        // ignore
      }

      S.destMarker = null;

    }


    /*
     * Yeni rota.
     */

    if (
      Array.isArray(best.coordinates) &&
      best.coordinates.length > 0
    ) {

      S.routeLine =
        L.polyline(
          best.coordinates,
          {
            color:
              '#3B82F6',

            weight: 6,

            opacity: .92,

            lineJoin: 'round',

            lineCap: 'round',
          }
        ).addTo(S.map);

    }


    /*
     * Hedef işaretçisi.
     */

    S.destMarker =
      L.marker(
        [
          lat,
          lon,
        ]
      )
      .addTo(S.map)
      .bindPopup(
        escapeHtml(
          dest.label ||
          'Hedef'
        )
      );


    /*
     * Haritayı rotaya sığdır.
     */

    if (
      S.routeLine
    ) {

      try {

        S.map.fitBounds(
          S.routeLine.getBounds(),
          {
            padding:
              [
                40,
                40,
              ],

            maxZoom: 16,
          }
        );

      } catch {
        // ignore
      }

    }


    const distanceKm =
      Number(
        best.distanceKm
      ) || 0;


    const durationMin =
      Number(
        best.durationMinutes
      ) || 0;


    S.dest = {

      lat,

      lon,

      label:
        dest.label ||
        'Hedef',

      distKm:
        distanceKm,

      durationMin,
    };


    /*
     * Rota çizildiğinde harita fitBounds
     * yaptığı için takip geçici olarak kapatılır.
     */

    S.follow = false;


    el('ndv-follow-btn')
      ?.classList
      .remove('active');


    /*
     * Özet.
     */

    const distText =
      distanceKm >= 1
        ? `${distanceKm.toFixed(1)} km`
        : `${Math.round(distanceKm * 1000)} m`;


    const durationText =
      `~${Math.round(durationMin)} dk`;


    setTxt(
      'ndv-sum-label',
      dest.label ||
      'Hedef'
    );


    setTxt(
      'ndv-sum-dist',
      distText
    );


    setTxt(
      'ndv-sum-dur',
      durationText
    );


    setDisplay(
      'ndv-summary',
      'flex'
    );


    setDisplay(
      'ndv-action-row',
      'flex'
    );


    setDisplay(
      'ndv-shortcuts',
      'none'
    );


    updateStats(
      {
        dist:
          distanceKm,

        etaMin:
          durationMin,
      }
    );


    setMsg(
      `${dest.label || 'Hedef'} · ${distText} · ${durationText}`
    );

  } catch (error) {

    console.error(
      '[navigation-drive] route error',
      error
    );


    setMsg(
      'Rota hesaplanırken bir hata oluştu.'
    );

  }

}


/* ============================================================================
 * ROTA İPTAL
 * ========================================================================== */

function cancelRoute() {

  if (S.routeLine) {

    try {
      S.map?.removeLayer(
        S.routeLine
      );
    } catch {
      // ignore
    }

    S.routeLine = null;

  }


  if (S.destMarker) {

    try {
      S.map?.removeLayer(
        S.destMarker
      );
    } catch {
      // ignore
    }

    S.destMarker = null;

  }


  S.dest = null;


  setDisplay(
    'ndv-summary',
    'none'
  );


  setDisplay(
    'ndv-action-row',
    'none'
  );


  setDisplay(
    'ndv-shortcuts',
    'flex'
  );


  const input =
    el('ndv-input');


  if (input) {
    input.value = '';
  }


  clearStats();


  setMsg(
    'Rota iptal edildi.'
  );


  /*
   * Araç takibini yeniden aç.
   */

  S.follow = true;


  el('ndv-follow-btn')
    ?.classList
    .add('active');


  if (
    S.map &&
    S.lastPos
  ) {

    S.map.setView(
      [
        S.lastPos.latitude,
        S.lastPos.longitude,
      ],

      16,

      {
        animate: true,
      }
    );

  }

}


/* ============================================================================
 * ADRES ARAMA
 * ========================================================================== */

async function doSearch(query) {

  const q =
    String(query || '')
      .trim();


  if (!q) {
    return;
  }


  hideSuggestions();


  setMsg(
    'Adres aranıyor…'
  );


  try {

    const results =
      await searchAddress(
        q,
        5
      );


    if (
      !Array.isArray(results) ||
      results.length === 0
    ) {

      setMsg(
        `"${q}" için sonuç bulunamadı.`
      );

      return;

    }


    if (
      results.length === 1
    ) {

      const result =
        results[0];


      await routeTo(
        {
          lat:
            result.lat,

          lon:
            result.lon,

          label:
            shortLabel(
              result.label
            ),
        }
      );


      return;

    }


    showSuggestions(
      results
    );

  } catch (error) {

    console.error(
      '[navigation-drive] search error',
      error
    );


    setMsg(
      'Adres aranırken bir hata oluştu.'
    );

  }

}


function showSuggestions(results) {

  const box =
    el('ndv-suggestions');


  if (!box) {
    return;
  }


  box.innerHTML = '';


  results.forEach(
    (result, index) => {

      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.dataset.si =
        String(index);


      button.textContent =
        shortLabel(
          result.label
        );


      button.addEventListener(
        'click',
        async () => {

          hideSuggestions();


          const input =
            el('ndv-input');


          if (input) {

            input.value =
              shortLabel(
                result.label
              );

          }


          await routeTo(
            {
              lat:
                result.lat,

              lon:
                result.lon,

              label:
                shortLabel(
                  result.label
                ),
            }
          );

        }
      );


      box.appendChild(
        button
      );

    }
  );


  box.style.display =
    'block';

}


function hideSuggestions() {

  const box =
    el('ndv-suggestions');


  if (!box) {
    return;
  }


  box.style.display =
    'none';


  box.innerHTML =
    '';

}


function shortLabel(label) {

  if (!label) {
    return 'Hedef';
  }


  return String(label)
    .split(',')
    .slice(0, 3)
    .join(',')
    .trim();

}


/* ============================================================================
 * FAVORİLER
 * ========================================================================== */

async function routeToFavorite(id) {

  try {

    const module =
      await import(
        '../maps/favorites-store.js'
      );


    const fav =
      module.getFavoriteLocation(
        id
      );


    if (!fav) {

      setMsg(
        `${id === 'home' ? 'Ev' : 'İş'} konumu henüz ayarlanmadı.`
      );

      return;

    }


    await routeTo(
      {
        lat:
          fav.lat,

        lon:
          fav.lon ??
          fav.lng,

        label:
          fav.label ??
          (
            id === 'home'
              ? 'Ev'
              : 'İş'
          ),
      }
    );

  } catch (error) {

    console.error(
      '[navigation-drive] favorite error',
      error
    );


    setMsg(
      'Favori konuma rota çizilemedi.'
    );

  }

}


/* ============================================================================
 * KISA YOL: KONUMUM
 * ========================================================================== */

function centerOnVehicle() {

  if (
    !S.map ||
    !S.lastPos
  ) {
    setMsg(
      'GPS konumu henüz alınamadı.'
    );

    return;
  }


  S.follow = true;


  el('ndv-follow-btn')
    ?.classList
    .add('active');


  S.map.setView(
    [
      S.lastPos.latitude,
      S.lastPos.longitude,
    ],

    16,

    {
      animate: true,
    }
  );


  setMsg(
    'Araç konumuna odaklanıldı.'
  );

}


/* ============================================================================
 * YARDIMCI
 * ========================================================================== */

function haversineKm(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R =
    6371;


  const dLat =
    (
      Number(lat2) -
      Number(lat1)
    ) *
    Math.PI /
    180;


  const dLon =
    (
      Number(lon2) -
      Number(lon1)
    ) *
    Math.PI /
    180;


  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      Number(lat1) *
      Math.PI /
      180
    ) *

    Math.cos(
      Number(lat2) *
      Math.PI /
      180
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;


  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );

}


function escapeHtml(text) {

  return String(text ?? '')
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );

}


/* ============================================================================
 * EVENT BAĞLANTILARI
 * ========================================================================== */

function bindEvents(view) {

  /*
   * Ara.
   */

  el('ndv-search-btn')
    ?.addEventListener(
      'click',
      () => {

        const input =
          el('ndv-input');


        const q =
          input?.value?.trim();


        if (q) {
          void doSearch(q);
        }

      }
    );


  /*
   * Enter.
   */

  el('ndv-input')
    ?.addEventListener(
      'keydown',
      (event) => {

        if (
          event.key !== 'Enter'
        ) {
          return;
        }


        event.preventDefault();


        const q =
          event.target
            ?.value
            ?.trim();


        if (q) {
          void doSearch(q);
        }

      }
    );


  /*
   * Arama temizle.
   */

  el('ndv-clear-search')
    ?.addEventListener(
      'click',
      () => {

        const input =
          el('ndv-input');


        if (input) {
          input.value = '';
          input.focus();
        }


        hideSuggestions();

      }
    );


  /*
   * Takip.
   */

  el('ndv-follow-btn')
    ?.addEventListener(
      'click',
      centerOnVehicle
    );


  /*
   * BAŞLA
   *
   * ÖNEMLİ:
   * Burada yalnızca BİR listener var.
   * Önceki kodda aynı listener iki kez eklenmişti.
   */

  el('ndv-start-btn')
    ?.addEventListener(
      'click',
      () => {

        S.follow = true;


        el('ndv-follow-btn')
          ?.classList
          .add('active');


        if (
          S.map &&
          S.lastPos
        ) {

          S.map.setView(
            [
              S.lastPos.latitude,
              S.lastPos.longitude,
            ],

            16,

            {
              animate: true,
            }
          );

        }


        setMsg(
          'Navigasyon başladı. İyi yolculuklar!'
        );

      }
    );


  /*
   * İPTAL
   */

  el('ndv-cancel-btn')
    ?.addEventListener(
      'click',
      cancelRoute
    );


  /*
   * Kısa yollar.
   */

  view
    .querySelectorAll(
      '#ndv-shortcuts [data-dest]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          async () => {

            const dest =
              button.dataset.dest;


            if (
              dest === 'locate'
            ) {

              centerOnVehicle();

              return;

            }


            await routeToFavorite(
              dest
            );

          }
        );

      }
    );


  /*
   * Sayfanın dışına tıklayınca önerileri kapat.
   */

  view.addEventListener(
    'click',
    (event) => {

      const target =
        event.target;


      if (
        !(target instanceof Element)
      ) {
        return;
      }


      if (
        !target.closest(
          '#ndv-suggestions'
        ) &&
        !target.closest(
          '#ndv-input'
        )
      ) {

        hideSuggestions();

      }

    }
  );

}


/* ============================================================================
 * INIT
 * ========================================================================== */

export async function initNavigationDriveView() {

  /*
   * Aynı ekran ikinci kez initialize edilmesin.
   */

  if (S.initialized) {

    scheduleMapResize();

    return;

  }


  injectCss();


  const view =
    ensureLayout();


  if (!view) {

    console.warn(
      '[navigation-drive] navigation-drive view bulunamadı.'
    );

    return;

  }


  S.initialized =
    true;


  /*
   * GPS aboneliği.
   */

  S.posUnsubscribe?.();


  S.posUnsubscribe =
    onPosition(
      onNewPosition
    );


  /*
   * OBD canlı veri.
   */

  S.liveUnsubscribe?.();


  S.liveUnsubscribe =
    onLiveDataChange(
      onLiveData
    );


  /*
   * Eventler.
   */

  bindEvents(
    view
  );


  /*
   * Kamera güncellemesi.
   */

  try {

    S.cameraUnsubscribe =
      onCamerasUpdate(
        renderCameraMarkers
      );

  } catch {
    S.cameraUnsubscribe =
      null;
  }


  /*
   * View değişince Leaflet'i yeniden boyutlandır.
   */

  try {

    S.viewUnsubscribe =
      onViewChange(
        (viewName) => {

          if (
            viewName !==
            'navigation-drive'
          ) {
            return;
          }


          scheduleMapResize();


          if (S.lastPos) {

            S.follow = true;


            el('ndv-follow-btn')
              ?.classList
              .add('active');

          }

        }
      );

  } catch {
    S.viewUnsubscribe =
      null;
  }


  /*
   * Mevcut GPS.
   */

  const last =
    getLastPosition();


  if (last) {

    initMap(
      last.latitude,
      last.longitude
    );


    onNewPosition(
      last
    );

  } else {

    /*
     * GPS henüz yoksa Türkiye merkezinde
     * boş harita göstermek yerine kısa süre bekle.
     */

    setMsg(
      'GPS konumu bekleniyor…'
    );


    setTimeout(
      () => {

        if (
          !S.map &&
          S.initialized
        ) {

          initMap(
            39.0,
            35.0
          );


          setMsg(
            'GPS konumu bekleniyor…'
          );

        }

      },

      1200
    );

  }


  /*
   * Pencere boyutu.
   */

  window.addEventListener(
    'resize',
    () => {

      clearTimeout(
        S.resizeTimer
      );


      S.resizeTimer =
        setTimeout(
          () => {

            invalidateMapSize();

          },

          120
        );

    }
  );


  /*
   * Başlangıç takip durumu.
   */

  el('ndv-follow-btn')
    ?.classList
    .add('active');


  setMsg(
    'Navigasyon hazır.'
  );

}


/* ============================================================================
 * DESTROY
 * ========================================================================== */

export function destroyNavigationDriveView() {

  S.posUnsubscribe?.();

  S.posUnsubscribe =
    null;


  S.liveUnsubscribe?.();

  S.liveUnsubscribe =
    null;


  S.cameraUnsubscribe?.();

  S.cameraUnsubscribe =
    null;


  S.viewUnsubscribe?.();

  S.viewUnsubscribe =
    null;


  S.cameraMarkers.forEach(
    (marker) => {

      try {

        S.map?.removeLayer(
          marker
        );

      } catch {
        // ignore
      }

    }
  );


  S.cameraMarkers =
    [];


  try {

    S.map?.remove();

  } catch {
    // ignore
  }


  S.map =
    null;


  S.vehicleMarker =
    null;


  S.routeLine =
    null;


  S.destMarker =
    null;


  S.dest =
    null;


  S.lastPos =
    null;


  S.speedLimit =
    null;


  S.follow =
    true;


  S.initialized =
    false;


  const style =
    document.getElementById(
      'ndv-style'
    );


  style?.remove();

}
