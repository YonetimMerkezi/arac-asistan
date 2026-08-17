/**
 * ai-view.js
 * ---------------------------------------------------------------------------
 * Analiz ekranı: gerçek yolculuk verilerinden haftalık özet, sürüş puanı,
 * bakım tahminleri ve veri yeterliliği durumu.
 *
 * Not: Bu ekran henüz harici bir yapay zekâ servisi kullanmaz. Gösterilen
 * sonuçların tamamı uygulamanın yerel verilerinden hesaplanır.
 * ---------------------------------------------------------------------------
 */

import { buildWeeklyReport } from '../ai/weekly-report.js';
import { predictMaintenance } from '../ai/maintenance-predictor.js';
import { logWarn } from '../core/logger.js';
import { iconMarkup } from './icons.js';

export function initAiView() {
  const container = document.querySelector('[data-view="ai"]');
  if (!container) {
    logWarn('ai-view', 'Analiz konteyneri bulunamadı');
    return;
  }

  render(container);
}

async function render(container) {
  container.innerHTML = `
    <div class="sda-ai-loading">
      <span class="material-symbols-outlined">auto_awesome</span>
      <strong>Sürüş analizi hazırlanıyor</strong>
      <small>Son yolculuklarınız ve bakım verileriniz inceleniyor…</small>
    </div>
  `;

  try {
    const [report, predictions] = await Promise.all([
      buildWeeklyReport(),
      predictMaintenance(),
    ]);

    const score = report.averageScore;
    const scoreText = score !== null ? String(score) : '—';
    const scoreLabel = score === null
      ? 'Yeterli veri yok'
      : score >= 90
        ? 'Mükemmel sürüş'
        : score >= 75
          ? 'İyi sürüş'
          : score >= 60
            ? 'Geliştirilebilir'
            : 'Dikkat gerekli';

    container.innerHTML = `
      <section class="sda-ai-header">
        <div>
          <span class="sda-ai-kicker">SMART DRIVE AI</span>
          <h2>Gelişmiş Sürüş Analizi</h2>
          <p>Son 7 günün gerçek araç verileri üzerinden oluşturuldu.</p>
        </div>
        <div class="sda-ai-header-icon">${iconMarkup('analytics', { size: 26 })}</div>
      </section>

      <section class="sda-ai-score-card">
        <div class="sda-ai-score-ring">
          <strong>${scoreText}</strong>
          <span>puan</span>
        </div>
        <div class="sda-ai-score-copy">
          <span class="sda-ai-kicker">SÜRÜŞ PROFİLİ</span>
          <h3>${scoreLabel}</h3>
          <p>${report.tripCount > 0
            ? `${report.tripCount} tamamlanmış yolculuk analiz edildi.`
            : 'Henüz analiz edilecek tamamlanmış yolculuk bulunmuyor.'}</p>
        </div>
      </section>

      <section class="sda-ai-grid">
        ${metricCard('route', 'Yolculuk', report.tripCount, 'son 7 gün')}
        ${metricCard('distance', 'Mesafe', `${formatNumber(report.totalDistanceKm)} km`, 'toplam')}
        ${metricCard('fuel', 'Yakıt', `${formatNumber(report.totalFuelL)} L`, 'tahmini tüketim')}
        ${metricCard('speed', 'Ort. Tüketim', report.litersPer100Km !== null ? `${formatNumber(report.litersPer100Km)} L/100` : '—', 'gerçek kayıtlar')}
        ${metricCard('diagnostics', 'Arıza Kontrolü', report.dtcReadingsCount, 'okuma kaydı')}
      </section>

      <section class="sda-ai-section">
        <div class="sda-ai-section-title">
          <div>
            <span class="sda-ai-kicker">ÖNGÖRÜ</span>
            <h3>Bakım Takvimi</h3>
          </div>
          ${iconMarkup('temperature', { size: 22 })}
        </div>
        <div class="sda-ai-maintenance-list">
          ${renderPredictions(predictions)}
        </div>
      </section>

      <section class="sda-ai-note">
        ${iconMarkup('info', { size: 18 })}
        <div>
          <strong>Veriye dayalı sonuç</strong>
          <p>Yeterli veri bulunmadığında sistem tahmin üretmez; boş alanı tahmini bir değerle doldurmaz.</p>
        </div>
      </section>
    `;

    injectAiStyles();
  } catch (error) {
    logWarn('ai-view', 'Analiz ekranı oluşturulamadı', error);
    container.innerHTML = `
      <div class="sda-empty-state">
        <p class="sda-empty-state__title">Analiz hazırlanamadı</p>
        <p>Yerel sürüş verileri okunurken bir sorun oluştu. Lütfen tekrar deneyin.</p>
      </div>
    `;
  }
}

