/**
 * overpass-client.js
 * OpenStreetMap Overpass sorguları + POI worker yedeği.
 */
import { logWarn } from '../core/logger.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
];

const REQUEST_TIMEOUT_MS = 12000;
const POI_WORKER_ENDPOINT = 'https://istasyon.sedonet23.workers.dev/';

/**
 * Yakındaki etiketli OSM öğelerini getirir.
 * Yakıt sorgusunda Worker ile doğrudan Overpass paralel kullanılır; sonuçlar
 * birleştirilir. Böylece Worker önbelleği eski kalsa bile yeni istasyonlar
 * doğrudan OSM'den gelebilir. Overpass sorgusu node/way/relation kapsar.
 */
export async function queryNearbyTaggedNodes(lat, lon, radiusMeters, tagKey, tagValue) {
  const isFuel = tagKey === 'amenity' && tagValue === 'fuel';

  const workerPromise = queryPoiWorker(lat, lon, radiusMeters, tagKey, tagValue);
  const directPromise = isFuel
    ? queryDirectNearby(lat, lon, radiusMeters, tagKey, tagValue)
    : Promise.resolve([]);

  const [workerResults, directResults] = await Promise.all([workerPromise, directPromise]);
  const merged = mergeElements(workerResults, directResults);
  if (merged.length > 0) return merged;

  // Yakıt dışı kategorilerde Worker sonuç vermezse doğrudan Overpass'a düş.
  if (!isFuel) return queryDirectNearby(lat, lon, radiusMeters, tagKey, tagValue);
  return [];
}

async function queryPoiWorker(lat, lon, radiusMeters, tagKey, tagValue) {
  try {
    const cacheBust = Date.now();
    const url = `${POI_WORKER_ENDPOINT}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=${encodeURIComponent(radiusMeters)}&tag=${encodeURIComponent(`${tagKey}=${tagValue}`)}&fresh=1&_=${cacheBust}`;
    const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) {
      logWarn('overpass-client', `POI worker HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    if (!data?.success) return [];
    return (data.elements ?? []).map(normalizeElement).filter(Boolean);
  } catch (error) {
    logWarn('overpass-client', 'POI worker erişilemedi', error);
    return [];
  }
}

async function queryDirectNearby(lat, lon, radiusMeters, tagKey, tagValue) {
  const query = buildRadiusNodeQuery(lat, lon, radiusMeters, `"${tagKey}"="${tagValue}"`);
  const elements = await runOverpassQuery(query);
  return elements.map(normalizeElement).filter(Boolean);
}

function normalizeElement(el) {
  const lat = typeof el?.lat === 'number' ? el.lat : el?.center?.lat;
  const lon = typeof el?.lon === 'number' ? el.lon : el?.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return {
    id: el.id ?? null,
    type: el.type ?? 'node',
    lat,
    lon,
    name: el.name ?? el.tags?.name ?? null,
    brand: el.brand ?? el.tags?.brand ?? el.tags?.operator ?? null,
  };
}

function mergeElements(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const el of group ?? []) {
      const key = el.id != null
        ? `${el.type ?? 'node'}:${el.id}`
        : `${Number(el.lat).toFixed(5)}:${Number(el.lon).toFixed(5)}`;
      if (!map.has(key)) map.set(key, el);
    }
  }
  return [...map.values()];
}

export async function runOverpassQuery(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });
      if (!response.ok) {
        logWarn('overpass-client', `${endpoint} başarısız: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      return data.elements ?? [];
    } catch (error) {
      logWarn('overpass-client', `${endpoint} sorgusu başarısız`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  logWarn('overpass-client', 'Tüm Overpass aynaları başarısız oldu');
  return [];
}

/**
 * İsim geriye dönük uyumluluk için korunur; artık yalnızca node değil,
 * node + way + relation arar. Way/relation koordinatı `center` ile gelir.
 */
export function buildRadiusNodeQuery(lat, lon, radiusMeters, tagFilter) {
  return `[out:json][timeout:12];nwr[${tagFilter}](around:${radiusMeters},${lat},${lon});out center tags;`;
}

export function buildBboxNodeQuery(bbox, tagFilter) {
  return `[out:json][timeout:25];nwr[${tagFilter}](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out center tags;`;
}

export function buildNearestRoadQuery(lat, lon, radiusMeters) {
  return `[out:json][timeout:8];way[highway][maxspeed](around:${radiusMeters},${lat},${lon});out tags 5;`;
}
