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
 * @property {string} name
 * @property {string|null} brand - OSM "brand" etiketi (varsa) - akaryakıt
 *   istasyonlarını fiyat listesindeki markayla eşleştirmek için "name"den
 *   daha güvenilirdir (ör. name="Opet Elazığ Yolu", brand="Opet").
 * @property {number} lat
 * @property {number} lon
 * @property {number} distanceKm
 */

/**
 * Verilen kategoride, konuma en yakın POI'leri döndürür (yakınlığa göre sıralı).
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

  return elements
    .filter((el) => typeof el.lat === 'number' && typeof el.lon === 'number')
    .map((el) => ({
      name: el.name ?? defaultNameFor(category),
      brand: el.brand ?? null,
      lat: el.lat,
      lon: el.lon,
      distanceKm: haversineDistanceKm(lat, lon, el.lat, el.lon),
    }))
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
