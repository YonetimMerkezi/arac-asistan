/**
 * keep-awake.js
 * ---------------------------------------------------------------------------
 * Uygulama açıkken telefon ekranının kararıp kilitlenmesini engeller -
 * araca monte edilip sürekli göstergeleri izlemek için kullanılan bir
 * uygulamada ekranın kendiliğinden kapanması istenmez.
 *
 * KeepAwake.keepAwake() Android'de WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
 * bayrağını kullanır - pil tüketimini artırır (ekran sürekli açık kalır),
 * bu yüzden Ayarlar'da kullanıcı isterse kapatabileceği bir tercih olarak
 * sunulur (varsayılan: açık - "ben kapatmadıkça ekran kapanmasın" isteği).
 * ---------------------------------------------------------------------------
 */

import { KeepAwake } from '@capacitor-community/keep-awake';
import { Preferences } from '@capacitor/preferences';
import { logInfo, logWarn } from './logger.js';

/** @type {string} Tercihi kalıcı saklamak için kullanılan anahtar. */
const STORAGE_KEY = 'sda_keep_awake_enabled';

/** @type {boolean} Şu an ekranın açık tutulup tutulmadığı. */
let enabled = true;

/**
 * Kayıtlı tercihe göre ekranı açık tutmayı başlatır (varsayılan: açık).
 * Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function initKeepAwake() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    enabled = value !== 'false'; // yalnızca AÇIKÇA "false" kaydedilmişse kapalı başlar.
  } catch (error) {
    logWarn('keep-awake', 'Tercih okunamadı, varsayılan (açık) kullanılıyor', error);
  }

  if (enabled) {
    await applyState();
  }
}

/**
 * Ekranı açık tutma tercihini değiştirir ve kalıcı saklar.
 * @param {boolean} nextEnabled
 * @returns {Promise<void>}
 */
export async function setKeepAwakeEnabled(nextEnabled) {
  enabled = nextEnabled;
  await Preferences.set({ key: STORAGE_KEY, value: String(nextEnabled) });
  await applyState();
}

/**
 * @returns {boolean}
 */
export function isKeepAwakeEnabled() {
  return enabled;
}

/**
 * @returns {Promise<void>}
 */
async function applyState() {
  try {
    if (enabled) {
      await KeepAwake.keepAwake();
      logInfo('keep-awake', 'Ekran açık tutuluyor');
    } else {
      await KeepAwake.allowSleep();
      logInfo('keep-awake', 'Ekran normal (otomatik kararma) davranışına döndü');
    }
  } catch (error) {
    logWarn('keep-awake', 'Ekran açık tutma durumu ayarlanamadı', error);
  }
}
