/**
 * refresh-registry.js
 * ---------------------------------------------------------------------------
 * Her ekranın "kaydırarak yenile" jestinde NE yapılacağını kendi kaydettiği
 * hafif bir kayıt defteri.
 *
 * NEDEN AYRI DOSYA: view-router.js her `.sda-view` için pull-to-refresh
 * jestini TAKAR, ama HANGİ ekranda yenilemenin ne anlama geldiğini (Panel'de
 * anlık PID/hava durumu, Harita'da yakın istasyonlar, Yakıt'ta fiyat listesi
 * vb.) BİLMEMELİDİR (Single Responsibility). Bu dosya ikisi arasındaki
 * sözleşmedir - bir view kendi init fonksiyonunda registerRefreshHandler()
 * çağırır, view-router.js yalnızca getRefreshHandler() ile çağırır.
 * ---------------------------------------------------------------------------
 */

/** @type {Map<string, () => Promise<void>|void>} view adı -> yenileme fonksiyonu. */
const handlers = new Map();

/**
 * Bir ekran için yenileme davranışını kaydeder.
 * @param {string} viewName - ör. "dashboard", "navigation".
 * @param {() => Promise<void>|void} handler
 */
export function registerRefreshHandler(viewName, handler) {
  handlers.set(viewName, handler);
}

/**
 * Bir ekranın yenileme fonksiyonunu döndürür - kayıtlı değilse GÜVENLİ bir
 * no-op döner (jest görsel olarak çalışır, yalnızca ek bir eylem yapmaz).
 * @param {string} viewName
 * @returns {() => Promise<void>|void}
 */
export function getRefreshHandler(viewName) {
  return handlers.get(viewName) ?? (() => {});
}
