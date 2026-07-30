/**
 * poi-search.js
 * ---------------------------------------------------------------------------
 * Yakındaki otopark, akaryakıt istasyonu, servis ve hastane aramaları.
 *
 * overpass-client.js'in paylaşılan sorgu altyapısını kullanır; her POI
 * kategorisi yalnızca kendi OSM etiket eşleşmesini tanımlar (Open/Closed
 * prensibi - yeni bir kategori eklemek CATEGORY_TAGS'e bir satır eklemektir).
 * ---------------------------------------------------------------------------
 */

import { queryNearbyTaggedNodes } from './overpass-client.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { listCachedPoisByCategory } from './offline-region-store.js';

/** @typedef {'parking'|'fuel'|'service'|'hospital'} PoiCategory */

/** @type {Record<PoiCategory, [string, string]>} Kategori -> [Overpass etiket anahtarı, değeri]. */
const CATEGORY_TAGS = {
  parking: ['amenity', 'parking'],
  fuel: ['amenity', 'fuel'],
  service: ['shop', 'car_repair'],
  hospital: ['amenity', 'hospital'],
};

/**
 * @typedef {Object} PoiResult
 * @property {number|string|null} id - OSM node id (varsa) - bir istasyonu
 *   tekil olarak tanımlamak için kullanılır (ör. kullanıcının elle marka
 *   ataması, bkz. maps/station-brand-store.js).
 * @property {string} name
 * @property {string|null} brand - OSM "brand" etiketi (varsa) - akaryakıt
 *   istasyonlarını fiyat listesindeki markayla eşleştirmek için "name"den
 *   daha güvenilirdir (ör. name="Opet Elazığ Yolu", brand="Opet").
 * @property {number} lat
 * @property {number} lon
 * @property {number} distanceKm
 * @property {boolean} [isOffline] - true ise bu sonuç CANLI ağ sorgusundan
 *   değil, daha önce "Bölge İndir" ile indirilmiş yerel önbellekten geldi
 *   (bkz. offline-region-store.js) - arayan taraf bunu kullanıcıya belirtebilir.
 */

/**
 * Verilen kategoride, konuma en yakın POI'leri döndürür (yakınlığa göre sıralı).
 *
 * Canlı ağ sorgusu boş dönerse (tipik nedeni: internet yok) SESSİZCE
 * offline-region-store.js'teki yerel önbelleğe düşülür - kullanıcı önceden
 * o bölgeyi "Bölge İndir" ile indirmişse sonuçlar yine de gösterilir (yalnızca
 * `isOffline: true` işaretlenir, arayan bunu görsel olarak belirtebilir).
 * @param {PoiCategory} category
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusMeters=5000]
 * @returns {Promise<PoiResult[]>}
 */
export async function findNearbyPoi(category, lat, lon, radiusMeters = 5000) {
  const tagPair = CATEGORY_TAGS[category];
  if (!tagPair) return [];
  const [tagKey, tagValue] = tagPair;

  const elements = await queryNearbyTaggedNodes(lat, lon, radiusMeters, tagKey, tagValue);

  const liveResults = elements
    .filter((el) => typeof el.lat === 'number' && typeof el.lon === 'number')
    .map((el) => ({
      id: el.id ?? null,
      name: el.name ?? defaultNameFor(category),
      brand: el.brand ?? null,
      lat: el.lat,
      lon: el.lon,
      distanceKm: haversineDistanceKm(lat, lon, el.lat, el.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (liveResults.length > 0) return liveResults;

  return findCachedNearbyPoi(category, lat, lon, radiusMeters);
}

/**
 * Canlı sorgu boş döndüğünde çağrılan çevrimdışı yedek - önceden indirilmiş
 * bölgelerin POI önbelleğinde, verilen yarıçap içindeki noktaları arar.
 * @param {PoiCategory} category
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<PoiResult[]>}
 */
async function findCachedNearbyPoi(category, lat, lon, radiusMeters) {
  const cached = await listCachedPoisByCategory(category);
  const radiusKm = radiusMeters / 1000;

  return cached
    .map((poi) => ({
      id: poi.id,
      name: poi.name ?? defaultNameFor(category),
      brand: poi.brand ?? null,
      lat: poi.lat,
      lon: poi.lon,
      distanceKm: haversineDistanceKm(lat, lon, poi.lat, poi.lon),
      isOffline: true,
    }))
    .filter((poi) => poi.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * @param {PoiCategory} category
 * @returns {string}
 */
function defaultNameFor(category) {
  const names = {
    parking: 'Otopark',
    fuel: 'Akaryakıt İstasyonu',
    service: 'Oto Servis',
    hospital: 'Hastane',
  };
  return names[category] ?? 'Bilinmeyen Konum';
}
