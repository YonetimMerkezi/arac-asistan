/**
 * Smart Drive AI - Dashboard View
 * Koyu otomobil kokpiti + öncelikli OBD polling.
 */
import '../ui/components/gauge.js';
import { mountClockWeatherCard, unmountClockWeatherCard, refreshWeatherNow } from './components/clock-weather-card.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { renderEditModePanel } from './dashboard-edit-panel.js';
import { iconMarkup } from './icons.js';
import { queryPid } from '../obd/elm327.js';
import { estimateLitersPerHour, estimateLitersPer100Km } from '../fuel/instant-consumption.js';
import { getWidgetDefinition } from '../obd/widget-registry.js';
import { getState as getBluetoothState, onStateChange } from '../bluetooth/bluetooth-manager.js';
import { onVehicleInfoChange } from '../core/vehicle-info-store.js';
import { setLivePidValue } from '../core/vehicle-live-data-store.js';
import { getUnits, onUnitsChange } from '../core/units-store.js';
import { formatDistanceOrSpeed, formatTemperature } from '../core/unit-conversion.js';
import { getDashboardConfig, onDashboardConfigChange } from '../core/dashboard-config-store.js';
import { logWarn } from '../core/logger.js';

const POLL_TICK_MS = 70;
const DEFAULT_POLL_MS = 800;
const POLL_BY_PID = {
  '0D': 120, '0C': 120, '11': 180, '04': 250,
  '05': 600, '42': 900, '10': 500, '0F': 1000,
  '46': 5000, '2F': 1800, '06': 1200, '07': 1200,
  '14': 1200, '15': 1200, '5C': 1500, 'CALC_L100': 500,
};

let pollingActive = false;
let pollingRunning = false;
let editMode = false;
let viewContainer = null;
let lastSupportedPids = [];
const lastPolledAt = new Map();

export function initDashboardView() {
  viewContainer = document.querySelector('[data-view="dashboard"]');
  if (!viewContainer) { logWarn('dashboard-view', 'Dashboard konteyneri bulunamadı'); return; }
  applyCockpitShell();
  render();
  registerRefreshHandler('dashboard', refreshWeatherNow);

  onVehicleInfoChange((info) => {
    lastSupportedPids = info.supportedPids ?? [];
    if (!editMode) applySupportedPidVisibility();
  });
  onUnitsChange(() => { if (!editMode) render(); });
  onDashboardConfigChange(() => { lastPolledAt.clear(); if (!editMode) render(); });
  onStateChange((btState) => {
    if (btState.status === 'connected' && !pollingActive) startPolling();
    if (btState.status !== 'connected') pollingActive = false;
  });
  if (getBluetoothState().status === 'connected') startPolling();
}

function applyCockpitShell() {
  if (!viewContainer) return;
  viewContainer.style.cssText = [
    'background:#0b0d10', 'color:#eef0f3', 'min-height:100%',
    'padding:10px 10px 28px', 'border-radius:18px',
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif'
  ].join(';');
}

function render() {
  if (!viewContainer) return;
  unmountClockWeatherCard();
  viewContainer.innerHTML = `
    <style>
      [data-dashboard-cockpit]{--sda-bg:#0b0d10;--sda-card:#171a20;--sda-line:#30353d;--sda-text:#eef0f3;--sda-muted:#8c949e;--sda-orange:#ff963f}
      [data-dashboard-cockpit] .cockpit-head{display:flex;justify-content:space-between;align-items:center;padding:6px 5px 12px;color:#b8bec6;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}
      [data-dashboard-cockpit] .status-dot{width:8px;height:8px;border-radius:50%;background:#35e879;box-shadow:0 0 10px #35e879}
      [data-dashboard-cockpit] .edit-row{display:flex;justify-content:flex-end;margin:0 3px 8px}
      [data-dashboard-cockpit] .cockpit-edit{background:transparent;border:0;color:#ff963f;display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;padding:8px;cursor:pointer}
      [data-dashboard-cockpit] .sda-grid{gap:10px!important}
      [data-dashboard-cockpit] .sda-card{background:linear-gradient(145deg,#1d2128,#12151a)!important;border:1px solid #30353d!important;box-shadow:0 10px 22px rgba(0,0,0,.35),inset 0 1px rgba(255,255,255,.025)!important;border-radius:18px!important;color:#eef0f3!important}
      [data-dashboard-cockpit] .sda-empty-state{background:#171a20;border:1px solid #30353d;border-radius:18px;padding:28px;color:#aeb5be}
    </style>
    <div data-dashboard-cockpit>
      <div class="cockpit-head"><span>SMART DRIVE AI • OBD KOKPİT</span><span class="status-dot"></span></div>
      <div data-clock-weather></div>
      <div class="edit-row"><button type="button" data-toggle-edit class="cockpit-edit">${editMode ? iconMarkup('done',{size:18})+'<span>Bitti</span>' : iconMarkup('edit',{size:18})+'<span>Düzenle</span>'}</button></div>
      <div data-content></div>
    </div>`;

  if (!editMode) {
    const clock = viewContainer.querySelector('[data-clock-weather]');
    if (clock) mountClockWeatherCard(clock);
  }
  viewContainer.querySelector('[data-toggle-edit]')?.addEventListener('click', () => { editMode = !editMode; render(); });
  const content = viewContainer.querySelector('[data-content]');
  if (editMode) renderEditModePanel(content, () => viewContainer?.querySelector('[data-content]'));
  else { renderNormalMode(content); applySupportedPidVisibility(); }
}

