/**
 * turn-by-turn.js
 * ---------------------------------------------------------------------------
 * GPS tabanlı Türkçe dönüş rehberliği + kontrollü otomatik yeniden rota.
 * Mevcut TTS altyapısı kullanılır; ayrı bir Android TTS köprüsü gerekmez.
 * ---------------------------------------------------------------------------
 */
import { onPosition } from '../core/gps-tracker.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { speak } from '../voice/tts.js';
import { getDrivingRoute } from './route-service.js';
import { logInfo, logWarn } from '../core/logger.js';

const EARLY_ANNOUNCE_RADIUS_METERS = 200;
const NEAR_ANNOUNCE_RADIUS_METERS = 22;
const OFF_ROUTE_RADIUS_METERS = 80;
const REROUTE_COOLDOWN_MS = 15000;
const OFF_ROUTE_CONFIRMATIONS = 2;

let activeSteps = [];
let nextStepIndex = 0;
let earlyAnnouncedForCurrentStep = false;
let unsubscribe = null;
let destination = null;
let rerouting = false;
let lastRerouteAt = 0;
let offRouteCount = 0;
let onRouteUpdate = null;

export function startGuidance(route, target = null, callbacks = {}) {
  stopGuidance();
  activeSteps = route.steps ?? [];
  nextStepIndex = 0;
  earlyAnnouncedForCurrentStep = false;
  destination = target;
  onRouteUpdate = callbacks.onRouteUpdate ?? null;
  if (!activeSteps.length) return;

  unsubscribe = onPosition(handlePosition);
  logInfo('turn-by-turn', `Sesli rehberlik başladı (${activeSteps.length} adım)`);
  void speak(activeSteps[0].instruction);
  nextStepIndex = Math.min(1, activeSteps.length);
}

export function stopGuidance() {
  unsubscribe?.();
  unsubscribe = null;
  activeSteps = [];
  nextStepIndex = 0;
  earlyAnnouncedForCurrentStep = false;
  destination = null;
  rerouting = false;
  offRouteCount = 0;
  onRouteUpdate = null;
}

function handlePosition(position) {
  if (nextStepIndex >= activeSteps.length) return;
  const step = activeSteps[nextStepIndex];
  if (!step?.location) return;

  const distanceMeters = haversineDistanceKm(
    position.latitude, position.longitude,
    step.location[0], step.location[1],
  ) * 1000;

  if (distanceMeters <= NEAR_ANNOUNCE_RADIUS_METERS) {
    void speak(step.instruction);
    nextStepIndex += 1;
    earlyAnnouncedForCurrentStep = false;
    offRouteCount = 0;
    return;
  }

  if (!earlyAnnouncedForCurrentStep && distanceMeters <= EARLY_ANNOUNCE_RADIUS_METERS) {
    void speak(`Yaklaşık ${Math.round(distanceMeters / 10) * 10} metre sonra ${lowercaseFirst(step.instruction)}`);
    earlyAnnouncedForCurrentStep = true;
  }

  // Bir sonraki manevraya olan mesafe uzun süre aşırı büyüyorsa rota dışına
  // çıkılmış kabul edilir. Tek GPS sıçramasında yeniden rota istemiyoruz.
  if (distanceMeters > OFF_ROUTE_RADIUS_METERS) {
    offRouteCount += 1;
    if (offRouteCount >= OFF_ROUTE_CONFIRMATIONS) {
      void requestReroute(position);
    }
  } else {
    offRouteCount = 0;
  }
}

async function requestReroute(position) {
  if (rerouting || !destination) return;
  if (Date.now() - lastRerouteAt < REROUTE_COOLDOWN_MS) return;

  rerouting = true;
  lastRerouteAt = Date.now();
  offRouteCount = 0;
  void speak('Rotadan çıktınız. Yeni rota hesaplanıyor.');

  try {
    const routes = await getDrivingRoute(
      { lat: position.latitude, lon: position.longitude },
      { lat: destination.lat, lon: destination.lon },
      { destinationLabel: destination.label ?? '', cache: true },
    );

    if (!routes?.length) {
      logWarn('turn-by-turn', 'Otomatik yeniden rota alınamadı');
      void speak('Yeni rota alınamadı. Mevcut yönlendirme korunuyor.');
      return;
    }

    const nextRoute = routes[0];
    activeSteps = nextRoute.steps ?? [];
    nextStepIndex = 0;
    earlyAnnouncedForCurrentStep = false;
    onRouteUpdate?.(nextRoute);
    void speak('Yeni rota hazır.');
  } catch (error) {
    logWarn('turn-by-turn', 'Yeniden rota hatası', error);
    void speak('Yeni rota hesaplanamadı.');
  } finally {
    rerouting = false;
  }
}

function lowercaseFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
}
