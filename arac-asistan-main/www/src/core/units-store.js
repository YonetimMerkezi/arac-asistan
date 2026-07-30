/**
 * units-store.js
 * ---------------------------------------------------------------------------
 * Kullanıcının birim tercihini (km/mil, °C/°F) kalıcı olarak saklar.
 * theme-manager.js ile aynı desende: initUnitsStore() açılışta bir kez
 * çağrılır, değişiklikler onUnitsChange() ile dinlenebilir.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError, logInfo } from './logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_units';

/** @typedef {{distance: 'km'|'mi', temperature: 'c'|'f'}} UnitsSettings */

/** @type {UnitsSettings} */
const DEFAULT_UNITS = { distance: 'km', temperature: 'c' };

/** @type {UnitsSettings} */
let current = { ...DEFAULT_UNITS };

/** @type {Set<(units: UnitsSettings) => void>} */
const listeners = new Set();

/**
 * Kayıtlı birim tercihini yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<UnitsSettings>}
 */
export async function initUnitsStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) current = { ...DEFAULT_UNITS, ...JSON.parse(value) };
  } catch (error) {
    logError('units-store', 'Birim tercihi okunamadı, varsayılana dönülüyor', error);
    current = { ...DEFAULT_UNITS };
  }
  logInfo('units-store', 'Birim tercihi yüklendi', current);
  return current;
}

/**
 * @returns {UnitsSettings}
 */
export function getUnits() {
  return { ...current };
}

/**
 * Birim tercihini günceller ve kalıcı olarak saklar.
 * @param {Partial<UnitsSettings>} partial
 * @returns {Promise<void>}
 */
export async function setUnits(partial) {
  current = { ...current, ...partial };
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(current) });
  } catch (error) {
    logError('units-store', 'Birim tercihi kaydedilemedi', error);
  }
  for (const listener of listeners) listener(getUnits());
}

/**
 * Birim değişikliklerine abone olur.
 * @param {(units: UnitsSettings) => void} callback
 * @returns {() => void}
 */
export function onUnitsChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
