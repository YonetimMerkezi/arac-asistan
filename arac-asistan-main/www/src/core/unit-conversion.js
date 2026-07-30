/**
 * unit-conversion.js
 * ---------------------------------------------------------------------------
 * Saf birim dönüşüm fonksiyonları. Durum/depolama İÇERMEZ - yalnızca
 * matematik. units-store.js kullanıcının tercihini tutar, bu dosya
 * dönüşümü yapar (Single Responsibility, kod tekrarını önleme).
 * ---------------------------------------------------------------------------
 */

/** @param {number} km @returns {number} */
export function kmToMi(km) {
  return km * 0.621371;
}

/** @param {number} celsius @returns {number} */
export function cToF(celsius) {
  return celsius * 9 / 5 + 32;
}

/**
 * Bir mesafe/hız değerini (km veya km/h tabanlı) kullanıcı tercihine göre
 * biçimlendirir.
 * @param {number} value - km veya km/h cinsinden ham değer.
 * @param {'km'|'mi'} distanceUnit
 * @param {string} baseUnitLabel - ör. "km" veya "km/h".
 * @returns {{value: number, unit: string}}
 */
export function formatDistanceOrSpeed(value, distanceUnit, baseUnitLabel) {
  if (distanceUnit !== 'mi') {
    return { value, unit: baseUnitLabel };
  }
  const convertedUnit = baseUnitLabel.replace('km', 'mi');
  return { value: kmToMi(value), unit: convertedUnit };
}

/**
 * Bir sıcaklık değerini kullanıcı tercihine göre biçimlendirir.
 * @param {number} celsius
 * @param {'c'|'f'} temperatureUnit
 * @returns {{value: number, unit: string}}
 */
export function formatTemperature(celsius, temperatureUnit) {
  return temperatureUnit === 'f'
    ? { value: cToF(celsius), unit: '°F' }
    : { value: celsius, unit: '°C' };
}
