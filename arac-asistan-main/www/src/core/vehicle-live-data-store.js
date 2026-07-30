/**
 * vehicle-live-data-store.js
 * ---------------------------------------------------------------------------
 * dashboard-view.js'in poll döngüsünde okuduğu en güncel PID değerlerini
 * önbelleğe alan paylaşılan depo.
 *
 * Neden gerekli: ELM327 tek seferde yalnızca bir komutu yanıtlayabilir
 * (yarı çift yönlü). Sesli asistan (Faz 3) "motor sıcaklığı kaç" gibi bir
 * komut duyduğunda YENİ bir OBD sorgusu göndermek yerine, dashboard zaten
 * saniyede birkaç kez okuduğu bu değeri buradan okur - hem daha hızlı yanıt
 * verir hem komut kuyruğunu gereksiz tıkamaz.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} LivePidValue
 * @property {number} value
 * @property {string} unit
 * @property {number} updatedAt - Unix ms.
 */

/** @type {Map<string, LivePidValue>} PID kodu (hex) -> son bilinen değer. */
const values = new Map();

/** @type {Set<(pid: string, entry: LivePidValue) => void>} */
const listeners = new Set();

/** @type {number} Bu süreden (ms) eski değerler "bayat" sayılır ve sorgu yapılmamışsa null döner. */
const STALE_THRESHOLD_MS = 5000;

/**
 * Bir PID'in en güncel değerini günceller.
 * @param {string} pidHex
 * @param {number} value
 * @param {string} unit
 */
export function setLivePidValue(pidHex, value, unit) {
  const entry = { value, unit, updatedAt: Date.now() };
  values.set(pidHex.toUpperCase(), entry);
  for (const listener of listeners) {
    listener(pidHex.toUpperCase(), entry);
  }
}

/**
 * Bir PID'in son bilinen değerini döndürür. Değer yoksa veya çok eskiyse
 * (bağlantı kopmuş olabilir) null döner.
 * @param {string} pidHex
 * @returns {LivePidValue|null}
 */
export function getLivePidValue(pidHex) {
  const entry = values.get(pidHex.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > STALE_THRESHOLD_MS) return null;
  return entry;
}

/**
 * Canlı veri değişikliklerine abone olur (ör. sesli uyarı eşik denetimi için).
 * @param {(pid: string, entry: LivePidValue) => void} callback
 * @returns {() => void}
 */
export function onLiveDataChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
