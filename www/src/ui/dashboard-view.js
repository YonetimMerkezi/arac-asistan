/**
 * dashboard-view.js
 * ---------------------------------------------------------------------------
 * Ana ekran (Panel) görünümü - TAMAMEN KULLANICI ÖZELLEŞTİRİLEBİLİR.
 *
 * Sorumlulukları:
 *  - Kullanıcının seçtiği widget'ları (dashboard-config-store.js), seçtiği
 *    sırada ve renkte çizmek
 *  - "Düzenle" modunda: widget-registry.js'teki TÜM olası veri kaynaklarını
 *    listeleyip ekle/çıkar/sırala/renklendir arayüzü sunmak
 *  - Bluetooth bağlıyken görünür widget'ların PID'lerini sırayla (ELM327
 *    yarı çift yönlü olduğu için paralel değil, ardışık) sorgulayıp
 *    güncellemek
 *  - Aracın desteklemediği PID'lerin widget'larını otomatik gizlemek
 *
 * Veri kaynağı KATALOĞU: obd/widget-registry.js (neler mevcut).
 * Kullanıcı SEÇİMİ: core/dashboard-config-store.js (kullanıcı ne seçti).
 * Bu dosya yalnızca ikisini birleştirip ÇİZER - Single Responsibility.
 * ---------------------------------------------------------------------------
 */

import '../ui/components/gauge.js';
import { openModal } from './components/modal.js';
import { iconMarkup } from './icons.js';
import { queryPid } from '../obd/elm327.js';
import { WIDGET_REGISTRY, getWidgetDefinition } from '../obd/widget-registry.js';
import { getState as getBluetoothState, onStateChange } from '../bluetooth/bluetooth-manager.js';
import { getVehicleInfo, onVehicleInfoChange } from '../core/vehicle-info-store.js';
import { setLivePidValue } from '../core/vehicle-live-data-store.js';
import { getUnits, onUnitsChange } from '../core/units-store.js';
import { formatDistanceOrSpeed, formatTemperature } from '../core/unit-conversion.js';
import {
  getDashboardConfig,
  setDashboardWidgets,
  setWidgetColor,
  setWidgetStyle,
  onDashboardConfigChange,
} from '../core/dashboard-config-store.js';
import { logWarn } from '../core/logger.js';

/** @type {number} PID döngüsü tamamlandıktan sonraki bekleme (ms). Çok sık sorgu ELM327'yi tıkar. */
const POLL_INTERVAL_MS = 300;

/** @type {number[]} Renk seçici için sunulan ön ayar tonlar (0-360). */
const COLOR_PRESETS = [28, 4, 48, 142, 199, 291, 335, 0];

/** @type {{value: 'arc'|'needle'|'digital'|'bar', label: string}[]} Seçilebilir gösterge tipleri - bkz. ui/components/gauge.js. */
const GAUGE_STYLE_OPTIONS = [
  { value: 'arc', label: 'Yay (Modern)' },
  { value: 'needle', label: 'Kadran (İbreli)' },
  { value: 'digital', label: 'Dijital Gösterge' },
  { value: 'bar', label: 'Bar Göstergesi' },
];

/** @type {boolean} Poll döngüsünün aktif olup olmadığı (bağlantı koptuğunda durdurulur). */
let pollingActive = false;

/** @type {boolean} Şu an "Düzenle" modunda mıyız. */
let editMode = false;

/** @type {HTMLElement|null} */
let viewContainer = null;

/** @type {string[]} En son bilinen desteklenen PID listesi (görünürlük hesabı için). */
let lastSupportedPids = [];

/**
 * Panel görünümünü başlatır. app-init.js tarafından bir kez çağrılır.
 */
export function initDashboardView() {
  viewContainer = document.querySelector('[data-view="dashboard"]');
  if (!viewContainer) {
    logWarn('dashboard-view', 'Dashboard konteyneri bulunamadı');
    return;
  }

  render();

  onVehicleInfoChange((info) => {
    lastSupportedPids = info.supportedPids;
    if (!editMode) applySupportedPidVisibility();
  });

  onUnitsChange(() => { if (!editMode) render(); });
  onDashboardConfigChange(() => { if (!editMode) render(); });

  onStateChange((btState) => {
    if (btState.status === 'connected' && !pollingActive) {
      startPolling();
    } else if (btState.status !== 'connected') {
      pollingActive = false;
    }
  });

  if (getBluetoothState().status === 'connected') {
    startPolling();
  }
}

