/**
 * fuel-view.js
 * ---------------------------------------------------------------------------
 * "Yakıt & Bakım" ekranı: yakıt alım kaydı + fiyat grafiği, bakım kalemleri
 * listesi (süresi dolanlar vurgulanır).
 * ---------------------------------------------------------------------------
 */

import { addFuelPurchase, listFuelPurchases } from '../data/fuel-repository.js';
import { addMaintenanceItem, listMaintenanceItems } from '../data/maintenance-repository.js';
import { getEstimatedOdometerKm } from '../fuel/odometer-estimator.js';
import { renderFuelPriceChart } from '../charts/fuel-chart.js';
import { logWarn } from '../core/logger.js';

/** @type {{value: string, label: string}[]} Bakım kalemi türleri (spesifikasyondaki liste). */
const MAINTENANCE_TYPES = [
  { value: 'oil', label: 'Yağ Değişimi' },
  { value: 'filter', label: 'Filtre' },
  { value: 'timing_belt', label: 'Triger' },
  { value: 'tires', label: 'Lastik Değişimi' },
  { value: 'inspection', label: 'Muayene' },
  { value: 'insurance', label: 'Sigorta' },
  { value: 'kasko', label: 'Kasko' },
  { value: 'emission', label: 'Egzoz Emisyonu' },
];

/**
 * Yakıt & Bakım görünümünü başlatır.
 */
export function initFuelView() {
  const container = document.querySelector('[data-view="fuel"]');
  if (!container) {
    logWarn('fuel-view', 'Yakıt & Bakım konteyneri bulunamadı');
    return;
  }

  container.innerHTML = `
    <h3 style="margin:4px 0;">Yakıt</h3>
    <form data-fuel-form class="sda-card" style="display:grid; gap:8px; margin-bottom:16px;">
      <input name="liters" type="number" step="0.01" placeholder="Litre" required style="padding:8px;">
      <input name="amount" type="number" step="0.01" placeholder="Tutar (₺)" required style="padding:8px;">
      <input name="odometer" type="number" step="1" placeholder="Kilometre (opsiyonel)" style="padding:8px;">
      <button type="submit" class="sda-nav-btn" style="background:var(--sda-accent-soft);">Kaydet</button>
    </form>
    <canvas data-fuel-chart height="140" style="margin-bottom:16px;"></canvas>
    <div data-fuel-list style="margin-bottom:24px;"></div>

    <h3 style="margin:4px 0;">Bakım</h3>
    <form data-maintenance-form class="sda-card" style="display:grid; gap:8px; margin-bottom:16px;">
      <select name="type" style="padding:8px;">
        ${MAINTENANCE_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>
      <input name="lastDoneKm" type="number" step="1" placeholder="Son yapılan km (opsiyonel)" style="padding:8px;">
      <input name="intervalKm" type="number" step="1" placeholder="Aralık (km, opsiyonel)" style="padding:8px;">
      <input name="intervalMonths" type="number" step="1" placeholder="Aralık (ay, opsiyonel)" style="padding:8px;">
      <button type="submit" class="sda-nav-btn" style="background:var(--sda-accent-2-soft);">Ekle</button>
    </form>
    <div data-maintenance-list></div>
  `;

  bindFuelForm(container);
  bindMaintenanceForm(container);
  void renderFuelSection(container);
  void renderMaintenanceSection(container);
}

/**
 * @param {HTMLElement} container
 */
function bindFuelForm(container) {
  const form = container.querySelector('[data-fuel-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const liters = parseFloat(data.get('liters'));
    const amount = parseFloat(data.get('amount'));
    const odometer = data.get('odometer') ? parseFloat(data.get('odometer')) : null;

    if (!liters || !amount) return;

    await addFuelPurchase({
      purchased_at: Date.now(),
      liters,
      amount,
      odometer_km: odometer,
      price_per_liter: amount / liters,
    });

    form.reset();
    await renderFuelSection(container);
  });
}

/**
 * @param {HTMLElement} container
 */
async function renderFuelSection(container) {
  const purchases = await listFuelPurchases();

  const canvas = container.querySelector('[data-fuel-chart]');
  if (canvas) renderFuelPriceChart(canvas, purchases);

  const listEl = container.querySelector('[data-fuel-list]');
  if (!listEl) return;

  if (purchases.length === 0) {
    listEl.innerHTML = '<p class="sda-card__label">Henüz yakıt kaydı yok.</p>';
    return;
  }

  listEl.innerHTML = purchases.map((p) => `
    <div class="sda-card" style="margin-bottom:8px;">
      <p class="sda-card__label">${new Date(p.purchased_at).toLocaleDateString('tr-TR')}</p>
      <p class="sda-card__value" style="font-size:1rem;">${p.liters.toFixed(1)} L · ${p.amount.toFixed(2)} ₺ · ${(p.amount / p.liters).toFixed(2)} ₺/L</p>
    </div>
  `).join('');
}

/**
 * @param {HTMLElement} container
 */
function bindMaintenanceForm(container) {
  const form = container.querySelector('[data-maintenance-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const type = data.get('type');
    const typeInfo = MAINTENANCE_TYPES.find((t) => t.value === type);
    const lastDoneKm = data.get('lastDoneKm') ? parseFloat(data.get('lastDoneKm')) : null;
    const intervalKm = data.get('intervalKm') ? parseFloat(data.get('intervalKm')) : null;
    const intervalMonths = data.get('intervalMonths') ? parseInt(data.get('intervalMonths'), 10) : null;

    await addMaintenanceItem({
      type,
      label: typeInfo?.label ?? type,
      last_done_km: lastDoneKm,
      last_done_date: lastDoneKm !== null ? Date.now() : null,
      interval_km: intervalKm,
      interval_months: intervalMonths,
      notes: null,
    });

    form.reset();
    await renderMaintenanceSection(container);
  });
}

/**
 * @param {HTMLElement} container
 */
async function renderMaintenanceSection(container) {
  const [items, odometerKm] = await Promise.all([listMaintenanceItems(), getEstimatedOdometerKm()]);
  const listEl = container.querySelector('[data-maintenance-list]');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '<p class="sda-card__label">Henüz bakım kalemi yok.</p>';
    return;
  }

  listEl.innerHTML = items.map((item) => {
    const kmRemaining = item.interval_km && item.last_done_km !== null && odometerKm !== null
      ? (item.last_done_km + item.interval_km) - odometerKm
      : null;
    const isDue = kmRemaining !== null && kmRemaining <= 0;

    return `
      <div class="sda-card" style="margin-bottom:8px; ${isDue ? 'border-color: var(--sda-danger);' : ''}">
        <p class="sda-card__label">${item.label}</p>
        <p class="sda-card__value" style="font-size:1rem; ${isDue ? 'color: var(--sda-danger);' : ''}">
          ${kmRemaining !== null
            ? (isDue ? 'Süresi geçti' : `~${Math.round(kmRemaining)} km kaldı`)
            : 'Tahmini km sayacı bekleniyor'}
        </p>
      </div>
    `;
  }).join('');
}
