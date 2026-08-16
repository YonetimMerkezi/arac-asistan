/**
 * navigation-store.js
 * Smart Drive AI - Navigasyon V1
 * Tamamen cihaz üzerinde çalışır. Harici hesap/faturalandırma servisi yoktur.
 */

const STORAGE_KEY = 'sda_navigation_v1';

const DEFAULT_STATE = {
  favorites: [],
  recentDestinations: [],
  lastDestination: null,
  mapTheme: 'auto',
  mapMode: '2d',
  voiceEnabled: true,
};

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

let state = readState();
const listeners = new Set();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((fn) => {
    try { fn(state); } catch {}
  });
}

export function getNavigationState() {
  return structuredClone ? structuredClone(state) : JSON.parse(JSON.stringify(state));
}

export function onNavigationStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setNavigationSetting(key, value) {
  if (!(key in DEFAULT_STATE)) return;
  state = { ...state, [key]: value };
  persist();
}

export function addFavorite(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
  const item = {
    id: crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: String(place.name || 'Kayıtlı konum'),
    lat: Number(place.lat),
    lon: Number(place.lon),
    createdAt: new Date().toISOString(),
  };
  state = {
    ...state,
    favorites: [item, ...state.favorites.filter((x) =>
      Math.abs(x.lat - item.lat) > 0.00005 || Math.abs(x.lon - item.lon) > 0.00005
    )].slice(0, 20),
  };
  persist();
  return item;
}

export function removeFavorite(id) {
  state = { ...state, favorites: state.favorites.filter((x) => x.id !== id) };
  persist();
}

export function addRecentDestination(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
  const item = {
    name: String(place.name || 'Hedef'),
    lat: Number(place.lat),
    lon: Number(place.lon),
    usedAt: new Date().toISOString(),
  };
  state = {
    ...state,
    lastDestination: item,
    recentDestinations: [
      item,
      ...state.recentDestinations.filter((x) =>
        Math.abs(x.lat - item.lat) > 0.00005 || Math.abs(x.lon - item.lon) > 0.00005
      ),
    ].slice(0, 10),
  };
  persist();
}

export function clearRecentDestinations() {
  state = { ...state, recentDestinations: [] };
  persist();
}
