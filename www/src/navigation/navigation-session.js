/**
 * navigation-session.js
 * Turn-by-turn oturum yönetimi.
 *
 * GPS konumu ile rota üzerindeki sonraki adımı takip eder.
 * Basit ve güvenli eşikler:
 * - 45 m: yaklaşan talimat
 * - 18 m: dönüş talimatı
 * - 65 m sapma: rota dışı kabul edilir
 */

import { speak } from './navigation-voice.js';

const EARTH_RADIUS = 6371000;
const OFF_ROUTE_METERS = 65;
const APPROACH_METERS = 45;
const TURN_METERS = 18;

let session = null;
const listeners = new Set();

function emit(event, payload = {}) {
  listeners.forEach((fn) => {
    try { fn(event, payload); } catch {}
  });
}

export function onNavigationSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startNavigationSession(route, destination) {
  stopNavigationSession();

  session = {
    route,
    destination,
    stepIndex: 0,
    startedAt: Date.now(),
    lastLocation: null,
    completed: false,
  };

  emit('started', { route, destination });
  announceCurrentStep(true);
}

export function stopNavigationSession() {
  if (!session) return;
  emit('stopped', { session });
  session = null;
}

export function getNavigationSession() {
  return session;
}

export function updateNavigationPosition(location) {
  if (!session || session.completed || !location) return;

  session.lastLocation = location;

  const step = session.route.steps?.[session.stepIndex];
  if (!step?.location) {
    emit('progress', { location, step: null });
    return;
  }

  const stepPoint = { lat: step.location[0], lon: step.location[1] };
  const distance = haversine(location, stepPoint);

  const remaining = distanceToDestination(location, session.destination);
  emit('progress', {
    location,
    step,
    stepIndex: session.stepIndex,
    distanceToStep: distance,
    remainingMeters: remaining,
  });

  if (remaining < 25) {
    session.completed = true;
    speak('Hedefinize ulaştınız.', { minInterval: 10000 });
    emit('arrived', { location, destination: session.destination });
    return;
  }

  if (distance > OFF_ROUTE_METERS) {
    emit('off-route', { location, step, distance });
    return;
  }

  if (distance <= TURN_METERS) {
    announceCurrentStep();
    if (session.stepIndex < session.route.steps.length - 1) {
      session.stepIndex += 1;
      announceCurrentStep(true);
    }
  } else if (distance <= APPROACH_METERS) {
    announceCurrentStep(true);
  }
}

function announceCurrentStep(force = false) {
  const step = session?.route?.steps?.[session.stepIndex];
  if (!step?.instruction) return;

  const prefix = step.distance > 0
    ? `${Math.round(step.distance)} metre sonra `
    : '';

  speak(prefix + step.instruction, {
    minInterval: force ? 2500 : 4500,
  });
}

function distanceToDestination(location, destination) {
  if (!destination) return Infinity;
  return haversine(location, destination);
}

function haversine(a, b) {
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
