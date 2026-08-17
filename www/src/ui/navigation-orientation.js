/**
 * navigation-orientation.js
 * Google Maps benzeri sürüş modu: araç yukarıda kalır, harita heading'e göre döner.
 * Ayrıca navigasyon sırasında haritayı tam ekran yapar ve yakınlaştırır.
 */

import { onPosition } from '../core/gps-tracker.js';

const S = {
  active: false,
  heading: 0,
  lastPosition: null,
  unsubscribePosition: null,
  observer: null,
  frame: 0,
  boundStart: null,
  boundCancel: null,
  savedNavDisplay: '',
};

const VIEW_SELECTOR = '[data-view="navigation-drive"]';
const PANE_SELECTOR = '#ndv-map .leaflet-map-pane';

function getPane() {
  return document.querySelector(PANE_SELECTOR);
}

function getView() {
  return document.querySelector(VIEW_SELECTOR);
}

function normalizeHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

function shortestDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const p1 = Number(a.latitude) * Math.PI / 180;
  const p2 = Number(b.latitude) * Math.PI / 180;
  const dp = p2 - p1;
  const dl = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2
    + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function bearingBetween(a, b) {
  if (!a || !b) return null;
  const p1 = Number(a.latitude) * Math.PI / 180;
  const p2 = Number(b.latitude) * Math.PI / 180;
  const dl = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2)
    - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeHeading(Math.atan2(y, x) * 180 / Math.PI);
}

function getEffectiveHeading(position) {
  const gpsHeading = normalizeHeading(position?.headingDeg);

  if (gpsHeading != null && Number(position?.speedKmh) >= 3) {
    return gpsHeading;
  }

  const derived = bearingBetween(S.lastPosition, position);
  if (
    derived != null
    && haversineMeters(S.lastPosition, position) >= 3
    && Number(position?.speedKmh) >= 2
  ) {
    return derived;
  }

  return S.heading;
}

function stripRotation(transform) {
  return String(transform || '')
    .replace(/\srotate\(-?(?:\d+(?:\.\d+)?)deg\)\s*$/i, '')
    .trim();
}

function applyRotation() {
  const pane = getPane();
  if (!pane || !S.active) return;

  // Leaflet pan/zoom sırasında transform'u yeniden yazar. Bu nedenle mevcut
  // Leaflet transformunu her frame okuyup dönüşü tekrar ekliyoruz.
  const base = stripRotation(pane.style.transform);
  pane.style.transformOrigin = '50% 50%';
  pane.style.transform = `${base} rotate(${-S.heading}deg)`.trim();
}

function rotationLoop() {
  if (!S.active) {
    S.frame = 0;
    return;
  }

  applyRotation();
  S.frame = requestAnimationFrame(rotationLoop);
}

function startRotationLoop() {
  if (S.frame) cancelAnimationFrame(S.frame);
  S.frame = requestAnimationFrame(rotationLoop);
}

function stopRotationLoop() {
  if (S.frame) cancelAnimationFrame(S.frame);
  S.frame = 0;
}

function setFullscreen(active) {
  const view = getView();
  const root = document.getElementById('ndv-root');
  const mapWrap = document.getElementById('ndv-map-wrap');
  if (!view || !root || !mapWrap) return;

  if (active) {
    view.classList.add('ndv-navigation-fullscreen');
    root.classList.add('ndv-driving-root');
    mapWrap.classList.add('ndv-driving-map');

    const bottomNav = document.querySelector('.sda-bottom-nav');
    if (bottomNav) {
      S.savedNavDisplay = bottomNav.style.display;
      bottomNav.style.display = 'none';
    }

    document.documentElement.classList.add('ndv-driving-active');
    document.body.classList.add('ndv-driving-active');
  } else {
    view.classList.remove('ndv-navigation-fullscreen');
    root.classList.remove('ndv-driving-root');
    mapWrap.classList.remove('ndv-driving-map');

    const bottomNav = document.querySelector('.sda-bottom-nav');
    if (bottomNav) bottomNav.style.display = S.savedNavDisplay;

    document.documentElement.classList.remove('ndv-driving-active');
    document.body.classList.remove('ndv-driving-active');
  }
}

