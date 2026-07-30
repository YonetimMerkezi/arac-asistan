/**
 * offline-region-download.js
 * ---------------------------------------------------------------------------
 * "Bölge İndir" özelliğinin indirme akışı: haritada görünen alanı, bir dizi
 * zoom seviyesinde karo görüntüsü OLARAK ve o alandaki yakıt/hastane/otopark/
 * servis noktalarını POI OLARAK, TEK bir "çevrimdışı paket" halinde
 * offline-region-store.js'e kaydeder.
 *
 * DÜRÜSTLÜK NOTU: Bölge indirildikten SONRA OSM'e eklenen ya da kapanan bir
 * nokta, bölge yeniden indirilene kadar YANSIMAZ - bu bilinçli bir sınırlama,
 * kullanıcıya (fuel-region-view.js panelinde) açıkça belirtilir, sessizce
 * "güncel" gibi gösterilmez.
 * ---------------------------------------------------------------------------
 */

import { lonLatToTile, osmTileUrl } from './offline-tile-layer.js';
import { runOverpassQuery, buildBboxNodeQuery } from './overpass-client.js';
import { saveTileBlob, saveRegion, savePois } from './offline-region-store.js';
import { logInfo, logWarn } from '../core/logger.js';

/** @type {Record<string, [string, string]>} poi-search.js'teki CATEGORY_TAGS ile AYNI eşleme (tekrar burada, o dosyaya çevrimdışı-özel bir bağımlılık eklememek için). */
const CATEGORY_TAGS = {
  fuel: ['amenity', 'fuel'],
  hospital: ['amenity', 'hospital'],
  parking: ['amenity', 'parking'],
  service: ['shop', 'car_repair'],
};

/** @type {number} Tek indirmede izin verilen en fazla karo sayısı - sınırsız büyük bölge/zoom aralığı telefonun depolamasını ve veri kotasını patlatabilir. */
const MAX_TILE_COUNT = 2500;

/** @type {number} Aynı anda kaç karo indirileceği - OSM'in halka açık sunucusuna nazik davranmak için sınırlı tutulur. */
const DOWNLOAD_CONCURRENCY = 6;

/**
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {number} minZoom
 * @param {number} maxZoom
 * @returns {Array<{z:number, x:number, y:number}>}
 */
function computeTileList(bbox, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const nw = lonLatToTile(bbox.north, bbox.west, z);
    const se = lonLatToTile(bbox.south, bbox.east, z);
    for (let x = nw.x; x <= se.x; x += 1) {
      for (let y = nw.y; y <= se.y; y += 1) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} worker
 */
async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * @typedef {Object} DownloadProgress
 * @property {'tiles'|'pois'|'done'} phase
 * @property {number} completed
 * @property {number} total
 */

/**
 * Verilen sınırlar için bir bölgeyi indirir ve kaydeder.
 * @param {Object} params
 * @param {string} params.name - Kullanıcının bölgeye verdiği ad (ör. "Elazığ Merkez").
 * @param {{south:number, west:number, north:number, east:number}} params.bbox
 * @param {number} params.minZoom
 * @param {number} params.maxZoom
 * @param {(progress: DownloadProgress) => void} [params.onProgress]
 * @returns {Promise<{ok: boolean, error?: string, region?: import('./offline-region-store.js').OfflineRegion}>}
 */
export async function downloadRegion({ name, bbox, minZoom, maxZoom, onProgress }) {
  const tiles = computeTileList(bbox, minZoom, maxZoom);
  if (tiles.length === 0) {
    return { ok: false, error: 'Bu alan için indirilecek karo bulunamadı.' };
  }
  if (tiles.length > MAX_TILE_COUNT) {
    return { ok: false, error: `Seçili alan çok büyük (${tiles.length} karo). Haritayı yakınlaştırıp tekrar dene.` };
  }

  let tilesDone = 0;
  let tileFailures = 0;
  await runWithConcurrency(tiles, DOWNLOAD_CONCURRENCY, async ({ z, x, y }) => {
    try {
      const response = await fetch(osmTileUrl(z, x, y));
      if (response.ok) {
        const blob = await response.blob();
        await saveTileBlob(z, x, y, blob);
      } else {
        tileFailures += 1;
      }
    } catch (error) {
      tileFailures += 1;
      logWarn('offline-region-download', `Karo indirilemedi (${z}/${x}/${y})`, error);
    } finally {
      tilesDone += 1;
      onProgress?.({ phase: 'tiles', completed: tilesDone, total: tiles.length });
    }
  });

  if (tileFailures === tiles.length) {
    return { ok: false, error: 'Hiçbir harita karosu indirilemedi (internet bağlantısını kontrol et).' };
  }

  const categories = Object.keys(CATEGORY_TAGS);
  const regionId = `region-${Date.now()}`;
  let poiTotal = 0;
  let categoriesDone = 0;
  for (const category of categories) {
    const [tagKey, tagValue] = CATEGORY_TAGS[category];
    const elements = await runOverpassQuery(buildBboxNodeQuery(bbox, `"${tagKey}"="${tagValue}"`));
    const pois = elements
      .filter((el) => typeof el.lat === 'number' && typeof el.lon === 'number')
      .map((el) => ({
        id: el.id ?? null,
        name: el.tags?.name ?? null,
        brand: el.tags?.brand ?? null,
        lat: el.lat,
        lon: el.lon,
      }));
    await savePois(regionId, category, pois);
    poiTotal += pois.length;
    categoriesDone += 1;
    onProgress?.({ phase: 'pois', completed: categoriesDone, total: categories.length });
  }

  /** @type {import('./offline-region-store.js').OfflineRegion} */
  const region = {
    id: regionId,
    name: name?.trim() || 'İsimsiz Bölge',
    bbox,
    minZoom,
    maxZoom,
    downloadedAt: Date.now(),
    tileCount: tiles.length - tileFailures,
    poiCount: poiTotal,
  };
  await saveRegion(region);
  logInfo('offline-region-download', `Bölge indirildi: ${region.name} (${region.tileCount} karo, ${poiTotal} POI)`);

  onProgress?.({ phase: 'done', completed: 1, total: 1 });
  return { ok: true, region };
}
