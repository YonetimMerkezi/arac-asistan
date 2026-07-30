/**
 * gps-detail-card.js
 * ---------------------------------------------------------------------------
 * Harita ekranında katlanabilir "GPS Detayları" kartı: enlem, boylam, rakım,
 * yön, hassasiyet - canlı olarak core/gps-tracker.js akışından günceller.
 *
 * DÜRÜSTLÜK NOTU: Referans ekran görüntüsündeki "Uydu sayısı" burada YOK -
 * Capacitor/web Geolocation API'si (ve dolayısıyla bu projenin kullandığı
 * @capacitor/geolocation) uydu sayısını hiç raporlamaz; bu yalnızca
 * Android'in native GnssStatus.Callback API'siyle (ayrı bir native plugin
 * yazımı gerektirir) elde edilebilir. Diğer tüm alanlar (enlem/boylam/
 * rakım/yön/hassasiyet) zaten mevcut GPS akışından geliyor.
 * ---------------------------------------------------------------------------
 */

import { onPosition } from '../../core/gps-tracker.js';
import { iconMarkup } from '../icons.js';

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * GPS detay kartını verilen konteynere monte eder ve canlı güncellemeye başlar.
 * @param {HTMLElement} container
 */
export function mountGpsDetailCard(container) {
  container.innerHTML = `
    <button type="button" data-gps-toggle class="sda-nav-btn" style="width:100%; margin-bottom:8px; background:var(--sda-bg-elevated); flex-direction:row; justify-content:center; gap:8px; padding:12px;">
      ${iconMarkup('location', { size: 18 })}<span>GPS Detayları</span>
    </button>
    <div data-gps-body class="sda-card" style="display:none; margin-bottom:8px;">
      <div data-gps-fields style="display:grid; grid-template-columns:1fr 1fr; gap:8px;"></div>
    </div>
  `;

  const body = container.querySelector('[data-gps-body]');
  container.querySelector('[data-gps-toggle]')?.addEventListener('click', () => {
    if (!body) return;
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });

  unsubscribe = onPosition((position) => {
    const fieldsEl = container.querySelector('[data-gps-fields]');
    if (!fieldsEl) return;

    fieldsEl.innerHTML = [
      ['Enlem', `${position.latitude.toFixed(5)}°`],
      ['Boylam', `${position.longitude.toFixed(5)}°`],
      ['Rakım', position.altitude !== null ? `${position.altitude.toFixed(0)} m` : '—'],
      ['Yön', position.headingDeg !== null ? `${position.headingDeg.toFixed(0)}°` : '—'],
      ['Hassasiyet', `${position.accuracy.toFixed(0)} m`],
      ['Hız (GPS)', `${position.speedKmh.toFixed(0)} km/h`],
    ].map(([label, value]) => `
      <div>
        <p class="sda-card__label" style="margin:0;">${label}</p>
        <p class="sda-card__value" style="font-size:0.95rem; margin:2px 0 0 0;">${value}</p>
      </div>
    `).join('');
  });
}

/**
 * Kartı ve aboneliğini temizler.
 */
export function unmountGpsDetailCard() {
  unsubscribe?.();
  unsubscribe = null;
}
