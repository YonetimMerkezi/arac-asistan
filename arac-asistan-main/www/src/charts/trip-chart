/**
 * trip-chart.js
 * ---------------------------------------------------------------------------
 * Chart.js sarmalayıcısı: bir yolculuğun GPS noktalarından hız-zaman
 * grafiği çizer. Hem geçmiş yolculuk detayında hem (ileride) canlı grafik
 * ekranında aynı fonksiyon kullanılabilir - kod tekrarını önler.
 * ---------------------------------------------------------------------------
 */

import { Chart } from 'chart.js/auto';
import { logInfo } from '../core/logger.js';

/** @type {Map<HTMLCanvasElement, Chart>} Aynı canvas'a tekrar çizerken önceki grafiği yok etmek için. */
const activeCharts = new Map();

/**
 * Bir canvas elemanına yolculuk hız grafiğini çizer. Aynı canvas'ta zaten
 * bir grafik varsa önce yok edilir (bellek sızıntısı önleme).
 * @param {HTMLCanvasElement} canvas
 * @param {import('../data/trip-repository.js').TripPoint[]} points
 */
export function renderTripSpeedChart(canvas, points) {
  const existing = activeCharts.get(canvas);
  if (existing) {
    existing.destroy();
    activeCharts.delete(canvas);
  }

  if (points.length === 0) return;

  const startTime = points[0].recorded_at;
  const labels = points.map((p) => Math.round((p.recorded_at - startTime) / 1000)); // saniye
  const speedData = points.map((p) => p.speed_kmh ?? 0);

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Hız (km/h)',
        data: speedData,
        borderColor: '#FF8A3D',
        backgroundColor: 'rgba(255, 138, 61, 0.15)',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Saniye' } },
        y: { title: { display: true, text: 'km/h' }, beginAtZero: true },
      },
      plugins: { legend: { display: false } },
    },
  });

  activeCharts.set(canvas, chart);
  logInfo('trip-chart', `Grafik çizildi: ${points.length} nokta`);
}

/**
 * Bir canvas'a ait grafiği yok eder (görünüm değişirken bellek sızıntısı önleme).
 * @param {HTMLCanvasElement} canvas
 */
export function destroyTripChart(canvas) {
  const chart = activeCharts.get(canvas);
  if (chart) {
    chart.destroy();
    activeCharts.delete(canvas);
  }
}