/**
 * Görünüm modunu (normal <-> düzenle) günceller ve yeniden çizer.
 */
function render() {
  if (!viewContainer) return;
  viewContainer.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
      <button type="button" data-toggle-edit class="sda-btn sda-btn--ghost">
        ${editMode ? iconMarkup('done', { size: 18 }) + '<span>Bitti</span>' : iconMarkup('edit', { size: 18 }) + '<span>Düzenle</span>'}
      </button>
    </div>
    <div data-content></div>
  `;

  viewContainer.querySelector('[data-toggle-edit]')?.addEventListener('click', () => {
    editMode = !editMode;
    render();
  });

  const content = viewContainer.querySelector('[data-content]');
  if (editMode) {
    renderEditMode(content);
  } else {
    renderNormalMode(content);
    applySupportedPidVisibility();
  }
}

/**
 * Normal modu çizer: kullanıcının seçtiği widget'ları sırayla, kendi
 * renkleriyle gösterir.
 * @param {HTMLElement} content
 */
function renderNormalMode(content) {
  const config = getDashboardConfig();

  if (config.widgets.length === 0) {
    content.innerHTML = `
      <div class="sda-empty-state">
        <p class="sda-empty-state__title">Panel boş</p>
        <p>Sağ üstteki "Düzenle" ile göstermek istediğin verileri seç.</p>
      </div>
    `;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'sda-grid';

  config.widgets.forEach((instance, index) => {
    const def = getWidgetDefinition(instance.pid);
    if (!def) return; // Kayıt dışı kalmış bir PID varsa sessizce atla.

    const card = document.createElement('div');
    card.className = 'sda-card sda-card--elevated';
    card.setAttribute('data-pid-card', def.pid);
    const isPrimary = index === 0;
    if (isPrimary) card.style.gridColumn = '1 / -1';

    const gauge = document.createElement('sda-gauge');
    const minDisplay = convertForDisplay(def, def.min);
    const maxDisplay = convertForDisplay(def, def.max);
    gauge.setAttribute('label', def.label);
    gauge.setAttribute('unit', minDisplay.unit);
    gauge.setAttribute('min', String(minDisplay.value));
    gauge.setAttribute('max', String(maxDisplay.value));
    gauge.setAttribute('size', isPrimary ? 'lg' : 'sm');
    gauge.setAttribute('variant', instance.gaugeStyle ?? 'arc');
    gauge.setAttribute('value', String(minDisplay.value));
    if (def.dangerAbove !== undefined) {
      gauge.setAttribute('danger-above', String(convertForDisplay(def, def.dangerAbove).value));
    }
    if (instance.colorHue !== null && instance.colorHue !== undefined) {
      gauge.setAttribute('color-hue', String(instance.colorHue));
    }

    card.appendChild(gauge);
    grid.appendChild(card);
  });

  content.innerHTML = '';
  content.appendChild(grid);
}

/**
 * Düzenle modunu çizer: kayıttaki TÜM widget'lar, ekle/çıkar + sıra + renk
 * kontrolleriyle.
 * @param {HTMLElement} content
 */
function renderEditMode(content) {
  const config = getDashboardConfig();
  const selectedPids = config.widgets.map((w) => w.pid);

  content.innerHTML = `
    <p class="sda-card__label" style="margin-bottom:12px;">
      Göstermek istediğin verileri seç, sırala, renklendir.
    </p>
    <div data-widget-list></div>
  `;

  const list = content.querySelector('[data-widget-list]');

  // Önce seçili olanlar (sırayla), sonra seçili olmayanlar.
  const ordered = [
    ...config.widgets.map((w) => WIDGET_REGISTRY.find((r) => r.pid === w.pid)).filter(Boolean),
    ...WIDGET_REGISTRY.filter((r) => !selectedPids.includes(r.pid)),
  ];

  list.innerHTML = ordered.map((def, i) => {
    const instance = config.widgets.find((w) => w.pid === def.pid);
    const isSelected = Boolean(instance);
    const colorHue = instance?.colorHue ?? def.defaultColorHue;
    const selectedIndex = config.widgets.findIndex((w) => w.pid === def.pid);

    return `
      <div class="sda-card sda-widget-card" style="margin-bottom:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" data-widget-toggle="${def.pid}" ${isSelected ? 'checked' : ''}>
            <span>${def.label}</span>
          </label>
          ${isSelected ? `
            <div style="display:flex; gap:4px;">
              <button type="button" data-move-up="${def.pid}" ${selectedIndex === 0 ? 'disabled' : ''}>${iconMarkup('arrow-up', { size: 16 })}</button>
              <button type="button" data-move-down="${def.pid}" ${selectedIndex === config.widgets.length - 1 ? 'disabled' : ''}>${iconMarkup('arrow-down', { size: 16 })}</button>
            </div>
          ` : ''}
        </div>
        ${isSelected ? `
          <div class="sda-widget-card__controls">
            ${COLOR_PRESETS.map((hue) => `
              <button type="button" data-set-color="${def.pid}" data-hue="${hue}" aria-label="Renk">
                <span class="sda-color-swatch" style="background:hsl(${hue} 90% 60%);" aria-current="${hue === colorHue}"></span>
              </button>
            `).join('')}
          </div>
          <button type="button" data-open-style-picker="${def.pid}" class="sda-btn sda-btn--ghost" style="margin-top:6px; padding:4px 0; font-size:0.75rem;">
            ${iconMarkup('palette', { size: 16 })} Gösterge Tipi: ${gaugeStyleLabel(instance.gaugeStyle)}
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  bindEditModeEvents(list);
}

/**
 * @param {HTMLElement} list
 */
function bindEditModeEvents(list) {
  list.querySelectorAll('[data-widget-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const pid = checkbox.getAttribute('data-widget-toggle');
      const config = getDashboardConfig();

      const nextWidgets = checkbox.checked
        ? [...config.widgets, { pid, colorHue: null, gaugeStyle: null }]
        : config.widgets.filter((w) => w.pid !== pid);

      await setDashboardWidgets(nextWidgets);
      renderEditMode(list.parentElement);
    });
  });

  list.querySelectorAll('[data-move-up]').forEach((button) => {
    button.addEventListener('click', async () => {
      await moveWidget(button.getAttribute('data-move-up'), -1);
      renderEditMode(list.parentElement);
    });
  });

  list.querySelectorAll('[data-move-down]').forEach((button) => {
    button.addEventListener('click', async () => {
      await moveWidget(button.getAttribute('data-move-down'), 1);
      renderEditMode(list.parentElement);
    });
  });

  list.querySelectorAll('[data-set-color]').forEach((button) => {
    button.addEventListener('click', async () => {
      const pid = button.getAttribute('data-set-color');
      const hue = Number(button.getAttribute('data-hue'));
      await setWidgetColor(pid, hue);
      renderEditMode(list.parentElement);
    });
  });

  list.querySelectorAll('[data-open-style-picker]').forEach((button) => {
    button.addEventListener('click', () => {
      const pid = button.getAttribute('data-open-style-picker');
      const config = getDashboardConfig();
      const instance = config.widgets.find((w) => w.pid === pid);
      openGaugeStylePicker(pid, instance?.gaugeStyle ?? 'arc', async (style) => {
        await setWidgetStyle(pid, style);
        renderEditMode(list.parentElement);
      });
    });
  });
}

/**
 * @param {'arc'|'needle'|'digital'|'bar'|null|undefined} style
 * @returns {string}
 */
function gaugeStyleLabel(style) {
  return GAUGE_STYLE_OPTIONS.find((o) => o.value === (style ?? 'arc'))?.label ?? 'Yay (Modern)';
}

/**
 * "Gösterge tipi seçiniz" alt sayfasını açar - her seçenek küçük, CANLI bir
 * <sda-gauge> önizlemesiyle (örnek %65 dolulukta) listelenir, tıklanan
 * seçenek hemen kaydedilir ve alt sayfa kapanır.
 * @param {string} pid
 * @param {'arc'|'needle'|'digital'|'bar'} currentStyle
 * @param {(style: 'arc'|'needle'|'digital'|'bar') => void} onSelect
 */
function openGaugeStylePicker(pid, currentStyle, onSelect) {
  const bodyHtml = `
    <div data-style-list style="display:flex; flex-direction:column; gap:8px;"></div>
  `;

  openModal({ title: 'Gösterge Tipi Seçiniz', bodyHtml, onMount: (body) => {
    const list = body.querySelector('[data-style-list]');
    if (!list) return;

    list.innerHTML = GAUGE_STYLE_OPTIONS.map((option) => `
      <button type="button" data-style-option="${option.value}" class="sda-card"
        style="display:flex; align-items:center; gap:12px; width:100%; text-align:left; border:none;
               ${option.value === currentStyle ? 'outline:2px solid var(--sda-accent);' : ''}">
        <span style="width:64px; height:64px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:var(--sda-bg-elevated); border-radius:var(--sda-radius-sm);">
          <sda-gauge value="65" min="0" max="100" size="sm" variant="${option.value}"></sda-gauge>
        </span>
        <span class="sda-card__value" style="font-size:0.95rem;">${option.label}</span>
      </button>
    `).join('');

    list.querySelectorAll('[data-style-option]').forEach((row) => {
      row.addEventListener('click', () => {
        onSelect(row.getAttribute('data-style-option'));
      });
    });
  } });
}

/**
 * Bir widget'ı seçili listede bir konum yukarı/aşağı taşır.
 * @param {string} pid
 * @param {1|-1} direction
 * @returns {Promise<void>}
 */
async function moveWidget(pid, direction) {
  const config = getDashboardConfig();
  const index = config.widgets.findIndex((w) => w.pid === pid);
  const targetIndex = index + direction;
  if (index === -1 || targetIndex < 0 || targetIndex >= config.widgets.length) return;

  const widgets = [...config.widgets];
  [widgets[index], widgets[targetIndex]] = [widgets[targetIndex], widgets[index]];
  await setDashboardWidgets(widgets);
}

/**
 * Aracın desteklemediği PID'lere ait kartları gizler. Boş liste (henüz
 * keşif yapılmadıysa) durumunda hiçbir kart gizlenmez.
 */
function applySupportedPidVisibility() {
  if (!viewContainer || lastSupportedPids.length === 0) return;

  viewContainer.querySelectorAll('[data-pid-card]').forEach((card) => {
    const pid = card.getAttribute('data-pid-card');
    card.hidden = !lastSupportedPids.includes(pid);
  });
}

/**
 * Sürekli poll döngüsünü başlatır. ELM327 yarı çift yönlü olduğundan
 * PID'ler PARALEL değil, ardışık (sıralı await) sorgulanır. Her turda
 * güncel widget listesi tekrar okunur - kullanıcı düzenleme yaparken
 * döngü otomatik uyum sağlar.
 */
async function startPolling() {
  pollingActive = true;

  while (pollingActive) {
    const config = getDashboardConfig();

    for (const instance of config.widgets) {
      if (!pollingActive || editMode) break;
      const def = getWidgetDefinition(instance.pid);
      if (!def) continue;

      try {
        const result = await queryPid(def.pid);
        if (result) {
          setLivePidValue(def.pid, result.value, result.unit);
          const gauge = viewContainer?.querySelector(`[data-pid-card="${def.pid}"] sda-gauge`);
          const display = convertForDisplay(def, result.value);
          gauge?.setAttribute('value', String(display.value));
        }
      } catch (error) {
        // Tek bir PID zaman aşımına uğrarsa döngünün tamamı durmamalı.
        logWarn('dashboard-view', `PID okunamadı: ${def.pid}`, error);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Ham metrik bir değeri kullanıcının Ayarlar ekranından seçtiği birim
 * tercihine göre görüntülenecek değere çevirir.
 * @param {import('../obd/widget-registry.js').WidgetDefinition} def
 * @param {number} rawValue
 * @returns {{value: number, unit: string}}
 */
function convertForDisplay(def, rawValue) {
  const units = getUnits();
  if (def.unitKind === 'speed') return formatDistanceOrSpeed(rawValue, units.distance, def.unit);
  if (def.unitKind === 'temp') return formatTemperature(rawValue, units.temperature);
  return { value: rawValue, unit: def.unit };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