function renderNormalMode(content) {
  const config = getDashboardConfig();
  if (!config.widgets.length) {
    content.innerHTML = '<div class="sda-empty-state"><p class="sda-empty-state__title">Panel boş</p><p>Sağ üstteki Düzenle ile göstergeleri seç.</p></div>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'sda-grid';
  config.widgets.forEach((instance,index) => {
    const def = getWidgetDefinition(instance.pid);
    if (!def) return;
    const card = document.createElement('div');
    card.className = 'sda-card sda-card--elevated';
    card.dataset.pidCard = def.pid;
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden;min-height:190px;padding:10px 4px;';
    if (index === 0) card.style.gridColumn = '1 / -1';

    const gauge = document.createElement('sda-gauge');
    const minDisplay = convertForDisplay(def, def.min);
    const maxDisplay = convertForDisplay(def, def.max);
    gauge.setAttribute('label', def.label);
    gauge.setAttribute('unit', minDisplay.unit);
    gauge.setAttribute('min', String(minDisplay.value));
    gauge.setAttribute('max', String(maxDisplay.value));
    gauge.setAttribute('size', index === 0 ? 'lg' : 'sm');
    gauge.setAttribute('variant', instance.gaugeStyle ?? 'needle');
    // Başlangıçta min değeri göstermiyoruz. Böylece dış sıcaklık -30°C gibi görünmez.
    if (instance.lastValue !== undefined && instance.lastValue !== null) gauge.setAttribute('value', String(instance.lastValue));
    if (def.dangerAbove !== undefined) gauge.setAttribute('danger-above', String(convertForDisplay(def, def.dangerAbove).value));
    gauge.setAttribute('color-hue', String(instance.colorHue ?? def.defaultColorHue));
    card.appendChild(gauge); grid.appendChild(card);
  });
  content.replaceChildren(grid);
}

function applySupportedPidVisibility() {
  if (!viewContainer || lastSupportedPids.length === 0) return;
  viewContainer.querySelectorAll('[data-pid-card]').forEach(card => {
    const pid = card.getAttribute('data-pid-card');
    const def = getWidgetDefinition(pid);
    const required = def?.requiresPids ?? [pid];
    card.hidden = !required.every(p => lastSupportedPids.includes(p));
  });
}

async function startPolling() {
  if (pollingRunning) return;
  pollingActive = true; pollingRunning = true;
  try {
    while (pollingActive) {
      if (editMode) { await sleep(150); continue; }
      const config = getDashboardConfig();
      const now = performance.now();
      for (const instance of config.widgets) {
        if (!pollingActive || editMode) break;
        const def = getWidgetDefinition(instance.pid);
        if (!def) continue;
        const interval = Number(def.pollInterval ?? POLL_BY_PID[def.pid] ?? DEFAULT_POLL_MS);
        const last = lastPolledAt.get(def.pid) ?? -Infinity;
        if (now - last < interval) continue;
        if (lastSupportedPids.length && !(def.requiresPids ?? [def.pid]).every(p => lastSupportedPids.includes(p))) continue;
        lastPolledAt.set(def.pid, now);
        try { await pollOne(def); } catch (error) { logWarn('dashboard-view', `PID okunamadı: ${def.pid}`, error); }
      }
      await sleep(POLL_TICK_MS);
    }
  } finally { pollingRunning = false; }
}

async function pollOne(def) {
  if (def.requiresPids) {
    const calculated = await queryCalculatedWidget(def.pid);
    if (calculated) updateGauge(def, calculated.value, calculated.unit);
    return;
  }
  const result = await queryPid(def.pid);
  if (!result) return;
  setLivePidValue(def.pid, result.value, result.unit);
  const display = convertForDisplay(def, result.value);
  updateGauge(def, display.value, display.unit);
}

function updateGauge(def, value, unit) {
  const gauge = viewContainer?.querySelector(`[data-pid-card="${def.pid}"] sda-gauge`);
  if (!gauge) return;
  gauge.setAttribute('value', String(value));
  if (unit) gauge.setAttribute('unit', unit);
}

async function queryCalculatedWidget(pid) {
  if (pid !== 'CALC_L100') return null;
  const maf = await queryPid('10');
  const speed = await queryPid('0D');
  if (!maf || !speed) return null;
  const lph = estimateLitersPerHour(maf.value);
  const per100 = estimateLitersPer100Km(lph, speed.value);
  return per100 !== null ? {value:per100,unit:'L/100km'} : {value:lph,unit:'L/h'};
}

function convertForDisplay(def, rawValue) {
  const units = getUnits();
  if (def.unitKind === 'speed') return formatDistanceOrSpeed(rawValue, units.distance, def.unit);
  if (def.unitKind === 'temp') return formatTemperature(rawValue, units.temperature);
  return {value:rawValue,unit:def.unit};
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
