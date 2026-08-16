/**
 * Smart Drive AI - Rota yöneticisi
 * Gerçek yol geometrisi + adım listesi + otomatik yeniden rota.
 */
import { calculateRoute } from './navigation-route.js';
import { getNavigationConfig } from './navigation-config.js';

let current = null;
const listeners = new Set();

function emit(type, detail = {}) {
  listeners.forEach(fn => { try { fn(type, detail); } catch {} });
  window.dispatchEvent(new CustomEvent(`sda:route:${type}`, { detail }));
}

export function onRouteManager(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCurrentRoute() {
  return current;
}

export async function buildRoute(start, destination) {
  emit('calculating', { start, destination });

  const cfg = getNavigationConfig();
  const route = await calculateRoute(start, destination, {
    provider: cfg.routeProvider,
    localOsrmUrl: cfg.localRouterUrl,
    alternatives: true,
  });

  current = {
    ...route,
    start,
    destination,
    calculatedAt: Date.now(),
  };

  emit('ready', { route: current });
  return current;
}

export async function reroute(location, destination) {
  emit('rerouting', { location, destination });
  try {
    const route = await buildRoute(location, destination);
    emit('rerouted', { route });
    return route;
  } catch (error) {
    emit('reroute-error', { error });
    throw error;
  }
}

export function clearRoute() {
  current = null;
  emit('cleared');
}
