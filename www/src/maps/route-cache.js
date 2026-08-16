/**
 * route-cache.js
 * ---------------------------------------------------------------------------
 * Navigasyonun offline-first rota önbelleği.
 *
 * Amaç: Daha önce hesaplanmış rotayı internet yokken tekrar açabilmek.
 * Bu modül YENİ bir offline yol ağı üretmez; yalnızca gerçek OSRM rotalarını
 * cihazda saklar. Böylece mevcut uygulamanın davranışı bozulmadan güvenli
 * offline fallback sağlanır.
 * ---------------------------------------------------------------------------
 */
import { Preferences } from '@capacitor/preferences';

const KEY = 'sda_navigation_route_cache_v1';
const MAX_ROUTES = 12;

async function readAll() {
  try {
    const { value } = await Preferences.get({ key: KEY });
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(routes) {
  await Preferences.set({ key: KEY, value: JSON.stringify(routes.slice(0, MAX_ROUTES)) });
}

function keyFor(destination) {
  return `${Number(destination.lat).toFixed(5)},${Number(destination.lon).toFixed(5)}`;
}

export async function saveRouteCache(destination, route) {
  if (!destination || !route?.coordinates?.length) return;
  const all = await readAll();
  const key = keyFor(destination);
  const filtered = all.filter(item => item.key !== key);
  filtered.unshift({
    key,
    destination: { lat: destination.lat, lon: destination.lon, label: destination.label ?? '' },
    route,
    savedAt: Date.now(),
  });
  await writeAll(filtered);
}

export async function getCachedRoute(destination, maxAgeMs = 1000 * 60 * 60 * 24 * 30) {
  if (!destination) return null;
  const all = await readAll();
  const found = all.find(item => item.key === keyFor(destination));
  if (!found) return null;
  if (Date.now() - found.savedAt > maxAgeMs) return null;
  return found.route ?? null;
}

export async function clearRouteCache() {
  await Preferences.remove({ key: KEY });
}
