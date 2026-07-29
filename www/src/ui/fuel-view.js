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
import { getFuelStationCache, onFuelStationCacheUpdate, forceRefreshFuelStationCache } from '../maps/fuel-station-cache.js';
import { registerRefreshHandler } from '../core/refresh-registry.js';
import { consumePendingFuelSelection } from '../core/pending-fuel-selection.js';
import { openFuelRegionPicker } from './fuel-region-view.js';
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
    <button type="button" data-open-region-picker class="sda-btn sda-btn--secondary" style="width:100%; margin-bottom:12px;">
      📍 İl/İlçe Seç - Başka Bölgenin Fiyatlarını Gör
    </button>
    <form data-fuel-form class="sda-card" style="display:grid; gap:8px; margin-bottom:16px;">
      <select name="station" data-station-select style="padding:8px;">
        <option value="">İstasyon seç (fiyat otomatik dolsun)...</option>
      </select>
      <select name="fuelType" data-fuel-type-select style="padding:8px;">
        <option value="lpg" selected>LPG</option>
        <option value="benzin">Benzin</option>
        <option value="motorin">Motorin</option>
      </select>
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

  // "Kaydırarak yenile" - istasyon/fiyat önbelleğini tazeler VE yakıt
  // kayıt listesi/grafiğini yeniden çizer.
  registerRefreshHandler('fuel', async () => {
    await forceRefreshFuelStationCache();
    await renderFuelSection(container);
  });
  void renderMaintenanceSection(container);
  populateStationSelect(container);
}

/**
 * ÖNBELLEKTEN (uygulama açılışından beri arka planda tutulan, periyodik
 * güncellenen fiyat listesi - bkz. maps/fuel-station-cache.js) "İstasyon
 * seç" açılır menüsünü ANINDA doldurur - ayrıca canlı ağ isteği beklemez.
 * Bir istasyon VE yakıt türü (Benzin/Motorin/LPG) seçilince, o türün
 * birim fiyatı × litre otomatik "Tutar" alanına yazılır.
 * @param {HTMLElement} container
 */
function populateStationSelect(container) {
  const select = container.querySelector('[data-station-select]');
  container.querySelector('[data-open-region-picker]')?.addEventListener('click', openFuelRegionPicker);
  const fuelTypeSelect = container.querySelector('[data-fuel-type-select]');
  if (!select) return;

  const cached = getFuelStationCache();
  const withPrice = cached.prices.filter((s) => s.benzin !== null || s.motorin !== null || s.lpg !== null);

  const rebuildOptions = () => {
    const fuelType = fuelTypeSelect?.value ?? 'lpg';
    const eligible = withPrice.filter((s) => s[fuelType] !== null);
    select.innerHTML = '<option value="">İstasyon seç (fiyat otomatik dolsun)...</option>'
      + eligible.map((s, i) => `<option value="${i}">${s.dagitici} - ${s[fuelType]} ₺/L</option>`).join('');
    return eligible;
  };

  let eligibleStations = rebuildOptions();

  const litersInput = container.querySelector('input[name="liters"]');
  const amountInput = container.querySelector('input[name="amount"]');

  /**
   * @returns {number|null} Seçili istasyon/yakıt türü için birim fiyat, yoksa null.
   */
  const currentPricePerLiter = () => {
    const station = eligibleStations[Number(select.value)];
    const fuelType = fuelTypeSelect?.value ?? 'lpg';
    return station?.[fuelType] ?? null;
  };

  // İKİ YÖNLÜ hesap: litre girilince tutar, TUTAR girilince de litre
  // otomatik hesaplanır. Programatik `.value =` ataması 'input' olayını
  // TETİKLEMEDİĞİ için (yalnızca kullanıcı yazınca tetiklenir) iki yönlü
  // dinleyici sonsuz döngüye girmez - her biri yalnızca DİĞER alanı yazar.
  const recalcAmountFromLiters = () => {
    const pricePerLiter = currentPricePerLiter();
    const liters = parseFloat(litersInput.value);
    if (pricePerLiter && liters) {
      amountInput.value = (pricePerLiter * liters).toFixed(2);
    }
  };

  const recalcLitersFromAmount = () => {
    const pricePerLiter = currentPricePerLiter();
    const amount = parseFloat(amountInput.value);
    if (pricePerLiter && amount) {
      litersInput.value = (amount / pricePerLiter).toFixed(2);
    }
  };

  fuelTypeSelect?.addEventListener('change', () => {
    eligibleStations = rebuildOptions();
    recalcAmountFromLiters();
  });
  select.addEventListener('change', recalcAmountFromLiters);
  litersInput.addEventListener('input', recalcAmountFromLiters);
  amountInput.addEventListener('input', recalcLitersFromAmount);

  // Harita/İstasyon ekranındaki "Yakıt Al" düğmesinden gelen bekleyen bir
  // seçim varsa (bkz. core/pending-fuel-selection.js), yakıt türünü ve
  // istasyonu ONA göre önceden seçip birim fiyatı hemen uygular - kullanıcı
  // yalnızca litre girip Kaydet'e basar.
  const pending = consumePendingFuelSelection();
  if (pending) {
    if (fuelTypeSelect) fuelTypeSelect.value = pending.fuelType;
    eligibleStations = rebuildOptions();
    const matchIndex = eligibleStations.findIndex(
      (s) => s.dagitici.toLocaleLowerCase('tr') === pending.brand.toLocaleLowerCase('tr'),
    );
    if (matchIndex !== -1) {
      select.value = String(matchIndex);
      recalcAmountFromLiters();
    }
  }

  // Önbellek arka planda tazelendiğinde (periyodik/konum değişimi) listeyi
  // sessizce güncel tut - kullanıcı formu açık bırakmış olsa bile.
  onFuelStationCacheUpdate(() => {
    const newCached = getFuelStationCache();
    withPrice.length = 0;
    withPrice.push(...newCached.prices.filter((s) => s.benzin !== null || s.motorin !== null || s.lpg !== null));
    eligibleStations = rebuildOptions();
  });
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
