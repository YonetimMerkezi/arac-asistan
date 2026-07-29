/**
 * theme-manager.js
 * ---------------------------------------------------------------------------
 * Tema (koyu/açık/sistem), tema PAKETİ (renk/stil ön ayarı) ve serbest vurgu
 * rengi yönetimi.
 *
 * theme.css içindeki CSS custom property'lerini (--sda-accent-hue vb.) ve
 * data-style özniteliğini çalışma zamanında günceller, kullanıcı tercihini
 * Capacitor Preferences üzerinden kalıcı olarak saklar.
 *
 * Bu modül tek bir sorumluluğa sahiptir (SOLID - Single Responsibility):
 * yalnızca tema durumunu yönetir; UI çizimiyle ilgilenmez.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { getThemePackage, DEFAULT_PACKAGE_ID } from './theme-packages.js';
import { logError, logInfo } from './logger.js';

/** @type {string} Preferences deposunda kullanılan anahtar. */
const STORAGE_KEY = 'sda_theme_settings';

/** @typedef {'dark'|'light'|'system'|'auto'} ThemeMode */

/** @type {number} Bu saatten (dahil) itibaren koyu temaya geçilir ("auto" modunda). */
const AUTO_DARK_START_HOUR = 19;

/** @type {number} Bu saatten (dahil) itibaren açık temaya geçilir ("auto" modunda). */
const AUTO_LIGHT_START_HOUR = 7;

/** @type {number} "auto" modunda saatin yeniden kontrol edilme sıklığı (ms). */
const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** @type {ReturnType<typeof setInterval>|null} */
let autoModeInterval = null;

/**
 * @typedef {Object} ThemeSettings
 * @property {ThemeMode} mode
 * @property {string} packageId - theme-packages.js'teki bir paketin id'si.
 * @property {number} accentHue - 0-360, paketin üzerine kullanıcının elle
 *   ayarladığı sapma (paket seçilince sıfırlanır).
 */

/** @type {ThemeSettings} Varsayılan tema ayarları. */
const DEFAULT_SETTINGS = { mode: 'system', packageId: DEFAULT_PACKAGE_ID, accentHue: null };

/** @type {Set<(settings: ThemeSettings) => void>} */
const listeners = new Set();

/** @type {ThemeSettings} */
let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Verilen ayarları <html> köküne uygular (data-theme, data-style, CSS değişkenleri).
 * @param {ThemeSettings} settings
 */
function applyToDocument(settings) {
  const root = document.documentElement;

  if (settings.mode === 'system') {
    root.removeAttribute('data-theme');
  } else if (settings.mode === 'auto') {
    root.setAttribute('data-theme', isNighttimeNow() ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', settings.mode);
  }

  manageAutoModeInterval(settings.mode);

  const pkg = getThemePackage(settings.packageId);
  root.setAttribute('data-style', pkg.styleId);

  const accentHue = settings.accentHue ?? pkg.accentHue;
  const accentHue2 = settings.accentHue !== null
    ? (settings.accentHue + 160) % 360
    : pkg.accentHue2;

  root.style.setProperty('--sda-accent-hue', String(accentHue));
  root.style.setProperty('--sda-accent-hue-2', String(accentHue2));
}

/**
 * @returns {boolean} Şu an "gece" sayılan saat aralığında mıyız (auto mod için).
 */
function isNighttimeNow() {
  const hour = new Date().getHours();
  return hour >= AUTO_DARK_START_HOUR || hour < AUTO_LIGHT_START_HOUR;
}

/**
 * "auto" modu aktifken saat değişimini periyodik kontrol eden zamanlayıcıyı
 * kurar/kaldırır - yalnızca mod "auto" iken çalışır, gereksiz yere sürekli
 * dönmez.
 * @param {ThemeMode} mode
 */
function manageAutoModeInterval(mode) {
  if (autoModeInterval) {
    clearInterval(autoModeInterval);
    autoModeInterval = null;
  }

  if (mode !== 'auto') return;

  autoModeInterval = setInterval(() => {
    const root = document.documentElement;
    const shouldBeDark = isNighttimeNow();
    const isDark = root.getAttribute('data-theme') === 'dark';
    if (shouldBeDark !== isDark) {
      root.setAttribute('data-theme', shouldBeDark ? 'dark' : 'light');
      logInfo('theme-manager', `Otomatik tema geçişi: ${shouldBeDark ? 'koyu' : 'açık'}`);
    }
  }, AUTO_CHECK_INTERVAL_MS);
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
 * Bir tema PAKETİ seçer (renk + stil ön ayarı). Kullanıcının varsa özel
 * accentHue sapması sıfırlanır - paket kendi renklerini geçerli kılar.
 * @param {string} packageId - theme-packages.js'teki bir paketin id'si.
 * @returns {Promise<void>}
 */
export async function setThemePackage(packageId) {
  currentSettings = { ...currentSettings, packageId, accentHue: null };
  applyToDocument(currentSettings);
  await persist();
  notify();
}

/**
 * Seçili paketin üzerine kullanıcının serbestçe ayarladığı bir vurgu rengi
 * uygular ("tamamen özelleştirilebilir renk seçimi").
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
