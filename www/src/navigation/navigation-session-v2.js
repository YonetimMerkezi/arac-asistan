/**
 * Smart Drive AI - gelişmiş navigasyon oturumu.
 * Rota dışı -> otomatik yeniden rota
 * Varış -> oturumu sonlandır
 */
import { onLocationChange } from './navigation-location.js';
import { getNavigationConfig } from './navigation-config.js';
import { reroute } from './navigation-route-manager.js';
import { speak } from './navigation-voice.js';

let state = null;
let unsubscribe = null;
const listeners = new Set();

const R = 6371000;

function haversine(a, b) {
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat-a.lat) * Math.PI / 180;
  const dl = (b.lon-a.lon) * Math.PI / 180;
  const x = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function emit(type, detail={}) {
  listeners.forEach(fn => { try { fn(type, detail); } catch {} });
  window.dispatchEvent(new CustomEvent(`sda:navigation:${type}`, { detail }));
}

export function onNavigation(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getNavigationState() {
  return state ? { ...state } : null;
}

export function startNavigation(route, destination) {
  stopNavigation();
  state = {
    active: true,
    route,
    destination,
    stepIndex: 0,
    startedAt: Date.now(),
    lastLocation: null,
    rerouting: false,
  };

  unsubscribe = onLocationChange(onLocation);
  emit('started', state);

  const first = route.steps?.[0];
  if (first?.instruction) speak(first.instruction, { minInterval: 1500 });
}

async function onLocation(location) {
  if (!state?.active || !location) return;

  state.lastLocation = location;

  const cfg = getNavigationConfig();
  const remaining = haversine(location, state.destination);

  emit('progress', { location, remainingMeters: remaining, step: state.route.steps?.[state.stepIndex] });

  if (remaining <= cfg.destinationArrivalMeters) {
    speak('Hedefinize ulaştınız.', { minInterval: 10000 });
    emit('arrived', { location, destination: state.destination });
    stopNavigation(false);
    return;
  }

  const step = state.route.steps?.[state.stepIndex];
  if (!step?.location) return;

  const stepLocation = { lat: step.location[0], lon: step.location[1] };
  const stepDistance = haversine(location, stepLocation);

  if (stepDistance <= 20) {
    state.stepIndex = Math.min(state.stepIndex + 1, state.route.steps.length - 1);
    const next = state.route.steps[state.stepIndex];
    if (next?.instruction) speak(next.instruction, { minInterval: 2500 });
    emit('step', { step: next, index: state.stepIndex });
  }

  if (
    cfg.autoReRoute &&
    !state.rerouting &&
    stepDistance > cfg.reRouteDistanceMeters
  ) {
    state.rerouting = true;
    emit('off-route', { location, distance: stepDistance });

    try {
      const newRoute = await reroute(location, state.destination);
      state.route = newRoute;
      state.stepIndex = 0;
      emit('route-updated', { route: newRoute });
      const first = newRoute.steps?.[0];
      if (first?.instruction) speak(`Rota yenilendi. ${first.instruction}`, { minInterval: 3000 });
    } catch (error) {
      emit('reroute-error', { error });
    } finally {
      state.rerouting = false;
    }
  }
}

export function stopNavigation(clear = true) {
  unsubscribe?.();
  unsubscribe = null;
  if (state) emit('stopped', { state });
  if (clear) state = null;
}
