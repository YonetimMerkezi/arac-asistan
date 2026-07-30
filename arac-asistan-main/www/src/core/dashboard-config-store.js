/**
 * dashboard-config-store.js
 * ---------------------------------------------------------------------------
 * Kullanıcının Panel özelleştirmesini (hangi widget'lar, hangi sırada, hangi
 * renkte) kalıcı olarak saklar. widget-registry.js NELERİN var olduğunu,
 * bu dosya kullanıcının NELERİ seçtiğini tutar - ayrı kaygılar.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { DEFAULT_WIDGET_ORDER } from '../obd/widget-registry.js';
import { logError, logInfo } from './logger.js';

/** @type {string} */
const STORAGE_KEY = 'sda_dashboard_config';

/**
 * @typedef {Object} WidgetInstanceConfig
 * @property {string} pid
 * @property {number|null} colorHue - null ise widget'ın kendi varsayılan rengi kullanılır.
 * @property {'arc'|'needle'|'digital'|'bar'|null} [gaugeStyle] - null/tanımsız
 *   ise "arc" (imza yay tasarımı) kullanılır - bkz. ui/components/gauge.js.
 */

/**
 * @typedef {Object} DashboardConfig
 * @property {WidgetInstanceConfig[]} widgets - Sırayla, yalnızca GÖRÜNÜR olanlar.
 */

/** @type {DashboardConfig} */
let current = { widgets: DEFAULT_WIDGET_ORDER.map((pid) => ({ pid, colorHue: null, gaugeStyle: null })) };

/** @type {Set<(config: DashboardConfig) => void>} */
const listeners = new Set();

/**
 * Kayıtlı Panel yapılandırmasını yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<DashboardConfig>}
 */
export async function initDashboardConfigStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) current = JSON.parse(value);
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması okunamadı, varsayılana dönülüyor', error);
  }
  logInfo('dashboard-config-store', `${current.widgets.length} widget yüklendi`);
  return current;
}

/**
 * @returns {DashboardConfig}
 */
export function getDashboardConfig() {
  return { widgets: current.widgets.map((w) => ({ ...w })) };
}

/**
 * Tüm widget listesini (sıra dahil) değiştirir ve kalıcı olarak saklar.
 * @param {WidgetInstanceConfig[]} widgets
 * @returns {Promise<void>}
 */
export async function setDashboardWidgets(widgets) {
  current = { widgets };
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
    widgets: current.widgets.map((w) => (w.pid === pid ? { ...w, colorHue } : w)),
  };
  await persist();
  notify();
}

/**
 * Tek bir widget'ın gösterge tipini (arc/needle/digital/bar) değiştirir.
 * @param {string} pid
 * @param {'arc'|'needle'|'digital'|'bar'|null} gaugeStyle
 * @returns {Promise<void>}
 */
export async function setWidgetStyle(pid, gaugeStyle) {
  current = {
    widgets: current.widgets.map((w) => (w.pid === pid ? { ...w, gaugeStyle } : w)),
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
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(current) });
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması kaydedilemedi', error);
  }
}

/**
 * Tüm dinleyicileri bilgilendirir.
 */
function notify() {
  for (const listener of listeners) listener(getDashboardConfig());
}
