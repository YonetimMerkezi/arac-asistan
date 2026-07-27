/**
 * theme-manager.js
 * ---------------------------------------------------------------------------
 * Tema (koyu/açık/sistem) ve dinamik vurgu rengi yönetimi.
 *
 * theme.css içindeki CSS custom property'lerini (--sda-accent-hue vb.)
 * çalışma zamanında günceller ve kullanıcı tercihini Capacitor Preferences
 * üzerinden kalıcı olarak saklar.
 *
 * Bu modül tek bir sorumluluğa sahiptir (SOLID - Single Responsibility):
 * yalnızca tema durumunu yönetir; UI çizimiyle ilgilenmez.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logError, logInfo } from './logger.js';

/** @type {string} Preferences deposunda kullanılan anahtar. */
const STORAGE_KEY = 'sda_theme_settings';

/** @typedef {'dark'|'light'|'system'} ThemeMode */

/**
 * @typedef {Object} ThemeSettings
 * @property {ThemeMode} mode
 * @property {number} accentHue - 0-360 arası, ana vurgu rengi tonu.
 */

/** @type {ThemeSettings} Varsayılan tema ayarları (kehribar vurgu, sistem modu). */
const DEFAULT_SETTINGS = { mode: 'system', accentHue: 28 };

/** @type {Set<(settings: ThemeSettings) => void>} */
const listeners = new Set();

/** @type {ThemeSettings} */
let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Verilen ayarları <html> köküne uygular (data-theme + CSS değişkenleri).
 * @param {ThemeSettings} settings
 */
function applyToDocument(settings) {
  const root = document.documentElement;

  if (settings.mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', settings.mode);
  }

  root.style.setProperty('--sda-accent-hue', String(settings.accentHue));
  // İkincil vurguyu ana tondan 160° kaydırarak tamamlayıcı bir renk üret.
  root.style.setProperty('--sda-accent-hue-2', String((settings.accentHue + 160) % 360));
}

/**
 * Tema modülünü başlatır: kayıtlı tercihi yükler ve uygular.
 * Uygulama açılışında bir kez çağrılmalıdır (bkz. core/app-init.js).
 * @returns {Promise<ThemeSettings>}
 */
export async function initThemeManager() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      const parsed = JSON.parse(value);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    // Bozuk/okunamayan tercih varsayılana düşürülür; uygulama akışı bloklanmaz.
    logError('theme-manager', 'Kayıtlı tema tercihi okunamadı, varsayılana dönülüyor', error);
    currentSettings = { ...DEFAULT_SETTINGS };
  }

  applyToDocument(currentSettings);
  logInfo('theme-manager', 'Tema başlatıldı', currentSettings);
  return currentSettings;
}

/**
 * Tema modunu değiştirir (koyu / açık / sistem) ve kalıcı olarak saklar.
 * @param {ThemeMode} mode
 * @returns {Promise<void>}
 */
export async function setThemeMode(mode) {
  currentSettings = { ...currentSettings, mode };
  applyToDocument(currentSettings);
  await persist();
  notify();
}

/**
 * Dinamik vurgu rengini (hue) değiştirir. İleride Android 12+ Material You
 * paletinden okunan değer buraya köprülenebilir.
 * @param {number} hue - 0-360 arası derece.
 * @returns {Promise<void>}
 */
export async function setAccentHue(hue) {
  const clamped = Math.max(0, Math.min(360, Math.round(hue)));
  currentSettings = { ...currentSettings, accentHue: clamped };
  applyToDocument(currentSettings);
  await persist();
  notify();
}

/**
 * Güncel tema ayarlarının salt-okunur bir kopyasını döndürür.
 * @returns {ThemeSettings}
 */
export function getThemeSettings() {
  return { ...currentSettings };
}

/**
 * Tema değişikliklerine abone olur.
 * @param {(settings: ThemeSettings) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function onThemeChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Güncel ayarları Capacitor Preferences'a yazar.
 * @returns {Promise<void>}
 */
async function persist() {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(currentSettings) });
  } catch (error) {
    logError('theme-manager', 'Tema tercihi kaydedilemedi', error);
  }
}

/**
 * Tüm dinleyicileri güncel ayarlarla bilgilendirir.
 */
function notify() {
  for (const listener of listeners) {
    try {
      listener(getThemeSettings());
    } catch (error) {
      logError('theme-manager', 'Tema dinleyicisi hata fırlattı', error);
    }
  }
}
