/**
 * dashboard-edit-panel.js
 * ---------------------------------------------------------------------------
 * Panel'in "Düzenle" modu: widget seç/çıkar, sırala, renklendir, gösterge
 * tipini değiştir.
 *
 * dashboard-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya başına
 * maks. 500 satır) - o dosya yalnızca NORMAL (canlı veri) modunu ve poll
 * döngüsünü yönetir, bu dosya yalnızca DÜZENLEME arayüzünü.
 * ---------------------------------------------------------------------------
 */

import '../ui/components/gauge.js';
import { iconMarkup } from './icons.js';
import { openModal } from './components/modal.js';
import { WIDGET_REGISTRY } from '../obd/widget-registry.js';
import {
  getDashboardConfig,
  setDashboardWidgets,
  setWidgetColor,
  setWidgetStyle,
} from '../core/dashboard-config-store.js';

/** @type {number[]} Renk seçici için sunulan ön ayar tonlar (0-360). */
const COLOR_PRESETS = [28, 4, 48, 142, 199, 291, 335, 0];

/** @type {{value: 'arc'|'needle'|'digital'|'bar', label: string}[]} Seçilebilir gösterge tipleri - bkz. ui/components/gauge.js. */
const GAUGE_STYLE_OPTIONS = [
  { value: 'arc', label: 'Yay (Modern)' },
  { value: 'needle', label: 'Kadran (İbreli)' },
  { value: 'digital', label: 'Dijital Gösterge' },
  { value: 'bar', label: 'Bar Göstergesi' },
];

/** @type {(() => HTMLElement|null|undefined)|null} Canlı içerik konteynerini HER ZAMAN taze alan getter - refreshEditModePanel() bunu kullanır. */
let contentGetter = null;

/**
 * Düzenle modunu çizer: kayıttaki TÜM widget'lar, ekle/çıkar + sıra + renk +
 * gösterge tipi kontrolleriyle.
 * @param {HTMLElement} content
 * @param {() => HTMLElement|null|undefined} getContent - dashboard-view.js'in
 *   `viewContainer.querySelector('[data-content]')` çağrısını HER SEFERİNDE
 *   taze yapan getter'ı - stale (kopmuş) DOM referansı hatasını önlemek için.
 */
export function renderEditModePanel(content, getContent) {
  contentGetter = getContent;
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

  list.innerHTML = ordered.map((def) => {
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
      refreshEditModePanel();
    });
  });

  list.querySelectorAll('[data-move-up]').forEach((button) => {
    button.addEventListener('click', async () => {
      await moveWidget(button.getAttribute('data-move-up'), -1);
      refreshEditModePanel();
    });
  });

  list.querySelectorAll('[data-move-down]').forEach((button) => {
    button.addEventListener('click', async () => {
      await moveWidget(button.getAttribute('data-move-down'), 1);
      refreshEditModePanel();
    });
  });

  list.querySelectorAll('[data-set-color]').forEach((button) => {
    button.addEventListener('click', async () => {
      const pid = button.getAttribute('data-set-color');
      const hue = Number(button.getAttribute('data-hue'));
      await setWidgetColor(pid, hue);
      refreshEditModePanel();
    });
  });

  list.querySelectorAll('[data-open-style-picker]').forEach((button) => {
    button.addEventListener('click', () => {
      const pid = button.getAttribute('data-open-style-picker');
      const config = getDashboardConfig();
      const instance = config.widgets.find((w) => w.pid === pid);
      openGaugeStylePicker(pid, instance?.gaugeStyle ?? 'arc', async (style) => {
        await setWidgetStyle(pid, style);
        refreshEditModePanel();
      });
    });
  });
}

/**
 * Düzenle modunu, HER ZAMAN canlı (attached) konteynerden yeniden çizer.
 *
 * DÜZELTME (kritik hata): Önceden her olay dinleyicisi kapanışta (closure)
 * SABİT bir liste elemanına referans tutuyordu - bir sonraki yeniden çizim
 * bu elemanı DOM'dan koparıyordu (parentElement → null), bu da bir modal
 * (ör. gösterge tipi seçici) açıkken tetiklenen bir geri çağırımda
 * "Cannot set properties of null (setting 'innerHTML')" hatasına yol
 * açıyordu. Çözüm: konteyneri HER SEFERİNDE dışarıdan verilen getter
 * (contentGetter) ile TAZE sorgulamak.
 */
function refreshEditModePanel() {
  const content = contentGetter?.();
  if (content) renderEditModePanel(content, contentGetter);
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
 * seçenek hemen kaydedilir ve alt sayfa KAPANIR.
 * @param {string} pid
 * @param {'arc'|'needle'|'digital'|'bar'} currentStyle
 * @param {(style: 'arc'|'needle'|'digital'|'bar') => void} onSelect
 */
function openGaugeStylePicker(pid, currentStyle, onSelect) {
  const bodyHtml = `
    <div data-style-list style="display:flex; flex-direction:column; gap:8px;"></div>
  `;

  const modal = openModal({ title: 'Gösterge Tipi Seçiniz', bodyHtml, onMount: (body) => {
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
        modal.close();
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
