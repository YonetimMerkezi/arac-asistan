/**
 * fuel-chart.js
 * ---------------------------------------------------------------------------
 * Yakıt alımlarının litre fiyatı geçmişini çizen Chart.js sarmalayıcısı.
 * trip-chart.js ile aynı desende (destroy-on-redraw) yazıldı.
 * ---------------------------------------------------------------------------
 */

import { Chart } from 'chart.js/auto';

/** @type {Map<HTMLCanvasElement, Chart>} */
const activeCharts = new Map();

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('../data/fuel-repository.js').FuelPurchase[]} purchases - en yeniden en eskiye sıralı.
 */
export function renderFuelPriceChart(canvas, purchases) {
  const existing = activeCharts.get(canvas);
  if (existing) {
    existing.destroy();
    activeCharts.delete(canvas);
  }
  if (purchases.length === 0) return;

  const ordered = [...purchases].reverse(); // en eskiden en yeniye
  const labels = ordered.map((p) => new Date(p.purchased_at).toLocaleDateString('tr-TR'));
  const prices = ordered.map((p) => p.price_per_liter ?? p.amount / p.liters);

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Litre Fiyatı (₺)',
        data: prices,
        borderColor: '#4FD8E0',
        backgroundColor: 'rgba(79, 216, 224, 0.15)',
        fill: true,
        tension: 0.2,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false } },
    },
  });

  activeCharts.set(canvas, chart);
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function destroyFuelChart(canvas) {
  const chart = activeCharts.get(canvas);
  if (chart) {
    chart.destroy();
    activeCharts.delete(canvas);
  }
}
