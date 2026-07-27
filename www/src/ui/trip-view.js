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
import { renderTripSpeedChart, destroyTripChart } from '../charts/trip-chart.js';
import { generateTripPdfReport } from '../trip/trip-report-pdf.js';
import { generateTripExcelReport } from '../trip/trip-report-excel.js';
import { saveAndShareReport } from '../trip/file-export.js';
import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { logWarn } from '../core/logger.js';

/** @type {HTMLElement|null} */
let container = null;

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

  // Bir yolculuk bitince (bağlantı kesilince) listeyi tazele.
  onBluetoothStateChange((state) => {
    if (state.status === 'disconnected') renderList();
  });
}

/**
 * Yolculuk listesini yükler ve çizer.
 */
async function renderList() {
  if (!container) return;
  const trips = await listTrips();

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="sda-empty-state">
        <p class="sda-empty-state__title">Henüz yolculuk yok</p>
        <p>Araca bağlandığında yolculuk kaydı otomatik başlayacak.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div data-trip-list></div>`;
  const listEl = container.querySelector('[data-trip-list]');

  for (const trip of trips) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sda-card';
    item.style.cssText = 'display:block; width:100%; text-align:left; margin-bottom: var(--sda-space-3); border:none; cursor:pointer;';
    item.innerHTML = `
      <p class="sda-card__label">${new Date(trip.start_time).toLocaleDateString('tr-TR')}</p>
      <p class="sda-card__value" style="font-size:1.1rem;">${trip.distance_km.toFixed(1)} km · ${trip.avg_speed_kmh.toFixed(0)} km/h ort.</p>
    `;
    item.addEventListener('click', () => renderDetail(trip.id));
    listEl.appendChild(item);
  }
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
      <div class="sda-card"><p class="sda-card__label">Mesafe</p><p class="sda-card__value">${trip.distance_km.toFixed(1)} km</p></div>
      <div class="sda-card"><p class="sda-card__label">Süre</p><p class="sda-card__value">${formatDuration(trip.duration_s)}</p></div>
      <div class="sda-card"><p class="sda-card__label">Ort. Hız</p><p class="sda-card__value">${trip.avg_speed_kmh.toFixed(0)} km/h</p></div>
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
    const blob = generateTripPdfReport(trip);
    await saveAndShareReport(blob, `yolculuk-${trip.id}.pdf`);
  });

  container.querySelector('[data-export="excel"]')?.addEventListener('click', async () => {
    const blob = generateTripExcelReport(trip, points);
    await saveAndShareReport(blob, `yolculuk-${trip.id}.xlsx`);
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
