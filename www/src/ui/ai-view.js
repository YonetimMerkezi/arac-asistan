/**
 * ai-view.js
 * ---------------------------------------------------------------------------
 * "Analiz" ekranı: haftalık özet rapor, sürüş puanı, bakım tahminleri.
 * ---------------------------------------------------------------------------
 */

import { buildWeeklyReport } from '../ai/weekly-report.js';
import { predictMaintenance } from '../ai/maintenance-predictor.js';
import { logWarn } from '../core/logger.js';

export function initAiView() {
  const container = document.querySelector('[data-view="ai"]');
  if (!container) {
    logWarn('ai-view', 'Analiz konteyneri bulunamadı');
    return;
  }
  render(container);
}

async function render(container) {
  container.innerHTML = '<p class="sda-card__label">Yükleniyor...</p>';

  const [report, predictions] = await Promise.all([
    buildWeeklyReport(),
    predictMaintenance(),
  ]);

  container.innerHTML = `
    <h3 style="margin:4px 0;">Son 7 Gün</h3>
    <div class="sda-grid" style="margin-bottom:20px;">
      <div class="sda-card">
        <p class="sda-card__label">Yolculuk</p>
        <p class="sda-card__value">${report.tripCount}</p>
      </div>
      <div class="sda-card">
        <p class="sda-card__label">Mesafe</p>
        <p class="sda-card__value">${report.totalDistanceKm.toFixed(1)} km</p>
      </div>
      <div class="sda-card">
        <p class="sda-card__label">Ort. Tüketim</p>
        <p class="sda-card__value">${report.litersPer100Km !== null ? report.litersPer100Km.toFixed(1) + ' L' : '—'}</p>
      </div>
      <div class="sda-card">
        <p class="sda-card__label">Sürüş Puanı</p>
        <p class="sda-card__value">${report.averageScore !== null ? report.averageScore : '—'}</p>
      </div>
    </div>
    <h3 style="margin:4px 0;">Bakım Tahminleri</h3>
    <div data-predictions></div>
  `;

  const predictionsEl = container.querySelector('[data-predictions]');
  if (!predictionsEl) return;

  if (predictions.length === 0) {
    predictionsEl.innerHTML = '<p class="sda-card__label">Tanımlı bakım kalemi yok.</p>';
    return;
  }

  predictionsEl.innerHTML = predictions.map((p) => `
    <div class="sda-card" style="margin-bottom:8px;">
      <p class="sda-card__label">${p.item.label}</p>
      <p class="sda-card__value" style="font-size:1rem;">
        ${p.kmRemaining !== null ? `~${Math.round(p.kmRemaining)} km kaldı` : 'Tahmini km sayacı bekleniyor'}
        ${p.estimatedDaysRemaining !== null ? ` · ~${p.estimatedDaysRemaining} gün` : ' · tahmin için yetersiz veri'}
      </p>
    </div>
  `).join('');
}
