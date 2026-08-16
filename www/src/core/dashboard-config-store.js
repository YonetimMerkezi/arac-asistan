/**
 * dashboard-config-store.js
 * ---------------------------------------------------------------------------
 * Kullanıcının Panel özelleştirmesini (hangi widget'lar, hangi sırada,
 * hangi renkte ve hangi gösterge tasarımında) kalıcı olarak saklar.
 *
 * widget-registry.js NELERİN var olduğunu,
 * bu dosya kullanıcının NELERİ seçtiğini tutar - ayrı kaygılar.
 *
 * Gösterge stilleri burada normalize edilir. Böylece:
 *   - yeni widget'lar güvenli bir varsayılan stil alır,
 *   - eski kayıtlar bozulmaz,
 *   - dashboard-view.js yalnızca kayıtlı gaugeStyle değerini çizer.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { DEFAULT_WIDGET_ORDER } from '../obd/widget-registry.js';
import { logError, logInfo } from './logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_dashboard_config';

/**
 * Desteklenen yeni gösterge stilleri.
 * @type {readonly string[]}
 */
export const GAUGE_STYLES = Object.freeze([
  'analog-classic',
  'analog-modern',
  'digital-card',
  'digital-modern',
  'hybrid',
  'compact',
]);

/** @type {string} */
export const DEFAULT_GAUGE_STYLE = 'analog-modern';

/**
 * Eski sürümlerde kullanılan gösterge adlarının yeni karşılıkları.
 * @type {Readonly<Record<string,string>>}
 */
const LEGACY_GAUGE_STYLE_MAP = Object.freeze({
  arc: 'analog-modern',
  needle: 'analog-classic',
  digital: 'digital-card',
  bar: 'compact',
});

/**
 * Gelen bir gaugeStyle değerini güvenli ve geriye dönük uyumlu hale getirir.
 *
 * @param {string|null|undefined} style
 * @returns {string}
 */
export function normalizeGaugeStyle(style) {
  if (GAUGE_STYLES.includes(style)) return style;
  if (style && LEGACY_GAUGE_STYLE_MAP[style]) return LEGACY_GAUGE_STYLE_MAP[style];
  return DEFAULT_GAUGE_STYLE;
}

/**
 * @typedef {Object} WidgetInstanceConfig
 * @property {string} pid
 * @property {number|null} colorHue - null ise widget'ın kendi varsayılan rengi kullanılır.
 * @property {string|null} [gaugeStyle] - Gösterge tasarımı. Eski kayıtlar
 *   normalizeGaugeStyle() ile yeni tasarımlara dönüştürülür.
 */

/**
 * @typedef {Object} DashboardConfig
 * @property {WidgetInstanceConfig[]} widgets - Sırayla, yalnızca GÖRÜNÜR olanlar.
 */

/**
 * Bir widget kaydını temizler ve eksik/eski alanları tamamlar.
 * @param {Partial<WidgetInstanceConfig>|null|undefined} widget
 * @returns {WidgetInstanceConfig|null}
 */
function normalizeWidget(widget) {
  if (!widget || typeof widget.pid !== 'string' || widget.pid.trim() === '') return null;

  const colorHue = widget.colorHue === null || widget.colorHue === undefined
    ? null
    : Number.isFinite(Number(widget.colorHue))
      ? Number(widget.colorHue)
      : null;

  return {
    pid: widget.pid,
    colorHue,
    gaugeStyle: normalizeGaugeStyle(widget.gaugeStyle),
  };
}

/**
 * Kayıtlı yapılandırmanın tamamını normalize eder.
 * @param {unknown} config
 * @returns {DashboardConfig}
 */
function normalizeConfig(config) {
  const rawWidgets = config && typeof config === 'object' && Array.isArray(config.widgets)
    ? config.widgets
    : DEFAULT_WIDGET_ORDER.map((pid) => ({ pid, colorHue: null, gaugeStyle: null }));

  const widgets = rawWidgets
    .map(normalizeWidget)
    .filter(Boolean);

  return { widgets };
}

/** @type {DashboardConfig} */
let current = normalizeConfig({
  widgets: DEFAULT_WIDGET_ORDER.map((pid) => ({ pid, colorHue: null, gaugeStyle: null })),
});

/** @type {Set<(config: DashboardConfig) => void>} */
const listeners = new Set();

/**
 * Kayıtlı Panel yapılandırmasını yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * Eski gösterge adları otomatik olarak yeni adlara dönüştürülür.
 *
 * @returns {Promise<DashboardConfig>}
 */
export async function initDashboardConfigStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });

    if (value) {
      current = normalizeConfig(JSON.parse(value));
    }
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması okunamadı, varsayılana dönülüyor', error);
    current = normalizeConfig({
      widgets: DEFAULT_WIDGET_ORDER.map((pid) => ({ pid, colorHue: null, gaugeStyle: null })),
    });
  }

  logInfo('dashboard-config-store', `${current.widgets.length} widget yüklendi`);
  return getDashboardConfig();
}

/**
 * @returns {DashboardConfig}
 */
export function getDashboardConfig() {
  return {
    widgets: current.widgets.map((w) => ({ ...w })),
  };
}

/**
 * Tüm widget listesini (sıra dahil) değiştirir ve kalıcı olarak saklar.
 * Her kayıt normalize edilir; yeni eklenen widget'lar otomatik olarak
 * analog-modern tasarımını alır.
 *
 * @param {WidgetInstanceConfig[]} widgets
 * @returns {Promise<void>}
 */
export async function setDashboardWidgets(widgets) {
  current = normalizeConfig({ widgets });
  await persist();
  notify();
}

/**
 * Tek bir widget'ın rengini değiştirir.
 * @param {string} pid
 * @param {number|null} colorHue
 * @returns {Promise<void>}
 */
export async function setWidgetColor(pid, colorHue) {
  current = {
    widgets: current.widgets.map((w) => (
      w.pid === pid
        ? {
            ...w,
            colorHue: colorHue === null || colorHue === undefined
              ? null
              : Number.isFinite(Number(colorHue))
                ? Number(colorHue)
                : null,
          }
        : w
    )),
  };

  await persist();
  notify();
}

/**
 * Tek bir widget'ın gösterge tipini değiştirir.
 * Eski arc/needle/digital/bar değerleri de kabul edilir.
 *
 * @param {string} pid
 * @param {string|null|undefined} gaugeStyle
 * @returns {Promise<void>}
 */
export async function setWidgetStyle(pid, gaugeStyle) {
  const normalizedStyle = normalizeGaugeStyle(gaugeStyle);

  current = {
    widgets: current.widgets.map((w) => (
      w.pid === pid
        ? { ...w, gaugeStyle: normalizedStyle }
        : w
    )),
  };

  await persist();
  notify();
}

/**
 * Yapılandırma değişikliklerine abone olur.
 * @param {(config: DashboardConfig) => void} callback
 * @returns {() => void}
 */
export function onDashboardConfigChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * @returns {Promise<void>}
 */
async function persist() {
  try {
    await Preferences.set({
      key: STORAGE_KEY,
      value: JSON.stringify(current),
    });
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması kaydedilemedi', error);
  }
}

/**
 * Tüm dinleyicileri bilgilendirir.
 */
function notify() {
  const snapshot = getDashboardConfig();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      logError('dashboard-config-store', 'Panel değişiklik dinleyicisi hata verdi', error);
    }
  }
}
