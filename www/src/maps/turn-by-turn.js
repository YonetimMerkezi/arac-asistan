/**
 * turn-by-turn.js
 * Smart Drive AI — Türkçe dönüş rehberliği + rota dışı otomatik yeniden rota.
 *
 * Ücretsiz altyapı: mevcut route-service.js / OSRM.
 * GPS: core/gps-tracker.js.
 */
import { onPosition } from '../core/gps-tracker.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { getDrivingRoute } from './route-service.js';
import { speak } from '../voice/tts.js';
import { logInfo, logWarn } from '../core/logger.js';

const EARLY_ANNOUNCE_RADIUS_METERS = 220;
const NEAR_ANNOUNCE_RADIUS_METERS = 24;
const OFF_ROUTE_RADIUS_METERS = 85;
const REROUTE_COOLDOWN_MS = 9000;
const ARRIVAL_RADIUS_METERS = 28;

let activeRoute = null;
let destination = null;
let nextStepIndex = 0;
let earlyAnnounced = false;
let unsubscribe = null;
let lastRerouteAt = 0;
let offRouteHits = 0;
const listeners = new Set();

function emit(type, detail = {}) {
  listeners.forEach((fn) => { try { fn(type, detail); } catch {} });
  window.dispatchEvent(new CustomEvent(`sda:navigation:${type}`, { detail }));
}

export function onGuidanceEvent(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getGuidanceState() {
  return {
    active: Boolean(activeRoute),
    destination,
    nextStepIndex,
    nextStep: activeRoute?.steps?.[nextStepIndex] ?? null,
    route: activeRoute,
  };
}

export function startGuidance(route, target = null) {
  stopGuidance(false);
  activeRoute = route;
  destination = target ? { lat: Number(target.lat), lon: Number(target.lon), label: target.label ?? 'Hedef' } : null;
  nextStepIndex = 0;
  earlyAnnounced = false;
  offRouteHits = 0;
  lastRerouteAt = 0;

  if (!activeRoute?.steps?.length) return;
  unsubscribe = onPosition(handlePosition);
  emit('started', getGuidanceState());

  const first = activeRoute.steps[0];
  if (first?.instruction) {
    void speak(first.instruction);
    nextStepIndex = 1;
  }
}

export function stopGuidance(announce = false) {
  unsubscribe?.();
  unsubscribe = null;
  const hadRoute = Boolean(activeRoute);
  activeRoute = null;
  destination = null;
  nextStepIndex = 0;
  earlyAnnounced = false;
  offRouteHits = 0;
  if (hadRoute) {
    if (announce) void speak('Navigasyon durduruldu.');
    emit('stopped');
  }
}

async function handlePosition(position) {
  if (!activeRoute) return;

  if (destination) {
    const toDestination = haversineDistanceKm(
      position.latitude, position.longitude, destination.lat, destination.lon,
    ) * 1000;
    if (toDestination <= ARRIVAL_RADIUS_METERS) {
      void speak('Hedefinize ulaştınız.');
      emit('arrived', { destination, position });
      stopGuidance(false);
      return;
    }
  }

  const routeDistance = distanceFromRoute(position, activeRoute.coordinates);
  if (routeDistance > OFF_ROUTE_RADIUS_METERS) {
    offRouteHits += 1;
  } else {
    offRouteHits = 0;
  }

  if (offRouteHits >= 2 && destination && Date.now() - lastRerouteAt >= REROUTE_COOLDOWN_MS) {
    await reroute(position);
    return;
  }

  const step = activeRoute.steps?.[nextStepIndex];
  if (!step?.location) {
    emit('progress', { position, routeDistanceMeters: routeDistance });
    return;
  }

  const distanceMeters = haversineDistanceKm(
    position.latitude, position.longitude, step.location[0], step.location[1],
  ) * 1000;

  emit('progress', {
    position,
    routeDistanceMeters: routeDistance,
    distanceToStepMeters: distanceMeters,
    step,
    stepIndex: nextStepIndex,
  });

  if (distanceMeters <= NEAR_ANNOUNCE_RADIUS_METERS) {
    void speak(step.instruction);
    nextStepIndex += 1;
    earlyAnnounced = false;
    emit('step', { step, stepIndex: nextStepIndex });
    return;
  }

  if (!earlyAnnounced && distanceMeters <= EARLY_ANNOUNCE_RADIUS_METERS) {
    void speak(`${Math.max(20, Math.round(distanceMeters / 10) * 10)} metre sonra ${lowercaseFirst(step.instruction)}`);
    earlyAnnounced = true;
  }
}

async function reroute(position) {
  if (!destination || !activeRoute) return;
  lastRerouteAt = Date.now();
  offRouteHits = 0;
  emit('rerouting', { position, destination });
  void speak('Rotadan çıktınız. Yeni rota hesaplanıyor.');

  try {
    const routes = await getDrivingRoute(
      { lat: position.latitude, lon: position.longitude },
      { lat: destination.lat, lon: destination.lon },
    );
    if (!routes?.length) throw new Error('Yeni rota bulunamadı.');

    const selected = routes.reduce((best, candidate) => (
      candidate.distanceKm < best.distanceKm ? candidate : best
    ), routes[0]);

    activeRoute = selected;
    nextStepIndex = 0;
    earlyAnnounced = false;
    emit('rerouted', { route: selected, destination });

    const first = selected.steps?.[0];
    if (first?.instruction) {
      void speak(`Yeni rota hazır. ${first.instruction}`);
      nextStepIndex = 1;
    }
  } catch (error) {
    logWarn('turn-by-turn', 'Otomatik yeniden rota başarısız', error);
    emit('reroute-error', { error });
  }
}

function distanceFromRoute(position, coordinates = []) {
  let minKm = Infinity;
  for (const [lat, lon] of coordinates) {
    const km = haversineDistanceKm(position.latitude, position.longitude, lat, lon);
    if (km < minKm) minKm = km;
  }
  return Number.isFinite(minKm) ? minKm * 1000 : Infinity;
}

function lowercaseFirst(text) {
  if (!text) return '';
  return text.charAt(0).toLowerCase() + text.slice(1);
}
