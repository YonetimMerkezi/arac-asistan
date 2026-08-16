/**
 * dashboard-edit-panel.js
 * ---------------------------------------------------------------------------
 * Panel düzenleme ekranı: widget seçimi, sıralama, renk ve gösterge tipi.
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

const COLOR_PRESETS = [28, 4, 48, 142, 199, 291, 335, 0];

const GAUGE_STYLE_OPTIONS = [
  { value: 'analog-classic', label: 'Kadran (İbreli)', desc: 'Klasik otomobil göstergesi', icon: 'classic' },
  { value: 'analog-modern', label: 'Kadran (Modern)', desc: 'Modern kadran + ibre', icon: 'modern' },
  { value: 'digital-card', label: 'Dijital Kart', desc: 'Büyük dijital okuma', icon: 'digital' },
  { value: 'digital-modern', label: 'Dijital Halka', desc: 'Dijital değer + dairesel seviye', icon: 'ring' },
  { value: 'hybrid', label: 'Hibrit', desc: 'Kadran + dijital değer', icon: 'hybrid' },
  { value: 'compact', label: 'Kompakt Bar', desc: 'Küçük ve hızlı seviye takibi', icon: 'bar' },
];

const LEGACY_LABELS = {
  arc: 'Kadran (Modern)',
  needle: 'Kadran (İbreli)',
  digital: 'Dijital Kart',
  bar: 'Kompakt Bar',
};

let contentGetter = null;

export function renderEditModePanel(content, getContent) {
  contentGetter = getContent;
  const config = getDashboardConfig();
  const selectedPids = config.widgets.map((w) => w.pid);

  content.innerHTML = `
    <div class="sda-style-intro">
      <strong>Panelini özelleştir</strong>
      <span>Veriyi seç, sırasını değiştir, rengini ve gösterge tipini belirle.</span>
    </div>
    <div data-widget-list></div>
  `;

  const list = content.querySelector('[data-widget-list]');
  const ordered = [
    ...config.widgets.map((w) => WIDGET_REGISTRY.find((r) => r.pid === w.pid)).filter(Boolean),
    ...WIDGET_REGISTRY.filter((r) => !selectedPids.includes(r.pid)),
  ];

  list.innerHTML = ordered.map((def) => {
    const instance = config.widgets.find((w) => w.pid === def.pid);
    const isSelected = Boolean(instance);
    const colorHue = instance?.colorHue ?? def.defaultColorHue;
    const selectedIndex = config.widgets.findIndex((w) => w.pid === def.pid);
    const styleLabel = getGaugeStyleLabel(instance?.gaugeStyle);

    return `
      <section class="sda-widget-card ${isSelected ? 'is-selected' : ''}">
        <div class="sda-widget-head">
          <label class="sda-widget-title">
            <input type="checkbox" data-widget-toggle="${def.pid}" ${isSelected ? 'checked' : ''}>
            <span>${def.label}</span>
          </label>
          ${isSelected ? `
            <div class="sda-order-actions">
              <button type="button" data-move-up="${def.pid}" ${selectedIndex === 0 ? 'disabled' : ''} aria-label="Yukarı taşı">${iconMarkup('arrow-up', { size: 17 })}</button>
              <button type="button" data-move-down="${def.pid}" ${selectedIndex === config.widgets.length - 1 ? 'disabled' : ''} aria-label="Aşağı taşı">${iconMarkup('arrow-down', { size: 17 })}</button>
            </div>
          ` : ''}
        </div>

        ${isSelected ? `
          <div class="sda-style-current">
            <div class="sda-style-current__text">
              <span>Gösterge</span>
              <strong>${styleLabel}</strong>
            </div>
            <button type="button" data-open-style-picker="${def.pid}" class="sda-style-change">
              ${iconMarkup('palette', { size: 17 })}<span>Değiştir</span>
            </button>
          </div>
          <div class="sda-color-row">
            <span>Renk</span>
            <div class="sda-color-list">
              ${COLOR_PRESETS.map((hue) => `
                <button type="button" data-set-color="${def.pid}" data-hue="${hue}" aria-label="Renk ${hue}">
                  <span class="sda-color-swatch" style="background:hsl(${hue} 90% 60%);" aria-current="${hue === colorHue}"></span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }).join('');

  injectEditPanelStyles();
  bindEditModeEvents(list);
}

function bindEditModeEvents(list) {
  list.querySelectorAll('[data-widget-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const pid = checkbox.getAttribute('data-widget-toggle');
      const config = getDashboardConfig();
      const nextWidgets = checkbox.checked
        ? [...config.widgets, { pid, colorHue: null, gaugeStyle: 'analog-modern' }]
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
      await setWidgetColor(button.getAttribute('data-set-color'), Number(button.getAttribute('data-hue')));
      refreshEditModePanel();
    });
  });

  list.querySelectorAll('[data-open-style-picker]').forEach((button) => {
    button.addEventListener('click', () => {
      const pid = button.getAttribute('data-open-style-picker');
      const instance = getDashboardConfig().widgets.find((w) => w.pid === pid);
      openGaugeStylePicker(pid, instance?.gaugeStyle ?? 'analog-modern', async (style) => {
        await setWidgetStyle(pid, style);
        refreshEditModePanel();
      });
    });
  });
}

function refreshEditModePanel() {
  const content = contentGetter?.();
  if (content) renderEditModePanel(content, contentGetter);
}

function getGaugeStyleLabel(style) {
  return GAUGE_STYLE_OPTIONS.find((o) => o.value === style)?.label ?? LEGACY_LABELS[style] ?? 'Kadran (Modern)';
}

function openGaugeStylePicker(pid, currentStyle, onSelect) {
  const bodyHtml = `<div class="sda-style-picker" data-style-list></div>`;

  const modal = openModal({
    title: 'Gösterge tipi seçiniz',
    bodyHtml,
    onMount: (body) => {
      const list = body.querySelector('[data-style-list]');
      if (!list) return;

      list.innerHTML = GAUGE_STYLE_OPTIONS.map((option) => `
        <button type="button" class="sda-style-option ${option.value === currentStyle ? 'is-active' : ''}" data-style-option="${option.value}">
          <span class="sda-style-thumb">
            ${buildPreviewSvg(option.icon)}
          </span>
          <span class="sda-style-option__copy">
            <strong>${option.label}</strong>
            <small>${option.desc}</small>
          </span>
          <span class="sda-style-check">✓</span>
        </button>
      `).join('');

      list.querySelectorAll('[data-style-option]').forEach((row) => {
        row.addEventListener('click', async () => {
          const style = row.getAttribute('data-style-option');
          row.classList.add('is-saving');
          // Önce kaydet, sonra modalı kapat. Böylece seçim asla "geri dönmez".
          await onSelect(style);
          modal.close();
        });
      });
    },
  });
}

function buildPreviewSvg(type) {
  if (type === 'digital') {
    return `<svg viewBox="0 0 100 70"><rect x="9" y="8" width="82" height="54" rx="10" fill="#171B21" stroke="currentColor"/><text x="50" y="45" text-anchor="middle" font-size="29" fill="currentColor">65</text></svg>`;
  }
  if (type === 'ring') {
    return `<svg viewBox="0 0 100 70"><circle cx="50" cy="35" r="27" fill="none" stroke="#343B46" stroke-width="7"/><path d="M30 55 A27 27 0 1 1 72 18" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><text x="50" y="41" text-anchor="middle" font-size="17" fill="currentColor">65</text></svg>`;
  }
  if (type === 'bar') {
    return `<svg viewBox="0 0 100 70"><rect x="10" y="27" width="80" height="14" rx="7" fill="#343B46"/><rect x="10" y="27" width="52" height="14" rx="7" fill="currentColor"/><text x="50" y="59" text-anchor="middle" font-size="12" fill="#9AA2AE">65%</text></svg>`;
  }
  const needle = type === 'classic' ? 'M50 56 L30 30' : type === 'hybrid' ? 'M50 48 L29 29' : 'M50 51 L31 31';
  return `<svg viewBox="0 0 100 70"><path d="M18 52 A32 32 0 1 1 82 52" fill="none" stroke="#343B46" stroke-width="6"/><path d="M18 52 A32 32 0 0 1 61 22" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><line x1="50" y1="48" x2="${needle.split(' ')[3] ?? '30'}" y2="${needle.split(' ')[4] ?? '30'}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="48" r="5" fill="currentColor"/><text x="50" y="66" text-anchor="middle" font-size="10" fill="#9AA2AE">65</text></svg>`;
}

async function moveWidget(pid, direction) {
  const config = getDashboardConfig();
  const index = config.widgets.findIndex((w) => w.pid === pid);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= config.widgets.length) return;
  const widgets = [...config.widgets];
  [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
  await setDashboardWidgets(widgets);
}

function injectEditPanelStyles() {
  if (document.getElementById('sda-edit-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'sda-edit-panel-styles';
  style.textContent = `
    .sda-style-intro{display:flex;flex-direction:column;gap:4px;margin:0 0 14px;padding:4px 2px;color:var(--sda-text-muted,#8B93A1)}
    .sda-style-intro strong{color:var(--sda-text-primary,#EDEFF2);font-size:1rem}
    .sda-style-intro span{font-size:.78rem;line-height:1.4}
    .sda-widget-card{margin-bottom:10px;padding:14px;border-radius:16px;background:var(--sda-bg-elevated,#242933);border:1px solid rgba(255,255,255,.07)}
    .sda-widget-card.is-selected{border-color:color-mix(in srgb,var(--sda-accent,#FF8A3D) 32%,transparent)}
    .sda-widget-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .sda-widget-title{display:flex;align-items:center;gap:9px;font-weight:600;min-width:0}
    .sda-widget-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sda-order-actions{display:flex;gap:4px;flex:none}
    .sda-order-actions button{width:32px;height:32px;border:0;border-radius:9px;background:rgba(255,255,255,.06);color:var(--sda-text-primary,#EDEFF2)}
    .sda-order-actions button:disabled{opacity:.25}
    .sda-style-current{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:10px 11px;border-radius:12px;background:rgba(0,0,0,.16)}
    .sda-style-current__text{display:flex;flex-direction:column;gap:2px;min-width:0}
    .sda-style-current__text span{font-size:.65rem;color:var(--sda-text-muted,#8B93A1);text-transform:uppercase;letter-spacing:.08em}
    .sda-style-current__text strong{font-size:.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sda-style-change{display:flex;align-items:center;gap:5px;border:0;background:none;color:var(--sda-accent,#FF8A3D);font-weight:700;white-space:nowrap}
    .sda-color-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
    .sda-color-row>span{font-size:.72rem;color:var(--sda-text-muted,#8B93A1)}
    .sda-color-list{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
    .sda-color-list button{padding:2px;border:0;background:none}
    .sda-color-swatch{display:block;width:19px;height:19px;border-radius:50%;border:2px solid transparent;box-sizing:border-box}
    .sda-color-swatch[aria-current="true"]{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.18)}
    .sda-style-picker{display:flex;flex-direction:column;gap:9px;padding:2px}
    .sda-style-option{display:grid;grid-template-columns:74px minmax(0,1fr) 24px;align-items:center;gap:12px;width:100%;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:15px;background:#1A1E24;color:var(--sda-text-primary,#EDEFF2);text-align:left}
    .sda-style-option.is-active{border-color:var(--sda-accent,#FF8A3D);box-shadow:0 0 0 1px color-mix(in srgb,var(--sda-accent,#FF8A3D) 35%,transparent)}
    .sda-style-option.is-saving{opacity:.65;pointer-events:none}
    .sda-style-thumb{width:74px;height:58px;border-radius:11px;background:#101419;color:var(--sda-accent,#FF8A3D);display:flex;align-items:center;justify-content:center;overflow:hidden}
    .sda-style-thumb svg{width:100%;height:100%}
    .sda-style-option__copy{display:flex;flex-direction:column;gap:4px;min-width:0}
    .sda-style-option__copy strong{font-size:.9rem}
    .sda-style-option__copy small{font-size:.72rem;color:var(--sda-text-muted,#8B93A1);line-height:1.3}
    .sda-style-check{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:transparent;border:1px solid rgba(255,255,255,.15);font-size:.75rem}
    .sda-style-option.is-active .sda-style-check{background:var(--sda-accent,#FF8A3D);border-color:var(--sda-accent,#FF8A3D);color:#111}
  `;
  document.head.appendChild(style);
}
