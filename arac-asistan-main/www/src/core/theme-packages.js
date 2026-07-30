/**
 * theme-packages.js
 * ---------------------------------------------------------------------------
 * Tema PAKETİ kaydı - saf veri.
 *
 * Bir "paket", theme.css'teki token sistemine (--sda-accent-hue ve
 * --sda-accent-hue-2) uygulanacak bir renk ön ayarı + isteğe bağlı bir
 * "stil" anahtarıdır (data-style özniteliği ile theme.css'te ek görsel
 * kurallar - ör. neon parlama efekti - tetiklenir).
 *
 * YENİ PAKET EKLEMEK: Bu diziye bir nesne eklemek yeterlidir - theme-manager.js
 * ve settings-view.js hiç değişmez (Open/Closed prensibi). Yeni bir görsel
 * KARAKTER (ör. "neon" parlama gibi) gerekiyorsa theme.css'e
 * `[data-style="yeni-id"]` altında birkaç kural eklemek yeterlidir.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} ThemePackage
 * @property {string} id
 * @property {string} label - Türkçe görünen ad.
 * @property {number} accentHue - 0-360, birincil vurgu rengi.
 * @property {number} accentHue2 - 0-360, ikincil vurgu rengi.
 * @property {string} styleId - theme.css'te `[data-style="..."]` ile eşleşir.
 */

/** @type {ThemePackage[]} */
export const THEME_PACKAGES = [
  {
    id: 'klasik',
    label: 'Klasik (Kehribar)',
    accentHue: 28,
    accentHue2: 187,
    styleId: 'klasik',
  },
  {
    id: 'neon',
    label: 'Neon (Yeşil/Mavi)',
    accentHue: 142,
    accentHue2: 199,
    styleId: 'neon',
  },
  {
    id: 'gunbatimi',
    label: 'Gün Batımı',
    accentHue: 12,
    accentHue2: 291,
    styleId: 'gunbatimi',
  },
];

/** @type {string} Varsayılan paket id'si. */
export const DEFAULT_PACKAGE_ID = 'klasik';

/**
 * Bir paket id'sine karşılık gelen tanımı döndürür.
 * @param {string} id
 * @returns {ThemePackage}
 */
export function getThemePackage(id) {
  return THEME_PACKAGES.find((p) => p.id === id) ?? THEME_PACKAGES[0];
}
