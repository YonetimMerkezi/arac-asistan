/**
 * trip-view.js
 * ---------------------------------------------------------------------------
 * Yolculuklar ekranı: geçmiş yolculukları listeler, birine dokununca
 * detay (özet + hız grafiği + PDF/Excel dışa aktarma) gösterir.
 *
 * Veri: trip-repository.js. Grafik: charts/trip-chart.js.
 * Dışa aktarma: trip-report-pdf.js / trip-report-excel.js + file-export.js.
 * ---------------------------------------------------------------------------
 */

import { listTrips, getTripDetail } from '../data/trip-repository.js';
import { getActiveTripStats } from '../trip/trip-recorder.js';
import { onPosition } from '../core/gps-tracker.js';
import { renderTripSpeedChart, destroyTripChart } from '../charts/trip-chart.js';
import { generateTripPdfReport } from '../trip/trip-report-pdf.js';
import { generateTripExcelReport } from '../trip/trip-report-excel.js';
import { saveAndShareReport } from '../trip/file-export.js';
import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { getUnits } from '../core/units-store.js';
import { formatDistanceOrSpeed } from '../core/unit-conversion.js';
import { logError, logWarn } from '../core/logger.js';

/** @type {HTMLElement|null} */
let container = null;

/** @type {'list'|'detail'} Canlı konum güncellemesinin listedeki kartı mı,
 * yoksa hiçbir şeyi mi etkileyeceğini bilmek için (detay ekranındayken
 * dokunmamalı). */
let viewMode = 'list';

/**
 * Yolculuklar görünümünü başlatır ve listeyi yükler.
 */
export function initTripView() {
  container = document.querySelector('[data-view="trip"]');
  if (!container) {
    logWarn('trip-view', 'Yolculuklar konteyneri bulunamadı');
    return;
  }

  renderList();

  // Bağlantı kurulunca (yolculuk BAŞLAYABİLİR) ve kesilince (yolculuk
  // BİTER) listeyi tazele - böylece canlı kart doğru anda belirir/kaybolur.
  onBluetoothStateChange((state) => {
    if (state.status === 'connected' || state.status === 'disconnected') renderList();
  });

  // DÜZELTME: önceden ekran yalnızca yolculuk BİTİNCE (yukarıdaki olay)
  // güncelleniyordu - sürüş SIRASINDA hiçbir ilerleme gösterilmiyordu.
  // Artık her GPS güncellemesinde, EĞER liste ekranındaysak VE aktif bir
  // yolculuk varsa, canlı kartın rakamları (tam yeniden çizim olmadan,
  // titremeyi önlemek için) güncellenir.
  onPosition((position) => {
    if (viewMode !== 'list') return;
    updateLiveTripCard(position);
  });
}

/**
 * Yolculuk listesini yükler ve çizer - devam eden bir yolculuk varsa en
 * üste canlı bir ilerleme kartı ekler.
 */
