/**
 * offline-region-store.js
 * ---------------------------------------------------------------------------
 * "Bölge indir" özelliğinin IndexedDB depolama katmanı.
 *
 * Üç mağaza (object store) tutulur:
 *  - regions: indirilen her bölgenin meta verisi (ad, sınırlar, tarih, karo/POI sayısı).
 *  - tiles: harita karo görüntüleri (PNG blob), anahtar "z/x/y" - TÜM bölgeler
 *    arasında PAYLAŞILIR (aynı karo iki bölgede de olsa tekrar indirilmez/saklanmaz).
 *  - pois: yakıt/hastane/otopark/servis noktaları, anahtar "kategori:osmId"
 *    (aynı nokta birden fazla bölgede görülürse regionIds listesine eklenir,
 *    tekilliği bozulmaz).
 *
 * DÜRÜSTLÜK NOTU: Bir bölge silindiğinde yalnızca o bölgenin kaydı ve
 * yalnızca-o-bölgeye-ait POI'ler silinir; paylaşılan karo (tile) önbelleği
 * TEK TEK bölge bazında temizlenmez (hangi karonun hangi bölgeye ait olduğunu
 * ayrıca indekslemek gerekirdi - karmaşıklığa değmeyecek kadar düşük kazanç,
 * karolar zaten küçük PNG'ler). "Tüm çevrimdışı veriyi temizle" ayrı bir
 * fonksiyonla (clearAllOfflineData) her şeyi siler.
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

const DB_NAME = 'sda-offline-regions';
const DB_VERSION = 1;
const STORE_REGIONS = 'regions';
const STORE_TILES = 'tiles';
const STORE_POIS = 'pois';

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * @typedef {Object} OfflineRegion
 * @property {string} id
 * @property {string} name
 * @property {{south:number, west:number, north:number, east:number}} bbox
 * @property {number} minZoom
 * @property {number} maxZoom
 * @property {number} downloadedAt - Unix ms.
 * @property {number} tileCount
 * @property {number} poiCount
 */

/**
 * @typedef {Object} OfflinePoi
 * @property {string} uid - "kategori:osmId" (osmId yoksa "kategori:lat,lon").
 * @property {string} category
 * @property {number|string|null} id
 * @property {string} name
 * @property {string|null} brand
 * @property {number} lat
 * @property {number} lon
 * @property {string[]} regionIds
 */

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB bu ortamda yok'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_REGIONS)) {
        db.createObjectStore(STORE_REGIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TILES)) {
        db.createObjectStore(STORE_TILES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_POIS)) {
        const poiStore = db.createObjectStore(STORE_POIS, { keyPath: 'uid' });
        poiStore.createIndex('byCategory', 'category');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @returns {Promise<IDBObjectStore>}
 */
async function store(storeName, mode) {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/**
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Bir harita karosunu (PNG blob) yerel depoya yazar. Zaten varsa üzerine yazar
 * (aynı karo iki farklı bölge indirmesinde de gelebilir - sorun değil).
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {Blob} blob
 */
export async function saveTileBlob(z, x, y, blob) {
  try {
    const s = await store(STORE_TILES, 'readwrite');
    await promisify(s.put({ key: `${z}/${x}/${y}`, blob }));
  } catch (error) {
    logWarn('offline-region-store', 'Karo kaydedilemedi', error);
  }
}

/**
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<Blob|null>}
 */
export async function getTileBlob(z, x, y) {
  try {
    const s = await store(STORE_TILES, 'readonly');
    const record = await promisify(s.get(`${z}/${x}/${y}`));
    return record?.blob ?? null;
  } catch {
    return null; // IndexedDB yoksa/başarısızsa sessizce "önbellekte yok" say - çağıran ağa düşer.
  }
}

/**
 * @param {OfflineRegion} region
 */
export async function saveRegion(region) {
  const s = await store(STORE_REGIONS, 'readwrite');
  await promisify(s.put(region));
}

/**
 * @returns {Promise<OfflineRegion[]>}
 */
export async function listRegions() {
  try {
    const s = await store(STORE_REGIONS, 'readonly');
    const all = await promisify(s.getAll());
    return (all ?? []).sort((a, b) => b.downloadedAt - a.downloadedAt);
  } catch {
    return [];
  }
}

/**
 * Bir kategorideki POI'leri, verilen bölge kimliğiyle ilişkilendirerek kaydeder.
 * Aynı nokta (aynı uid) başka bir bölgeden zaten kayıtlıysa, bu bölgenin
 * kimliği regionIds'e EKLENİR (üzerine yazılmaz) - böylece iki bölge
 * çakışsa bile bir bölge silinince nokta diğer bölge için kaybolmaz.
 * @param {string} regionId
 * @param {string} category
 * @param {import('./poi-search.js').PoiResult[]} pois
 */
export async function savePois(regionId, category, pois) {
  const s = await store(STORE_POIS, 'readwrite');
  for (const poi of pois) {
    const uid = `${category}:${poi.id ?? `${poi.lat.toFixed(5)},${poi.lon.toFixed(5)}`}`;
    const existing = await promisify(s.get(uid));
    const regionIds = existing ? Array.from(new Set([...existing.regionIds, regionId])) : [regionId];
    await promisify(s.put({
      uid, category, id: poi.id ?? null, name: poi.name, brand: poi.brand ?? null,
      lat: poi.lat, lon: poi.lon, regionIds,
    }));
  }
}

/**
 * Verilen kategoride, TÜM indirilmiş bölgelerdeki noktaları döndürür
 * (mesafeye göre filtreleme/sıralama çağıran tarafta yapılır - bkz.
 * poi-search.js'teki findNearbyPoi çevrimdışı yedeği).
 * @param {string} category
 * @returns {Promise<OfflinePoi[]>}
 */
export async function listCachedPoisByCategory(category) {
  try {
    const s = await store(STORE_POIS, 'readonly');
    const index = s.index('byCategory');
    return await promisify(index.getAll(IDBKeyRange.only(category)));
  } catch {
    return [];
  }
}

/**
 * Bir bölgeyi ve YALNIZCA o bölgeye ait POI'leri siler (paylaşılan karo
 * önbelleği dosya başı notunda açıklandığı gibi dokunulmadan kalır).
 * @param {string} regionId
 */
export async function deleteRegion(regionId) {
  const regionStore = await store(STORE_REGIONS, 'readwrite');
  await promisify(regionStore.delete(regionId));

  const poiStore = await store(STORE_POIS, 'readwrite');
  const all = await promisify(poiStore.getAll());
  for (const poi of (all ?? [])) {
    if (!poi.regionIds.includes(regionId)) continue;
    const remaining = poi.regionIds.filter((id) => id !== regionId);
    if (remaining.length === 0) {
      await promisify(poiStore.delete(poi.uid));
    } else {
      await promisify(poiStore.put({ ...poi, regionIds: remaining }));
    }
  }
}

/**
 * Tüm çevrimdışı veriyi (bölgeler, karolar, POI'ler) siler - "Depolamayı
 * Temizle" ayarı için.
 */
export async function clearAllOfflineData() {
  for (const name of [STORE_REGIONS, STORE_TILES, STORE_POIS]) {
    const s = await store(name, 'readwrite');
    await promisify(s.clear());
  }
}