function injectFullscreenCss() {
  if (document.getElementById('ndv-orientation-style')) return;

  const style = document.createElement('style');
  style.id = 'ndv-orientation-style';
  style.textContent = `
html.ndv-driving-active,
body.ndv-driving-active {
  overflow: hidden !important;
}

[data-view="navigation-drive"].ndv-navigation-fullscreen {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100dvh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  z-index: 99990 !important;
  background: #000 !important;
}

[data-view="navigation-drive"].ndv-navigation-fullscreen #ndv-root.ndv-driving-root {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
  gap: 0 !important;
  display: block !important;
  overflow: hidden !important;
  background: #000 !important;
}

#ndv-map-wrap.ndv-driving-map {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 100% !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

#ndv-map-wrap.ndv-driving-map #ndv-map {
  width: 100% !important;
  height: 100% !important;
}

#ndv-root.ndv-driving-root #ndv-search-row,
#ndv-root.ndv-driving-root #ndv-suggestions,
#ndv-root.ndv-driving-root #ndv-stats,
#ndv-root.ndv-driving-root #ndv-shortcuts,
#ndv-root.ndv-driving-root #ndv-summary,
#ndv-root.ndv-driving-root #ndv-action-row,
#ndv-root.ndv-driving-root #ndv-msg {
  display: none !important;
}

#ndv-root.ndv-driving-root #ndv-follow-btn {
  width: 50px !important;
  height: 50px !important;
  right: max(14px, env(safe-area-inset-right)) !important;
  bottom: max(22px, env(safe-area-inset-bottom)) !important;
  font-size: 24px !important;
}

#ndv-root.ndv-driving-root #ndv-top-info {
  top: max(16px, env(safe-area-inset-top)) !important;
  left: 14px !important;
}

#ndv-root.ndv-driving-root #ndv-camera-badge {
  bottom: max(22px, env(safe-area-inset-bottom)) !important;
}
`;
  document.head.appendChild(style);
}

function zoomInForDriving() {
  // navigation-drive-view haritası zaten 16 ile açılıyor. Leaflet'in gerçek
  // zoom kontrolünü kullanarak iki kademe daha yakınlaşıyoruz: 18.
  const button = document.querySelector('#ndv-map .leaflet-control-zoom-in');
  if (!button) return;
  button.click();
  setTimeout(() => document.querySelector('#ndv-map .leaflet-control-zoom-in')?.click(), 80);
}

function startNavigation() {
  const view = getView();
  if (!view || view.hidden) return;

  S.active = true;

  const current = S.lastPosition;
  const initial = normalizeHeading(current?.headingDeg);
  if (initial != null) S.heading = initial;

  injectFullscreenCss();
  setFullscreen(true);
  zoomInForDriving();
  startRotationLoop();

  // Tam ekran geçişinden sonra Leaflet ölçülerini yeniden hesaplaması için
  // zoom kontrolüyle birlikte küçük bir gecikme bırakıyoruz.
  setTimeout(() => {
    applyRotation();
    document.querySelector('#ndv-map .leaflet-control-zoom-in')?.focus?.({ preventScroll: true });
  }, 120);
}

function resetNavigation() {
  S.active = false;
  S.heading = 0;
  stopRotationLoop();

  const pane = getPane();
  if (pane) {
    pane.style.transform = stripRotation(pane.style.transform);
    pane.style.transformOrigin = '';
    pane.style.transition = '';
  }

  setFullscreen(false);
}

function onGpsPosition(position) {
  if (!position) return;

  if (S.active) {
    const target = getEffectiveHeading(position);
    const delta = shortestDelta(S.heading, target);
    const alpha = Math.abs(delta) > 60 ? 0.55 : 0.30;
    S.heading = normalizeHeading(S.heading + delta * alpha) ?? S.heading;
    applyRotation();
  }

  S.lastPosition = position;
}

function bindButtons() {
  const start = document.getElementById('ndv-start-btn');
  const cancel = document.getElementById('ndv-cancel-btn');

  if (start && start !== S.boundStart) {
    S.boundStart = start;
    start.addEventListener('click', startNavigation);
  }

  if (cancel && cancel !== S.boundCancel) {
    S.boundCancel = cancel;
    cancel.addEventListener('click', resetNavigation);
  }
}

function watchDom() {
  bindButtons();

  S.observer = new MutationObserver(() => {
    bindButtons();

    const view = getView();
    if (view?.hidden && S.active) resetNavigation();

    if (S.active) {
      injectFullscreenCss();
      applyRotation();
    }
  });

  S.observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'style'],
  });
}

export function initNavigationOrientation() {
  if (S.unsubscribePosition) return;
  injectFullscreenCss();
  S.unsubscribePosition = onPosition(onGpsPosition);
  watchDom();
}

export function destroyNavigationOrientation() {
  S.unsubscribePosition?.();
  S.unsubscribePosition = null;
  S.observer?.disconnect();
  S.observer = null;
  S.boundStart = null;
  S.boundCancel = null;
  resetNavigation();
  S.lastPosition = null;
}

initNavigationOrientation();