async function renderList() {
  if (!container) return;
  viewMode = 'list';

  const trips = await listTrips();
  const activeStats = getActiveTripStats();
  const liveCardHtml = activeStats ? buildLiveTripCardHtml(activeStats) : '';

  if (trips.length === 0 && !activeStats) {
    container.innerHTML = `
      <div class="sda-empty-state">
        <p class="sda-empty-state__title">Henüz yolculuk yok</p>
        <p>Araca bağlandığında yolculuk kaydı otomatik başlayacak.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `${liveCardHtml}<div data-trip-list></div>`;
  const listEl = container.querySelector('[data-trip-list]');

  for (const trip of trips) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sda-card';
    item.style.cssText = 'display:block; width:100%; text-align:left; margin-bottom: var(--sda-space-3); border:none; cursor:pointer;';
    item.innerHTML = `
      <p class="sda-card__label">${new Date(trip.start_time).toLocaleDateString('tr-TR')}</p>
      <p class="sda-card__value" style="font-size:1.1rem;">${formatTripDistance(trip.distance_km)} · ${formatTripSpeed(trip.avg_speed_kmh)} ort.</p>
    `;
    item.addEventListener('click', () => {
      viewMode = 'detail';
      renderDetail(trip.id);
    });
    listEl.appendChild(item);
  }
}

/**
 * @param {{startedAt: number, distanceKm: number, maxSpeedKmh: number}} stats
 * @returns {string}
 */
function buildLiveTripCardHtml(stats) {
  const elapsedMinutes = Math.round((Date.now() - stats.startedAt) / 60000);
  return `
    <div class="sda-card sda-card--elevated" style="margin-bottom:var(--sda-space-4); border:1px solid var(--sda-accent);">
      <p class="sda-card__label" style="color:var(--sda-accent);">● Devam Eden Yolculuk</p>
      <div class="sda-grid" style="margin-top:8px;">
        <div><p class="sda-card__label">Mesafe</p><p data-live-distance class="sda-card__value">${formatTripDistance(stats.distanceKm)}</p></div>
        <div><p class="sda-card__label">Süre</p><p data-live-duration class="sda-card__value">${elapsedMinutes} dk</p></div>
        <div><p class="sda-card__label">Azami Hız</p><p data-live-max-speed class="sda-card__value">${formatTripSpeed(stats.maxSpeedKmh)}</p></div>
        <div><p class="sda-card__label">Şu Anki Hız</p><p data-live-current-speed class="sda-card__value">-- km/h</p></div>
      </div>
    </div>
  `;
}

/**
 * Canlı yolculuk kartının rakamlarını GPS akışına göre günceller - tam
 * yeniden çizim YAPMAZ (liste kaybolup titremesin diye), yalnızca ilgili
 * metin düğümlerini günceller.
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function updateLiveTripCard(position) {
  const stats = getActiveTripStats();
  const card = container?.querySelector('[data-live-distance]')?.closest('.sda-card');
  if (!container) return;

  if (!stats) {
    if (card) renderList(); // Yolculuk bu arada bittiyse listeyi tazele.
    return;
  }
  if (!card) return; // Kart henüz DOM'da değil (renderList henüz eklemedi) - sıradaki tikte tekrar denenir.

  const distanceEl = container.querySelector('[data-live-distance]');
  const durationEl = container.querySelector('[data-live-duration]');
  const maxSpeedEl = container.querySelector('[data-live-max-speed]');
  const currentSpeedEl = container.querySelector('[data-live-current-speed]');

  if (distanceEl) distanceEl.textContent = formatTripDistance(stats.distanceKm);
  if (durationEl) durationEl.textContent = `${Math.round((Date.now() - stats.startedAt) / 60000)} dk`;
  if (maxSpeedEl) maxSpeedEl.textContent = formatTripSpeed(stats.maxSpeedKmh);
  if (currentSpeedEl) currentSpeedEl.textContent = formatTripSpeed(position.speedKmh);
}

/**
 * Bir yolculuğun detayını (özet, grafik, dışa aktarma düğmeleri) gösterir.
 * @param {number} tripId
 */
async function renderDetail(tripId) {
  if (!container) return;
  const { trip, points } = await getTripDetail(tripId);
  if (!trip) return;

  container.innerHTML = `
    <button type="button" data-back style="background:none;border:none;color:var(--sda-accent);margin-bottom:var(--sda-space-3);">← Geri</button>
    <div class="sda-grid" style="margin-bottom:var(--sda-space-4);">
      <div class="sda-card"><p class="sda-card__label">Mesafe</p><p class="sda-card__value">${formatTripDistance(trip.distance_km)}</p></div>
      <div class="sda-card"><p class="sda-card__label">Süre</p><p class="sda-card__value">${formatDuration(trip.duration_s)}</p></div>
      <div class="sda-card"><p class="sda-card__label">Ort. Hız</p><p class="sda-card__value">${formatTripSpeed(trip.avg_speed_kmh)}</p></div>
      <div class="sda-card"><p class="sda-card__label">Yakıt</p><p class="sda-card__value">${trip.fuel_used_l.toFixed(2)} L</p></div>
    </div>
    <canvas data-trip-chart height="180"></canvas>
    <div style="display:flex; gap: var(--sda-space-3); margin-top: var(--sda-space-4);">
      <button type="button" data-export="pdf" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex:1;">PDF</button>
      <button type="button" data-export="excel" class="sda-nav-btn" style="background:var(--sda-accent-2-soft); flex:1;">Excel</button>
    </div>
  `;

  const canvas = container.querySelector('[data-trip-chart]');
  if (canvas) renderTripSpeedChart(canvas, points);

  container.querySelector('[data-back]')?.addEventListener('click', () => {
    if (canvas) destroyTripChart(canvas);
    renderList();
  });

  container.querySelector('[data-export="pdf"]')?.addEventListener('click', async () => {
    try {
      const blob = generateTripPdfReport(trip);
      await saveAndShareReport(blob, `yolculuk-${trip.id}.pdf`);
    } catch (error) {
      logError('trip-view', 'PDF raporu oluşturulamadı', error);
      alert('PDF raporu oluşturulamadı. Lütfen tekrar deneyin.');
    }
  });

  container.querySelector('[data-export="excel"]')?.addEventListener('click', async () => {
    try {
      const blob = generateTripExcelReport(trip, points);
      await saveAndShareReport(blob, `yolculuk-${trip.id}.xlsx`);
    } catch (error) {
      logError('trip-view', 'Excel raporu oluşturulamadı', error);
      alert('Excel raporu oluşturulamadı. Lütfen tekrar deneyin.');
    }
  });
}

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours} sa ${minutes} dk`;
}

/**
 * Mesafeyi kullanıcının Ayarlar'dan seçtiği birime (km/mil) çevirip biçimlendirir.
 * @param {number} km
 * @returns {string}
 */
function formatTripDistance(km) {
  const { value, unit } = formatDistanceOrSpeed(km, getUnits().distance, 'km');
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * @param {number} kmh
 * @returns {string}
 */
function formatTripSpeed(kmh) {
  const { value, unit } = formatDistanceOrSpeed(kmh, getUnits().distance, 'km/h');
  return `${value.toFixed(0)} ${unit}`;
}