function metricCard(icon, label, value, caption) {
  return `
    <article class="sda-ai-metric">
      <div class="sda-ai-metric-icon">${iconMarkup(icon, { size: 20 })}</div>
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${caption}</small>
    </article>
  `;
}

function renderPredictions(predictions) {
  if (!predictions.length) {
    return `
      <div class="sda-ai-empty">
        ${iconMarkup('done', { size: 22 })}
        <div>
          <strong>Yaklaşan bakım tahmini yok</strong>
          <p>Bakım kalemi tanımlandığında burada kalan mesafe gösterilecek.</p>
        </div>
      </div>
    `;
  }

  return predictions.map((prediction) => {
    const km = prediction.kmRemaining;
    const days = prediction.estimatedDaysRemaining;
    const urgency = km !== null && km <= 1000 ? 'warning' : '';

    return `
      <article class="sda-ai-maintenance ${urgency}">
        <div class="sda-ai-maintenance-icon">${iconMarkup('service', { size: 21 })}</div>
        <div class="sda-ai-maintenance-main">
          <strong>${escapeHtml(prediction.item.label)}</strong>
          <span>${km !== null ? `${formatNumber(Math.max(0, km))} km kaldı` : 'Kilometre verisi bekleniyor'}</span>
        </div>
        <div class="sda-ai-maintenance-days">
          <strong>${days !== null ? `~${days}` : '—'}</strong>
          <span>${days !== null ? 'gün' : 'tahmin yok'}</span>
        </div>
      </article>
    `;
  }).join('');
}

