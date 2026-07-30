/**
 * geo-utils.js
 * ---------------------------------------------------------------------------
 * Saf coğrafi hesaplama fonksiyonları. Bağlantı/kayıt mantığı İÇERMEZ -
 * yalnızca matematik. trip-recorder.js ve ileride navigasyon modülü (Faz 5)
 * bu dosyayı ortak kullanacak (kod tekrarını önleme).
 * ---------------------------------------------------------------------------
 */

/** @type {number} Dünya yarıçapı (km), haversine formülü için. */
const EARTH_RADIUS_KM = 6371;

/**
 * İki GPS koordinatı arasındaki büyük daire (great-circle) mesafesini
 * haversine formülüyle hesaplar.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Kilometre cinsinden mesafe.
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * @param {number} degrees
 * @returns {number} Radyan.
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
