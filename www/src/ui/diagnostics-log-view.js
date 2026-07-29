/**
 * diagnostics-log-view.js
 * ---------------------------------------------------------------------------
 * Cihaz üzerinde canlı günlük (log) görüntüleyici.
 *
 * NEDEN GEREKLİ: Bu proje yalnızca telefondan geliştiriliyor - masaüstü
 * `chrome://inspect` konsoluna erişim yok. core/logger.js zaten TÜM
 * info/warn/error kayıtlarını bir halka tamponda tutuyordu ama bunu
 * görüntüleyecek bir ekran yoktu - Bluetooth/ELM327 gibi sorunları teşhis
 * etmek için kullanıcı yalnızca ekran görüntüsü paylaşabiliyordu (ör. bir
 * bağlantı sorununun ARDINDAN gerçek hatayı görmek imkansızdı). Bu dosya
 * logger.js'in halihazırda topladığı veriyi bir alt sayfada (bkz.
 * ui/components/modal.js) gösterir - yeni bir veri toplama mekanizması
 * DEĞİL, var olan veriye bir pencere.
 * ---------------------------------------------------------------------------
 */

import { getLogs, subscribeToLogs, clearLogs } from '../core/logger.js';
import { openModal } from './components/modal.js';

/** @type {Record<import('../core/logger.js').LogLevel, string>} Seviyeye göre metin rengi. */
const LEVEL_COLORS = {
  debug: 'var(--sda-text-faint)',
  info: 'var(--sda-text-muted)',
  warn: 'var(--sda-warning)',
  error: 'var(--sda-danger)',
};

/**
 * Günlük görüntüleyici alt sayfasını açar. Açıkken gelen YENİ kayıtlar
 * da canlı olarak listenin en üstüne eklenir (ör. modal açıkken bağlantı
 * denemesi devam ediyorsa).
 */
export function openDiagnosticsLogModal() {
  const bodyHtml = `
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <button type="button" data-log-copy class="sda-btn sda-btn--secondary" style="flex:1;">Kopyala</button>
      <button type="button" data-log-clear class="sda-btn sda-btn--danger" style="flex:1;">Temizle</button>
    </div>
    <div data-log-list style="display:flex; flex-direction:column-reverse; gap:6px; font-family:var(--sda-font-display); font-size:0.7rem;"></div>
  `;

  const { root } = openModal({ title: 'Bağlantı Günlüğü', bodyHtml, onMount: (body) => {
    const listEl = body.querySelector('[data-log-list]');
    renderEntries(listEl, getLogs());

    const unsubscribe = subscribeToLogs((entry) => {
      appendEntry(listEl, entry);
    });
    // Modal kapanınca dinleyiciyi bırak - bellek sızıntısı önleme.
    root.addEventListener('sda-modal-closed', unsubscribe, { once: true });

    body.querySelector('[data-log-copy]')?.addEventListener('click', async () => {
      const text = getLogs().map(formatEntryAsText).join('\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Web Clipboard API bazı WebView sürümlerinde kullanıcı jestine
        // rağmen başarısız olabilir - sessizce yok say, kullanıcı yine de
        // metni ekranda görüp elle seçebilir.
      }
    });

    body.querySelector('[data-log-clear]')?.addEventListener('click', () => {
      clearLogs();
      renderEntries(listEl, []);
    });
  } });
}

/**
 * @param {HTMLElement|null} listEl
 * @param {import('../core/logger.js').LogEntry[]} entries
 */
function renderEntries(listEl, entries) {
  if (!listEl) return;
  listEl.innerHTML = entries.map(formatEntryAsHtml).join('') || '<p class="sda-card__label">Kayıt yok.</p>';
}

/**
 * @param {HTMLElement|null} listEl
 * @param {import('../core/logger.js').LogEntry} entry
 */
function appendEntry(listEl, entry) {
  if (!listEl) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = formatEntryAsHtml(entry);
  listEl.appendChild(wrapper.firstElementChild);
}

/**
 * @param {import('../core/logger.js').LogEntry} entry
 * @returns {string}
 */
function formatEntryAsHtml(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('tr-TR');
  const metaText = entry.meta ? escapeHtml(JSON.stringify(entry.meta)) : '';
  return `
    <div style="color:${LEVEL_COLORS[entry.level]}; white-space:pre-wrap; word-break:break-word; border-bottom:1px solid var(--sda-hairline); padding-bottom:6px;">
      <strong>${time} [${entry.scope}]</strong> ${escapeHtml(entry.message)}
      ${metaText ? `<div style="opacity:0.75; font-size:0.65rem;">${metaText}</div>` : ''}
    </div>
  `;
}

/**
 * @param {import('../core/logger.js').LogEntry} entry
 * @returns {string}
 */
function formatEntryAsText(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('tr-TR');
  const metaText = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
  return `${time} [${entry.level}] [${entry.scope}] ${entry.message}${metaText}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
