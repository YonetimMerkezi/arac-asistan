/**
 * diagnostics-view.js
 * ---------------------------------------------------------------------------
 * Arıza Merkezi ekranı: kodları oku, Türkçe açıklama + genel kontrol önerisi
 * göster, gerekirse internette ara, kodları sil (onaylı), geçmişi listele,
 * PDF olarak dışa aktar.
 * ---------------------------------------------------------------------------
 */

import { readDtcCodes, clearDtcCodes } from '../obd/elm327.js';
import { getState as getBluetoothState } from '../bluetooth/bluetooth-manager.js';
import { recordDtcReading, listDtcHistory } from '../data/dtc-repository.js';
import { getDtcDescription } from '../diagnostics/dtc-descriptions.js';
import { generateDtcPdfReport } from '../diagnostics/dtc-report-pdf.js';
import { openAllSensorsModal } from './components/all-sensors-modal.js';
import { saveAndShareReport } from '../trip/file-export.js';
import { Browser } from '@capacitor/browser';
import { logWarn } from '../core/logger.js';

/** @type {string[]} Ekranda gösterilen en son okunan kodlar. */
let currentCodes = [];

/** @type {number} En son okumanın zamanı. */
let currentReadAt = Date.now();

/**
 * Arıza Merkezi görünümünü başlatır.
 */
export function initDiagnosticsView() {
  const container = document.querySelector('[data-view="diagnostics"]');
  if (!container) {
    logWarn('diagnostics-view', 'Arıza Merkezi konteyneri bulunamadı');
    return;
  }

  render(container);
}

/**
 * @param {HTMLElement} container
 */
function render(container) {
  container.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button type="button" data-action="read" class="sda-nav-btn" style="background:var(--sda-accent-soft); flex:1;">Kodları Oku</button>
      <button type="button" data-action="clear" class="sda-nav-btn" style="background:var(--sda-danger-soft); flex:1;">Kodları Sil</button>
    </div>
    <button type="button" data-action="all-sensors" class="sda-btn sda-btn--secondary" style="width:100%; margin-bottom:16px;">Tüm Sensörler</button>
    <div data-codes-list></div>
    <h3 style="margin:16px 0 4px;">Geçmiş</h3>
    <div data-history-list></div>
  `;

  container.querySelector('[data-action="read"]')?.addEventListener('click', () => handleRead(container));
  container.querySelector('[data-action="clear"]')?.addEventListener('click', () => handleClear(container));
  container.querySelector('[data-action="all-sensors"]')?.addEventListener('click', () => openAllSensorsModal());

  renderCodesList(container);
  void renderHistory(container);
}

/**
 * @param {HTMLElement} container
 */
async function handleRead(container) {
  const listEl = container.querySelector('[data-codes-list]');
  if (getBluetoothState().status !== 'connected') {
    if (listEl) listEl.innerHTML = '<p class="sda-card__label">Araca bağlı değilsiniz.</p>';
    return;
  }

  if (listEl) listEl.innerHTML = '<p class="sda-card__label">Okunuyor...</p>';

  const codes = await readDtcCodes();
  currentCodes = codes;
  currentReadAt = Date.now();

  await recordDtcReading(codes);
  renderCodesList(container);
  await renderHistory(container);
}

/**
 * @param {HTMLElement} container
 */
async function handleClear(container) {
  if (getBluetoothState().status !== 'connected') return;

  const confirmed = window.confirm(
    'Arıza kodları silinecek. Bu işlem arıza lambasını söndürür ama altta yatan sorunu ÇÖZMEZ. Emin misiniz?',
  );
  if (!confirmed) return;

  const success = await clearDtcCodes();
  const listEl = container.querySelector('[data-codes-list]');
  if (listEl) {
    listEl.innerHTML = success
      ? '<p class="sda-card__label">Kodlar silindi.</p>'
      : '<p class="sda-card__label">Silme işlemi onaylanamadı.</p>';
  }
  if (success) {
    currentCodes = [];
  }
}

/**
 * @param {HTMLElement} container
 */
function renderCodesList(container) {
  const listEl = container.querySelector('[data-codes-list]');
  if (!listEl) return;

  if (currentCodes.length === 0) {
    listEl.innerHTML = '<p class="sda-card__label">Kod okunmadı veya araçta kayıtlı arıza yok.</p>';
    return;
  }

  listEl.innerHTML = currentCodes.map((code) => {
    const desc = getDtcDescription(code);
    return `
      <div class="sda-card sda-card--elevated" style="margin-bottom:8px; border-left: 3px solid var(--sda-danger);">
        <p class="sda-card__value" style="font-family: var(--sda-font-display); font-size:1.1rem;">${code}</p>
        <p style="font-weight:600; margin:4px 0;">${desc.title}</p>
        <p style="color:var(--sda-text-muted); font-size:0.9rem;">${desc.detail}</p>
        <p style="font-size:0.85rem; margin-top:6px;"><strong>Kontrol önerisi:</strong> ${desc.checkSuggestion}</p>
        <button type="button" data-search="${code}" style="background:none;border:none;color:var(--sda-accent);padding:0;margin-top:6px;font-size:0.85rem;">İnternette ara →</button>
      </div>
    `;
  }).join('') + `
    <button type="button" data-export-pdf class="sda-nav-btn" style="background:var(--sda-accent-2-soft); width:100%; margin-top:8px;">PDF Olarak Dışa Aktar</button>
  `;

  listEl.querySelectorAll('[data-search]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = button.getAttribute('data-search');
      void Browser.open({ url: `https://www.google.com/search?q=${encodeURIComponent(code + ' OBD arıza kodu anlamı')}` });
    });
  });

  listEl.querySelector('[data-export-pdf]')?.addEventListener('click', async () => {
    const blob = generateDtcPdfReport(currentCodes, currentReadAt);
    await saveAndShareReport(blob, `ariza-kodlari-${currentReadAt}.pdf`);
  });
}

/**
 * @param {HTMLElement} container
 */
async function renderHistory(container) {
  const historyEl = container.querySelector('[data-history-list]');
  if (!historyEl) return;

  const history = await listDtcHistory();
  if (history.length === 0) {
    historyEl.innerHTML = '<p class="sda-card__label">Geçmiş kayıt yok.</p>';
    return;
  }

  historyEl.innerHTML = history.map((entry) => `
    <div class="sda-card" style="margin-bottom:6px;">
      <p class="sda-card__label">${new Date(entry.read_at).toLocaleString('tr-TR')}</p>
      <p class="sda-card__value" style="font-size:0.95rem;">${entry.codes.length > 0 ? entry.codes.join(', ') : 'Kod yok'}</p>
    </div>
  `).join('');
}
