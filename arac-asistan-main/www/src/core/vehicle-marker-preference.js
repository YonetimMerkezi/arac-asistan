/**
 * vehicle-marker-preference.js
 * ---------------------------------------------------------------------------
 * Haritadaki araç işaretçisinin şekli (nokta/ok/araba) tercihini kalıcı saklar.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logWarn } from './logger.js';

const STORAGE_KEY = 'sda_vehicle_marker_shape';

/** @typedef {'dot'|'arrow'|'car'} MarkerShape */

/** @type {MarkerShape} */
let cachedShape = 'arrow';

/**
 * @returns {Promise<void>}
 */
export async function initVehicleMarkerPreference() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value === 'dot' || value === 'arrow' || value === 'car') {
      cachedShape = value;
    }
  } catch (error) {
    logWarn('vehicle-marker-preference', 'Tercih okunamadı, varsayılan kullanılıyor', error);
  }
}

/**
 * @returns {MarkerShape}
 */
export function getVehicleMarkerShape() {
  return cachedShape;
}

/**
 * @param {MarkerShape} shape
 * @returns {Promise<void>}
 */
export async function setVehicleMarkerShape(shape) {
  cachedShape = shape;
  await Preferences.set({ key: STORAGE_KEY, value: shape });
}
