/**
 * nav-fullscreen-state.js
 * ---------------------------------------------------------------------------
 * Navigasyon ekranının tam ekran modunun PAYLAŞILAN durumu.
 *
 * NEDEN AYRI BİR MODÜL: Tam ekran durumu önceden navigation-map-overlay.js
 * içinde YEREL bir değişkendi - yalnızca oradaki düğmenin tıklama olayı
 * bunu değiştirebiliyordu. Ama fiziksel GERİ TUŞUNUN da "tam ekrandaysam
 * önce ondan çık" davranışını uygulayabilmesi için (bkz. core/back-button.js)
 * bu durumun UYGULAMA GENELİNDE okunup değiştirilebilmesi gerekiyordu.
 * ---------------------------------------------------------------------------
 */

/** @type {boolean} */
let isFullscreen = false;

/** @type {Set<(enabled: boolean) => void>} */
const listeners = new Set();

/**
 * @returns {boolean}
 */
export function isNavFullscreen() {
  return isFullscreen;
}

/**
 * @param {boolean} enabled
 */
export function setNavFullscreen(enabled) {
  if (isFullscreen === enabled) return;
  isFullscreen = enabled;
  for (const listener of listeners) listener(enabled);
}

/**
 * @param {(enabled: boolean) => void} callback
 * @returns {() => void}
 */
export function onNavFullscreenChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
