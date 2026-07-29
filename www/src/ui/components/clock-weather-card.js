/**
 * clock-weather-card.js
 * ---------------------------------------------------------------------------
 * Panel'in üstünde her zaman görünen saat/tarih + hava durumu kartı.
 *
 * Bu, bir OBD widget'ı DEĞİLDİR (bkz. obd/widget-registry.js) - araç
 * bağlantısından bağımsız olarak her zaman çalışır, bu yüzden dashboard-view.js
 * içinde ayrı bir bileşen olarak tutulur (Single Responsibility: widget
 * kaydı yalnızca ARAÇ verisini, bu dosya yalnızca saat+hava durumunu bilir).
 * ---------------------------------------------------------------------------
 */

import { getCurrentWeather } from '../../maps/weather-service.js';
import { getLastPosition, onPosition } from '../../core/gps-tracker.js';
import { logWarn } from '../../core/logger.js';

/** @type {number} Saat gösterimini güncelleme aralığı (ms). */
const CLOCK_TICK_MS = 1000;

/** @type {ReturnType<typeof setInterval>|null} */
let clockInterval = null;

/** @type {(() => void)|null} */
let unsubscribePosition = null;

/** @type {HTMLElement|null} Şu an bağlı kart konteyneri - refreshWeatherNow() için. */
let mountedContainer = null;

/**
 * Saat/tarih/hava durumu kartını verilen konteynere monte eder. Yalnızca
 * Panel görünümü ilk kez oluşturulurken bir kez çağrılmalıdır.
 * @param {HTMLElement} container - İçine kart HTML'inin ekleneceği eleman.
 */
export function mountClockWeatherCard(container) {
  mountedContainer = container;
  container.innerHTML = `
    <div class="sda-card sda-card--elevated" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <div>
        <p data-clock-time style="font-family:var(--sda-font-display); font-size:1.8rem; margin:0; color:var(--sda-text-primary);"></p>
        <p data-clock-date class="sda-card__label" style="margin:2px 0 0 0;"></p>
      </div>
      <div data-weather style="text-align:right;">
        <p class="sda-card__label">Yükleniyor...</p>
      </div>
    </div>
  `;

  tickClock(container);
  clockInterval = setInterval(() => tickClock(container), CLOCK_TICK_MS);

  const last = getLastPosition();
  if (last) void refreshWeather(container, last.latitude, last.longitude);

  unsubscribePosition = onPosition((position) => {
    void refreshWeather(container, position.latitude, position.longitude);
  });
}

/**
 * Kartı ve arkasındaki zamanlayıcı/aboneliği temizler (ör. görünüm yeniden
 * kurulacaksa bellek sızıntısı önleme).
 */
export function unmountClockWeatherCard() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = null;
  unsubscribePosition?.();
  unsubscribePosition = null;
  mountedContainer = null;
}

/**
 * Hava durumunu ÖNBELLEĞİ ATLAYARAK yeniden çeker - "kaydırarak yenile"
 * jesti tarafından çağrılır (bkz. core/refresh-registry.js).
 * @returns {Promise<void>}
 */
export async function refreshWeatherNow() {
  if (!mountedContainer) return;
  const last = getLastPosition();
  if (!last) return;
  await refreshWeather(mountedContainer, last.latitude, last.longitude, true);
}

/**
 * @param {HTMLElement} container
 */
function tickClock(container) {
  const now = new Date();
  const timeEl = container.querySelector('[data-clock-time]');
  const dateEl = container.querySelector('[data-clock-date]');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

/**
 * @param {HTMLElement} container
 * @param {number} lat
 * @param {number} lon
 * @param {boolean} [force=false]
 */
async function refreshWeather(container, lat, lon, force = false) {
  const weatherEl = container.querySelector('[data-weather]');
  if (!weatherEl) return;

  try {
    const weather = await getCurrentWeather(lat, lon, force);
    if (!weather || weather.temperatureC === null) {
      weatherEl.innerHTML = '<p class="sda-card__label">Hava durumu alınamadı</p>';
      return;
    }
    weatherEl.innerHTML = `
      <p style="font-size:1.6rem; margin:0;">${weather.icon} ${Math.round(weather.temperatureC)}°C</p>
      <p class="sda-card__label" style="margin:2px 0 0 0;">${weather.label}</p>
    `;
  } catch (error) {
    logWarn('clock-weather-card', 'Hava durumu güncellenemedi', error);
  }
}
