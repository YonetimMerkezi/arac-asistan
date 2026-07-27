/**
 * vehicle-info-store.js
 * ---------------------------------------------------------------------------
 * Faz 1'de (elm327.js) keşfedilen araç bilgilerini (desteklenen PID'ler,
 * VIN, yakıt tipi) tutan paylaşılan durum deposu.
 *
 * Neden ayrı bir dosya: dashboard-view.js (Faz 2), voice modülü (Faz 3) ve
 * ayarlar ekranı (Faz 9) bu bilgiye ihtiyaç duyacak. Her biri kendi kopyasını
 * tutmak yerine tek bir kaynaktan okur (Single Source of Truth).
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} VehicleInfo
 * @property {string[]} supportedPids
 * @property {string|null} vin
 * @property {string|null} fuelType
 */

/** @type {VehicleInfo} */
let info = { supportedPids: [], vin: null, fuelType: null };

/** @type {Set<(info: VehicleInfo) => void>} */
const listeners = new Set();

/**
 * Araç bilgisini günceller (elm327 keşfi tamamlandığında app-init.js çağırır).
 * @param {Partial<VehicleInfo>} partial
 */
export function setVehicleInfo(partial) {
  info = { ...info, ...partial };
  for (const listener of listeners) {
    listener(getVehicleInfo());
  }
}

/**
 * Güncel araç bilgisinin salt-okunur kopyasını döndürür.
 * @returns {VehicleInfo}
 */
export function getVehicleInfo() {
  return { ...info, supportedPids: [...info.supportedPids] };
}

/**
 * Belirli bir PID'in araç tarafından destekleniyor olup olmadığını sorar.
 * @param {string} pidHex
 * @returns {boolean}
 */
export function isPidSupported(pidHex) {
  return info.supportedPids.includes(pidHex.toUpperCase());
}

/**
 * Araç bilgisi değişikliklerine abone olur.
 * @param {(info: VehicleInfo) => void} callback
 * @returns {() => void}
 */
export function onVehicleInfoChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
