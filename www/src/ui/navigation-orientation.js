/**
 * navigation-orientation.js
 * ---------------------------------------------------------------------------
 * Navigasyon sırasında "heading-up" görünümünü sağlar.
 *
 * Leaflet'in çekirdeğinde native map bearing desteği yoktur. Bu modül,
 * navigation-drive haritasının map pane'ine yalnızca görsel bir dönüş uygular:
 *
 *   araç yönü 90° (Doğu) -> harita -90° döner -> araç ekranda yukarı kalır.
 *
 * Mevcut navigation-drive-view.js içindeki araç oku da aynı heading'i
 * kullandığı için harita + ok birlikte Google Maps benzeri heading-up
 * görünümü verir.
 *
 * Önemli güvenlik davranışları:
 * - Yalnızca "Navigasyonu Başlat" tıklanınca aktif olur.
 * - Navigasyon iptal edilince kuzey-up görünümüne döner.
 * - GPS heading yoksa hareketten bearing hesaplanır.
 * - Heading yoksa son güvenilir yön korunur; harita zıplamaz.
 * - Açısal geçişler 359° -> 0° gibi durumlarda kısa yönden yumuşatılır.
 * ---------------------------------------------------------------------------
 */

import { onPosition } from '../core/gps-tracker.js';

const S = {
  active: false,
  heading: 0,
  lastPosition: null,
  unsubscribePosition: null,
  observer: null,
  boundStart: null,
  boundCancel: null,
};

const MAP_SELECTOR = '#ndv-map .leaflet-map-pane';
const VIEW_SELECTOR = '[data-view="navigation-drive"]';

function getMapPane() {
  return document.querySelector(MAP_SELECTOR);
}

function normalizeHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

function shortestAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function smoothHeading(target) {
  const safeTarget = normalizeHeading(target);
  if (safeTarget == null) return S.heading;

  const delta = shortestAngleDelta(S.heading, safeTarget);

  // Büyük ilk yön değişiminde hızlı yerleş, normal sürüşte yumuşat.
  const alpha = Math.abs(delta) > 45 ? 0.42 : 0.22;
  S.heading = normalizeHeading(S.heading + delta * alpha) ?? S.heading;
  return S.heading;
}

function bearingBetween(a, b) {
  if (!a || !b) return null;

  const lat1 = Number(a.latitude) * Math.PI / 180;
  const lat2 = Number(b.latitude) * Math.PI / 180;
  const dLon = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;

  if (![lat1, lat2, dLon].every(Number.isFinite)) return null;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return normalizeHeading(bearing);
}

function effectiveHeading(position) {
  const gpsHeading = normalizeHeading(position?.headingDeg);

  // GPS'in gerçek heading'i, hareket halinde en güvenilir kaynaktır.
  if (gpsHeading != null && Number(position?.speedKmh) >= 3) {
    return gpsHeading;
  }

  // Bazı cihazlar coords.heading'i hiç vermiyor. İki GPS noktası arasında
  // hareketten yön çıkarıyoruz.
  const derived = bearingBetween(S.lastPosition, position);
  if (derived != null) {
    const distanceEnough = haversineMeters(S.lastPosition, position) >= 3;
    const timeEnough = !S.lastPosition
      || !position.timestamp
      || !S.lastPosition.timestamp
      || (Number(position.timestamp) - Number(S.lastPosition.timestamp)) >= 250;

    if (distanceEnough && timeEnough && Number(position?.speedKmh) >= 2) {
      return derived;
    }
  }

  // Araç duruyorsa son güvenilir yönü koru.
  return S.heading;
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;

  const R = 6371000;
  const lat1 = Number(a.latitude) * Math.PI / 180;
  const lat2 = Number(b.latitude) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (Number(b.longitude) - Number(a.longitude)) * Math.PI / 180;

  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function stripOurRotation(transform) {
  return String(transform || '').replace(/\srotate\((-?(?:\d+(?:\.\d+)?))deg\)\s*$/i, '').trim();
}

function applyRotation() {
  const pane = getMapPane();
  if (!pane) return;

  const baseTransform = stripOurRotation(pane.style.transform);

  if (!S.active) {
    pane.style.transform = baseTransform;
    pane.style.transformOrigin = '';
    pane.style.transition = '';
    return;
  }

  // Leaflet'in kendi translate3d() transformunu koruyup yalnızca dönüş ekliyoruz.
  pane.style.transformOrigin = '50% 50%';
  pane.style.transition = 'transform 120ms linear';
  pane.style.transform = `${baseTransform} rotate(${-S.heading}deg)`.trim();
}

function onGpsPosition(position) {
  if (!position) return;

  if (S.active) {
    const target = effectiveHeading(position);
    smoothHeading(target);
    applyRotation();
  }

  S.lastPosition = position;
}

function resetRotation() {
  S.active = false;
  S.heading = 0;

  const pane = getMapPane();
  if (!pane) return;

  pane.style.transform = stripOurRotation(pane.style.transform);
  pane.style.transformOrigin = '';
  pane.style.transition = '';
}

function startNavigationOrientation() {
  const view = document.querySelector(VIEW_SELECTOR);
  if (!view || view.hidden) return;

  S.active = true;

  const current = S.lastPosition;
  const heading = normalizeHeading(current?.headingDeg);
  if (heading != null) S.heading = heading;

  applyRotation();
}

function bindButtons() {
  const start = document.getElementById('ndv-start-btn');
  const cancel = document.getElementById('ndv-cancel-btn');

  if (start && start !== S.boundStart) {
    S.boundStart = start;
    start.addEventListener('click', startNavigationOrientation);
  }

  if (cancel && cancel !== S.boundCancel) {
    S.boundCancel = cancel;
    cancel.addEventListener('click', resetRotation);
  }
}

function watchNavigationDom() {
  bindButtons();

  S.observer = new MutationObserver(() => {
    bindButtons();

    const view = document.querySelector(VIEW_SELECTOR);
    if (view?.hidden && S.active) resetRotation();

    if (S.active && getMapPane()) applyRotation();
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

  S.unsubscribePosition = onPosition(onGpsPosition);
  watchNavigationDom();
}

export function destroyNavigationOrientation() {
  S.unsubscribePosition?.();
  S.unsubscribePosition = null;
  S.observer?.disconnect();
  S.observer = null;
  S.boundStart = null;
  S.boundCancel = null;
  resetRotation();
  S.lastPosition = null;
}

// navigation-drive-visibility-fix.js bu modülü dinamik olarak yüklediği için
// ayrıca app-init.js içine yeni bir import eklemek gerekmez.
initNavigationOrientation();
