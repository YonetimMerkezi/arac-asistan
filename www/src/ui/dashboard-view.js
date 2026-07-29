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
import { mountClockWeatherCard, unmountClockWeatherCard } from './components/clock-weather-card.js';
import { renderEditModePanel } from './dashboard-edit-panel.js';
import { iconMarkup } from './icons.js';
import { queryPid } from '../obd/elm327.js';
import { estimateLitersPerHour, estimateLitersPer100Km } from '../fuel/instant-consumption.js';
import { getWidgetDefinition } from '../obd/widget-registry.js';
import { getState as getBluetoothState, onStateChange } from '../bluetooth/bluetooth-manager.js';
import { getVehicleInfo, onVehicleInfoChange } from '../core/vehicle-info-store.js';
import { setLivePidValue } from '../core/vehicle-live-data-store.js';
import { getUnits, onUnitsChange } from '../core/units-store.js';
import { formatDistanceOrSpeed, formatTemperature } from '../core/unit-conversion.js';
import { getDashboardConfig, onDashboardConfigChange } from '../core/dashboard-config-store.js';
import { logWarn } from '../core/logger.js';

/** @type {number} PID döngüsü tamamlandıktan sonraki bekleme (ms). Çok sık sorgu ELM327'yi tıkar. */
const POLL_INTERVAL_MS = 300;

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
  unmountClockWeatherCard(); // her yeniden çizimden önce eski zamanlayıcı/aboneliği temizle - sızıntı önleme.

  viewContainer.innerHTML = `
    <div data-clock-weather></div>
    <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
      <button type="button" data-toggle-edit class="sda-btn sda-btn--ghost">
        ${editMode ? iconMarkup('done', { size: 18 }) + '<span>Bitti</span>' : iconMarkup('edit', { size: 18 }) + '<span>Düzenle</span>'}
      </button>
    </div>
    <div data-content></div>
  `;

  // Saat/hava durumu kartı Düzenle modunda GÖSTERİLMEZ - o ekran yalnızca
  // widget seçimine odaklanmalı, dikkat dağıtmamalı.
  if (!editMode) {
    const clockContainer = viewContainer.querySelector('[data-clock-weather]');
    if (clockContainer) mountClockWeatherCard(clockContainer);
  }

  viewContainer.querySelector('[data-toggle-edit]')?.addEventListener('click', () => {
    editMode = !editMode;
    render();
  });

  const content = viewContainer.querySelector('[data-content]');
  if (editMode) {
    renderEditModePanel(content, () => viewContainer?.querySelector('[data-content]'));
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
    // DÜZELTME: <sda-gauge> kendi içinde inline-flex olduğu için, kartın
    // kendisi ortalamadıkça geniş (grid) kartlarda sola yapışık duruyordu -
    // "göstergeler ortalı değil" şikayetinin sebebi buydu.
    card.style.cssText = 'display:flex; flex-direction:column; align-items:center; text-align:center; overflow:hidden;';
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
    // DÜZELTME: colorHue null olduğunda (kullanıcı hiç özelleştirmediyse)
    // önceden hiç color-hue özniteliği set edilmiyordu, bu yüzden gösterge
    // temanın TEK genel rengini (--sda-accent) kullanıyordu - "ilk açılışta
    // hepsi aynı renk" şikayetinin sebebi buydu. Artık Düzenle ekranındaki
    // önizlemeyle AYNI mantık: colorHue yoksa widget'ın kendi defaultColorHue'su kullanılır.
    gauge.setAttribute('color-hue', String(instance.colorHue ?? def.defaultColorHue));

    card.appendChild(gauge);
    grid.appendChild(card);
  });

  content.innerHTML = '';
  content.appendChild(grid);
}

/**
 * Aracın desteklemediği PID'lere ait kartları gizler. Boş liste (henüz
 * keşif yapılmadıysa) durumunda hiçbir kart gizlenmez.
 */
function applySupportedPidVisibility() {
  if (!viewContainer || lastSupportedPids.length === 0) return;

  viewContainer.querySelectorAll('[data-pid-card]').forEach((card) => {
    const pid = card.getAttribute('data-pid-card');
    const def = getWidgetDefinition(pid);
    const requiredPids = def?.requiresPids ?? [pid];
    card.hidden = !requiredPids.every((p) => lastSupportedPids.includes(p));
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
        if (def.requiresPids) {
          const calculated = await queryCalculatedWidget(def.pid);
          if (calculated) {
            const gauge = viewContainer?.querySelector(`[data-pid-card="${def.pid}"] sda-gauge`);
            gauge?.setAttribute('value', String(calculated.value));
            gauge?.setAttribute('unit', calculated.unit);
          }
          continue;
        }

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
 * Ham tek bir PID yerine BİRDEN FAZLA PID'den türetilmiş widget değerlerini
 * hesaplar (bkz. obd/widget-registry.js `requiresPids`). Şu an tek türetilmiş
 * widget "Anlık Tüketim" - yeni bir tane eklemek buraya bir dal eklemek kadar basittir.
 * @param {string} pid
 * @returns {Promise<{value: number, unit: string}|null>}
 */
async function queryCalculatedWidget(pid) {
  if (pid !== 'CALC_L100') return null;

  const maf = await queryPid('10');
  const speed = await queryPid('0D');
  if (!maf || !speed) return null;

  const litersPerHour = estimateLitersPerHour(maf.value);
  const per100Km = estimateLitersPer100Km(litersPerHour, speed.value);

  // Araç dururken/rölantideyken L/100km anlamsız (sonsuza yaklaşır) - bu
  // durumda saatlik tüketime (L/h) düşülür, birim de buna göre değişir.
  return per100Km !== null
    ? { value: per100Km, unit: 'L/100km' }
    : { value: litersPerHour, unit: 'L/h' };
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
