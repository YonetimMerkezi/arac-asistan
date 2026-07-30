/**
 * pending-fuel-selection.js
 * ---------------------------------------------------------------------------
 * Harita/İstasyon ekranındaki "Yakıt Al" düğmesi ile Yakıt ekranındaki
 * "İstasyon seç" açılır menüsü arasında TEK seferlik bir el değiştirme
 * (handoff) taşır. navigation-view.js ve fuel-view.js birbirini import
 * ETMEZ (döngüsel bağımlılığı önlemek için) - bu küçük ortak durum dosyası
 * aradaki köprüdür.
 * ---------------------------------------------------------------------------
 */

/** @type {{brand: string, fuelType: 'benzin'|'motorin'|'lpg'}|null} */
let pending = null;

/**
 * Bir istasyon/yakıt türü seçimini bir sonraki Yakıt ekranı açılışında
 * kullanılmak üzere kaydeder.
 * @param {string} brand
 * @param {'benzin'|'motorin'|'lpg'} fuelType
 */
export function setPendingFuelSelection(brand, fuelType) {
  pending = { brand, fuelType };
}

/**
 * Bekleyen seçimi bir kez okuyup TÜKETİR (tekrar okununca null döner) -
 * böylece kullanıcı Yakıt ekranına başka bir yoldan tekrar girdiğinde eski
 * seçim sessizce tekrar uygulanmaz.
 * @returns {{brand: string, fuelType: 'benzin'|'motorin'|'lpg'}|null}
 */
export function consumePendingFuelSelection() {
  const value = pending;
  pending = null;
  return value;
}
