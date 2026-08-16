/**
 * dashboard-config-store.js
 * ---------------------------------------------------------------------------
 * Panel widget seçimlerini, sırasını, rengini ve gösterge tipini kalıcı tutar.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { DEFAULT_WIDGET_ORDER } from '../obd/widget-registry.js';
import { logError, logInfo } from './logger.js';

const STORAGE_KEY = 'sda_dashboard_config';
const DEFAULT_GAUGE_STYLE = 'analog-modern';

const VALID_GAUGE_STYLES = new Set([
  'analog-classic',
  'analog-modern',
  'digital-card',
  'digital-modern',
  'hybrid',
  'compact',
  'arc',
  'needle',
  'digital',
  'bar',
]);

const LEGACY_STYLE_MAP = {
  arc: 'analog-modern',
  needle: 'analog-classic',
  digital: 'digital-card',
  bar: 'compact',
};

function normalizeGaugeStyle(style) {
  if (!style) return DEFAULT_GAUGE_STYLE;
  return LEGACY_STYLE_MAP[style] ?? (VALID_GAUGE_STYLES.has(style) ? style : DEFAULT_GAUGE_STYLE);
}

function normalizeWidget(widget) {
  return {
    pid: String(widget?.pid ?? ''),
    colorHue: widget?.colorHue === null || widget?.colorHue === undefined
      ? null
      : Number(widget.colorHue),
    gaugeStyle: normalizeGaugeStyle(widget?.gaugeStyle),
  };
}

function normalizeConfig(raw) {
  const widgets = Array.isArray(raw?.widgets) ? raw.widgets.map(normalizeWidget).filter((w) => w.pid) : [];
  return { widgets };
}

let current = {
  widgets: DEFAULT_WIDGET_ORDER.map((pid) => ({
    pid,
    colorHue: null,
    gaugeStyle: DEFAULT_GAUGE_STYLE,
  })),
};

const listeners = new Set();

export async function initDashboardConfigStore() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      current = normalizeConfig(JSON.parse(value));
      // Eski kayıtları tek seferde yeni şemaya geçir.
      await persist();
    }
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması okunamadı, varsayılana dönülüyor', error);
  }

  logInfo('dashboard-config-store', `${current.widgets.length} widget yüklendi`);
  return getDashboardConfig();
}

export function getDashboardConfig() {
  return {
    widgets: current.widgets.map((w) => ({ ...w })),
  };
}

export async function setDashboardWidgets(widgets) {
  current = normalizeConfig({ widgets });
  await persist();
  notify();
}

export async function setWidgetColor(pid, colorHue) {
  current = {
    widgets: current.widgets.map((w) => (
      w.pid === pid ? { ...w, colorHue: Number.isFinite(Number(colorHue)) ? Number(colorHue) : null } : w
    )),
  };
  await persist();
  notify();
}

export async function setWidgetStyle(pid, gaugeStyle) {
  const normalized = normalizeGaugeStyle(gaugeStyle);
  current = {
    widgets: current.widgets.map((w) => (
      w.pid === pid ? { ...w, gaugeStyle: normalized } : w
    )),
  };
  await persist();
  notify();
}

export function onDashboardConfigChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

async function persist() {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(current) });
  } catch (error) {
    logError('dashboard-config-store', 'Panel yapılandırması kaydedilemedi', error);
  }
}

function notify() {
  const snapshot = getDashboardConfig();
  for (const listener of listeners) listener(snapshot);
}
