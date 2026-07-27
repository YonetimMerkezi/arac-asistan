/**
 * dashboard-view.js
 * ---------------------------------------------------------------------------
 * Ana ekran (dashboard) görünümü.
 *
 * Sorumlulukları:
 *  - `[data-view="dashboard"]` içine gösterge kartlarını (sda-gauge) inşa etmek
 *  - Bluetooth bağlıyken PID'leri sırayla (ELM327 yarı çift yönlü olduğu için
 *    paralel değil, ardışık) sorgulayıp kartları güncellemek
 *  - Aracın desteklemediği PID'lere ait kartları otomatik gizlemek
 *    (Faz 1'de keşfedilen supportedPids listesine göre)
 *
 * '../ui/components/gauge.js' import edilerek <sda-gauge> custom element'i
 * kaydedilir; bu dosya yalnızca dashboard'a ÖZGÜ yerleşim/veri mantığını içerir.
 * ---------------------------------------------------------------------------
 */

import '../ui/components/gauge.js';
import { queryPid } from '../obd/elm327.js';
import { getState as getBluetoothState, onStateChange } from '../bluetooth/bluetooth-manager.js';
import { getVehicleInfo, onVehicleInfoChange } from '../core/vehicle-info-store.js';
import { setLivePidValue } from '../core/vehicle-live-data-store.js';
import { logWarn } from '../core/logger.js';

/** @type {number} PID döngüsü tamamlandıktan sonraki bekleme (ms). Çok sık sorgu ELM327'yi tıkar. */
const POLL_INTERVAL_MS = 300;

/**
 * @typedef {Object} DashboardCardConfig
 * @property {string} pid - Hex PID kodu.
 * @property {string} label
 * @property {string} unit
 * @property {number} min
 * @property {number} max
 * @property {'lg'|'sm'} size
 * @property {number} [dangerAbove]
 */

/** @type {DashboardCardConfig[]} Ana ekranda gösterilecek kartlar, öncelik sırasına göre. */
const DASHBOARD_CARDS = [
  { pid: '0D', label: 'Hız', unit: 'km/h', min: 0, max: 240, size: 'lg' },
  { pid: '0C', label: 'Motor Devri', unit: 'RPM', min: 0, max: 8000, size: 'sm', dangerAbove: 6500 },
  { pid: '05', label: 'Hararet', unit: '°C', min: 0, max: 130, size: 'sm', dangerAbove: 105 },
  { pid: '42', label: 'Akü Voltajı', unit: 'V', min: 8, max: 16, size: 'sm', dangerAbove: 15 },
  { pid: '2F', label: 'Yakıt Seviyesi', unit: '%', min: 0, max: 100, size: 'sm' },
  { pid: '04', label: 'Motor Yükü', unit: '%', min: 0, max: 100, size: 'sm' },
  { pid: '11', label: 'Gaz Kelebeği', unit: '%', min: 0, max: 100, size: 'sm' },
  { pid: '0F', label: 'Emme Havası', unit: '°C', min: -20, max: 80, size: 'sm' },
  { pid: '46', label: 'Dış Sıcaklık', unit: '°C', min: -30, max: 55, size: 'sm' },
];

/** @type {boolean} Poll döngüsünün aktif olup olmadığı (bağlantı koptuğunda durdurulur). */
let pollingActive = false;

/** @type {() => void | null} */
let unsubscribeBtState = null;

/** @type {() => void | null} */
let unsubscribeVehicleInfo = null;

/**
 * Dashboard görünümünü başlatır: kartları oluşturur ve bağlantı durumuna
 * göre veri döngüsünü açıp kapatır. app-init.js tarafından bir kez çağrılır.
 */
export function initDashboardView() {
  const container = document.querySelector('[data-view="dashboard"]');
  if (!container) {
    logWarn('dashboard-view', 'Dashboard konteyneri bulunamadı');
    return;
  }

  buildCards(container);
  applySupportedPidVisibility(container, getVehicleInfo().supportedPids);

  unsubscribeVehicleInfo = onVehicleInfoChange((info) => {
    applySupportedPidVisibility(container, info.supportedPids);
  });

  unsubscribeBtState = onStateChange((btState) => {
    if (btState.status === 'connected' && !pollingActive) {
      startPolling(container);
    } else if (btState.status !== 'connected') {
      pollingActive = false;
    }
  });

  // Açılışta zaten bağlıysa (Faz 1'in sessiz otomatik bağlanması) hemen başlat.
  if (getBluetoothState().status === 'connected') {
    startPolling(container);
  }
}

/**
 * Kaynakları serbest bırakır (bellek sızıntısı önleme).
 */
export function disposeDashboardView() {
  pollingActive = false;
  unsubscribeBtState?.();
  unsubscribeVehicleInfo?.();
}

/**
 * Boş durum metnini kaldırıp her PID için bir <sda-gauge> kartı inşa eder.
 * @param {HTMLElement} container
 */
function buildCards(container) {
  container.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'sda-grid';
  grid.setAttribute('data-dashboard-grid', '');

  for (const config of DASHBOARD_CARDS) {
    const card = document.createElement('div');
    card.className = 'sda-card sda-card--elevated';
    card.setAttribute('data-pid-card', config.pid);
    // Ana hız göstergesi tam genişlik kaplasın diye grid'in dışında, üstte gösterilir.
    if (config.size === 'lg') {
      card.style.gridColumn = '1 / -1';
    }

    const gauge = document.createElement('sda-gauge');
    gauge.setAttribute('label', config.label);
    gauge.setAttribute('unit', config.unit);
    gauge.setAttribute('min', String(config.min));
    gauge.setAttribute('max', String(config.max));
    gauge.setAttribute('size', config.size);
    gauge.setAttribute('value', String(config.min));
    if (config.dangerAbove !== undefined) {
      gauge.setAttribute('danger-above', String(config.dangerAbove));
    }

    card.appendChild(gauge);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

/**
 * Aracın desteklemediği PID'lere ait kartları gizler. Boş liste (henüz
 * keşif yapılmadıysa) durumunda hiçbir kart gizlenmez - kullanıcı bağlantı
 * kurulana kadar tüm kartları (sıfır değerle) görür.
 * @param {HTMLElement} container
 * @param {string[]} supportedPids
 */
function applySupportedPidVisibility(container, supportedPids) {
  if (supportedPids.length === 0) return;

  const cards = container.querySelectorAll('[data-pid-card]');
  cards.forEach((card) => {
    const pid = card.getAttribute('data-pid-card');
    card.hidden = pid !== '0D' && !supportedPids.includes(pid); // Hız her zaman gösterilir.
  });
}

/**
 * Sürekli poll döngüsünü başlatır. ELM327 yarı çift yönlü olduğundan
 * PID'ler PARALEL değil, ardışık (sıralı await) sorgulanır.
 * @param {HTMLElement} container
 */
async function startPolling(container) {
  pollingActive = true;

  while (pollingActive) {
    for (const config of DASHBOARD_CARDS) {
      if (!pollingActive) break;

      try {
        const result = await queryPid(config.pid);
        if (result) {
          setLivePidValue(config.pid, result.value, result.unit);
          const gauge = container.querySelector(`[data-pid-card="${config.pid}"] sda-gauge`);
          gauge?.setAttribute('value', String(result.value));
        }
      } catch (error) {
        // Tek bir PID zaman aşımına uğrarsa döngünün tamamı durmamalı.
        logWarn('dashboard-view', `PID okunamadı: ${config.pid}`, error);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