function formatNumber(value) {
  return Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectAiStyles() {
  if (document.getElementById('sda-ai-view-style')) return;

  const style = document.createElement('style');
  style.id = 'sda-ai-view-style';
  style.textContent = `
    [data-view="ai"] { min-width:0; box-sizing:border-box; }
    .sda-ai-loading { min-height:260px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:var(--sda-text-muted); text-align:center; }
    .sda-ai-loading .material-symbols-outlined { font-size:38px; color:var(--sda-accent); animation:sdaAiPulse 1.5s ease-in-out infinite; }
    .sda-ai-loading strong { color:var(--sda-text-primary); }
    .sda-ai-loading small { max-width:280px; }
    @keyframes sdaAiPulse { 50% { transform:scale(1.08); opacity:.65; } }
    .sda-ai-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:4px 0 12px; }
    .sda-ai-header h2 { margin:3px 0; font-size:1.25rem; color:var(--sda-text-primary); }
    .sda-ai-header p { margin:0; font-size:.78rem; color:var(--sda-text-muted); }
    .sda-ai-kicker { font-size:.65rem; letter-spacing:.12em; font-weight:800; color:var(--sda-accent); }
    .sda-ai-header-icon { width:46px; height:46px; border-radius:15px; display:flex; align-items:center; justify-content:center; background:var(--sda-accent-soft); color:var(--sda-accent); flex:0 0 auto; }
    .sda-ai-score-card { display:flex; align-items:center; gap:16px; padding:16px; border:1px solid var(--sda-hairline); border-radius:20px; background:linear-gradient(135deg,var(--sda-bg-elevated),var(--sda-bg-surface)); box-sizing:border-box; }
    .sda-ai-score-ring { width:88px; height:88px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; flex:0 0 88px; border:5px solid var(--sda-accent); box-shadow:0 0 0 5px var(--sda-accent-soft); }
    .sda-ai-score-ring strong { font-family:var(--sda-font-display); font-size:1.75rem; line-height:1; color:var(--sda-text-primary); }
    .sda-ai-score-ring span { margin-top:3px; font-size:.62rem; color:var(--sda-text-muted); }
    .sda-ai-score-copy h3 { margin:3px 0 5px; color:var(--sda-text-primary); font-size:1rem; }
    .sda-ai-score-copy p { margin:0; color:var(--sda-text-muted); font-size:.76rem; }
    .sda-ai-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:10px 0; }
    .sda-ai-metric { min-width:0; padding:12px; border:1px solid var(--sda-hairline); border-radius:15px; background:var(--sda-bg-elevated); box-sizing:border-box; }
    .sda-ai-metric-icon { width:30px; height:30px; border-radius:10px; display:flex; align-items:center; justify-content:center; margin-bottom:7px; background:var(--sda-bg-surface); color:var(--sda-accent); }
    .sda-ai-metric span,.sda-ai-metric small { display:block; color:var(--sda-text-muted); font-size:.68rem; }
    .sda-ai-metric strong { display:block; margin:2px 0; font-family:var(--sda-font-display); font-size:1.15rem; color:var(--sda-text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sda-ai-section { margin-top:14px; }
    .sda-ai-section-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .sda-ai-section-title h3 { margin:2px 0 0; font-size:1rem; color:var(--sda-text-primary); }
    .sda-ai-section-title > .material-symbols-outlined { color:var(--sda-accent); }
    .sda-ai-maintenance-list { display:flex; flex-direction:column; gap:7px; }
    .sda-ai-maintenance { display:flex; align-items:center; gap:10px; min-width:0; padding:11px; border:1px solid var(--sda-hairline); border-radius:14px; background:var(--sda-bg-elevated); }
    .sda-ai-maintenance.warning { border-color:var(--sda-warning,#f59e0b); }
    .sda-ai-maintenance-icon { width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:0 0 auto; background:var(--sda-accent-soft); color:var(--sda-accent); }
    .sda-ai-maintenance-main { min-width:0; flex:1; }
    .sda-ai-maintenance-main strong,.sda-ai-maintenance-main span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sda-ai-maintenance-main strong { font-size:.82rem; color:var(--sda-text-primary); }
    .sda-ai-maintenance-main span { margin-top:2px; font-size:.7rem; color:var(--sda-text-muted); }
    .sda-ai-maintenance-days { text-align:right; flex:0 0 auto; }
    .sda-ai-maintenance-days strong { display:block; font-family:var(--sda-font-display); font-size:1rem; color:var(--sda-text-primary); }
    .sda-ai-maintenance-days span { font-size:.62rem; color:var(--sda-text-muted); }
    .sda-ai-empty,.sda-ai-note { display:flex; align-items:flex-start; gap:10px; padding:12px; border-radius:14px; background:var(--sda-bg-elevated); border:1px solid var(--sda-hairline); }
    .sda-ai-empty .material-symbols-outlined,.sda-ai-note .material-symbols-outlined { color:var(--sda-accent); flex:0 0 auto; }
    .sda-ai-empty strong,.sda-ai-note strong { display:block; color:var(--sda-text-primary); font-size:.8rem; }
    .sda-ai-empty p,.sda-ai-note p { margin:3px 0 0; color:var(--sda-text-muted); font-size:.7rem; line-height:1.4; }
    .sda-ai-note { margin-top:10px; margin-bottom:8px; }
    @media (min-width:600px) { .sda-ai-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
    @media (max-width:360px) { .sda-ai-score-card { gap:10px; padding:12px; } .sda-ai-score-ring { width:72px; height:72px; flex-basis:72px; } .sda-ai-score-ring strong { font-size:1.4rem; } }
  `;
  document.head.appendChild(style);
}
