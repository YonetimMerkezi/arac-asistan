/**
 * Smart Drive AI - Navigasyon merkezi ayarları
 * Ücretsiz / offline-first mimari.
 */
const KEY = 'sda_navigation_config_v1';

const DEFAULTS = {
  routeProvider: 'native',
  localRouterUrl: 'http://127.0.0.1:5000',
  voiceEnabled: true,
  autoReRoute: true,
  reRouteDistanceMeters: 70,
  destinationArrivalMeters: 25,
  mapTheme: 'auto',
  mapMode: '3d',
  unit: 'metric',
  fuelAssist: true,
  showObdHud: true,
};

let config = load();

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(config));
}

export function getNavigationConfig() {
  return { ...config };
}

export function updateNavigationConfig(patch = {}) {
  config = { ...config, ...patch };
  save();
  window.dispatchEvent(new CustomEvent('sda:navigation-config', { detail: { ...config } }));
  return { ...config };
}

export function resetNavigationConfig() {
  config = { ...DEFAULTS };
  save();
  return { ...config };
}
