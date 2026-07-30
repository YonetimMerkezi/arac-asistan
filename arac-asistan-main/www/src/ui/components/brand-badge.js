/**
 * brand-badge.js
 * ---------------------------------------------------------------------------
 * Renkli, dairesel akaryakıt marka rozeti üretir - istasyon listesinde,
 * fiyat tablosunda ve harita işaretçilerinde AYNI görsel dil (bkz.
 * core/brand-catalog.js) tekrar kullanılır (renk/rozet mantığı tek yerde).
 * ---------------------------------------------------------------------------
 */

import { resolveBrandVisual } from '../../core/brand-catalog.js';

/**
 * Bir markanın rozet HTML'ini üretir (innerHTML şablonlarına gömülebilir).
 * @param {string|null} brandName
 * @param {Object} [options]
 * @param {number} [options.size=32] - Piksel çap.
 * @param {string} [options.extraStyle=''] - Ek satır içi CSS.
 * @returns {string}
 */
export function brandBadgeMarkup(brandName, options = {}) {
  const { size = 32, extraStyle = '' } = options;
  const visual = resolveBrandVisual(brandName);
  const fontSize = Math.max(10, Math.round(size * 0.36));

  return `
    <span
      class="sda-brand-badge"
      style="
        display:inline-flex; align-items:center; justify-content:center;
        width:${size}px; height:${size}px; border-radius:50%;
        background:${visual.color}; color:${visual.textColor};
        font-weight:700; font-size:${fontSize}px; letter-spacing:0.02em;
        flex-shrink:0; ${extraStyle}
      "
      title="${visual.label}"
    >${visual.initials}</span>
  `;
}

/**
 * Bir markanın harita işaretçisi (Leaflet divIcon) için renkli HTML'ini üretir -
 * rozetten farklı olarak damla (pin) şekli ve beyaz kenarlığı var, haritada
 * daha görünür olması için.
 * @param {string|null} brandName
 * @returns {string}
 */
export function brandMarkerMarkup(brandName) {
  const visual = resolveBrandVisual(brandName);
  return `
    <div style="
      width:30px; height:30px; border-radius:50% 50% 50% 0;
      transform: rotate(-45deg);
      background:${visual.color}; border:2px solid #FFFFFF;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      display:flex; align-items:center; justify-content:center;
    ">
      <span style="
        transform: rotate(45deg); color:${visual.textColor};
        font-weight:700; font-size:11px;
      ">${visual.initials}</span>
    </div>
  `;
}

/**
 * Bir markanın rengini döndürür (badge/marker dışında, ör. filtre
 * sekmesi arka planı gibi tek bir renk gerektiğinde kullanılır).
 * @param {string|null} brandName
 * @returns {string} hex renk.
 */
export function brandColor(brandName) {
  return resolveBrandVisual(brandName).color;
}
