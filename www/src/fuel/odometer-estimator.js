/**
 * odometer-estimator.js
 * ---------------------------------------------------------------------------
 * Kilometre sayacı TAHMİNİ.
 *
 * ÖNEMLİ DÜRÜSTLÜK NOTU: Standart OBD-II Mod 01 PID kümesinde toplam
 * kilometre sayacı YOKTUR (yalnızca üretici özel Mod 22 PID'lerinde olabilir,
 * ki bu araca göre değişir ve genellenemez). Bu yüzden gerçek km sayacı
 * OKUNMUYOR - kullanıcının bir kez girdiği taban değere, o andan sonraki
 * yolculuk mesafelerinin toplamı eklenerek TAHMİN ediliyor. Bakım
 * hatırlatıcıları bu tahmini kullanır ve UI'da her zaman "tahmini" olarak
 * etiketlenmelidir.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { sumDistanceSince } from '../data/trip-repository.js';
import { logError, logInfo } from '../core/logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_odometer_baseline';

/**
 * @typedef {Object} OdometerBaseline
 * @property {number} km
 * @property {number} setAt - Unix ms.
 */

/**
 * Kullanıcının o anki gerçek kilometre sayacı değerini taban olarak kaydeder.
 * (Ayarlar ekranından - Faz 9 - çağrılması beklenir, ama API şimdiden hazır.)
 * @param {number} km
 * @returns {Promise<void>}
 */
export async function setOdometerBaseline(km) {
  /** @type {OdometerBaseline} */
  const baseline = { km, setAt: Date.now() };
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(baseline) });
    logInfo('odometer-estimator', `Taban km kaydedildi: ${km}`);
  } catch (error) {
    logError('odometer-estimator', 'Taban km kaydedilemedi', error);
  }
}

/**
 * Güncel tahmini kilometre sayacı değerini döndürür: taban + o tarihten
 * sonraki yolculuk mesafeleri toplamı.
 * @returns {Promise<number|null>} Taban hiç ayarlanmadıysa null.
 */
export async function getEstimatedOdometerKm() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (!value) return null;

    /** @type {OdometerBaseline} */
    const baseline = JSON.parse(value);
    const distanceSince = await sumDistanceSince(baseline.setAt);
    return baseline.km + distanceSince;
  } catch (error) {
    logError('odometer-estimator', 'Tahmini km hesaplanamadı', error);
    return null;
  }
}
