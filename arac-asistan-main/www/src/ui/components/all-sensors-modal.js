/**
 * all-sensors-modal.js
 * ---------------------------------------------------------------------------
 * "Tüm Sensörler" alt sayfası: aracın GERÇEKTEN desteklediğini bildirdiği
 * (elm327.js'in Mod 01 PID keşfinden - vehicle-info-store.js) HER PID'i
 * listeler.
 *
 * - pid-definitions.js'te formülü OLAN PID'ler için: isim + CANLI değer
 *   (modal açıkken sürekli güncellenir).
 * - Formülü OLMAYAN (henüz çözülmemiş) PID'ler için: yalnızca ham kodu
 *   gösterir - DEĞER UYDURULMAZ, dürüstçe "henüz çözülmedi" denir.
 * ---------------------------------------------------------------------------
 */

import { getVehicleInfo } from '../../core/vehicle-info-store.js';
import { PID_DEFINITIONS } from '../../obd/pid-definitions.js';
import { queryPid } from '../../obd/elm327.js';
import { openModal } from './modal.js';

/** @type {number} İki tam tur arasındaki bekleme (ms) - dashboard'un poll döngüsüyle aynı hızda. */
const POLL_INTERVAL_MS = 300;

/**
 * "Tüm Sensörler" alt sayfasını açar ve modal açık olduğu sürece sürekli
 * günceller.
 */
export function openAllSensorsModal() {
  const { supportedPids } = getVehicleInfo();

  if (supportedPids.length === 0) {
    openModal({
      title: 'Tüm Sensörler',
      bodyHtml: '<p class="sda-card__label">Araç henüz hangi PID\'leri desteklediğini bildirmedi - önce bağlanıp doğrulanmış olmanız gerekir.</p>',
    });
    return;
  }

  const decodable = supportedPids.filter((pid) => PID_DEFINITIONS[pid]);
  const undecoded = supportedPids.filter((pid) => !PID_DEFINITIONS[pid]);

  const bodyHtml = `
    <p class="sda-card__label" style="margin-bottom:12px;">
      Aracınızın desteklediğini bildirdiği ${supportedPids.length} PID
      (${decodable.length} tanesi çözülüp canlı gösterilebiliyor).
    </p>
    <div data-decodable-list style="margin-bottom:16px;"></div>
    ${undecoded.length > 0 ? `
      <p class="sda-card__label" style="margin-bottom:8px;">Aracın desteklediği ama henüz çözülmemiş PID'ler (ham kod):</p>
      <p style="font-family:var(--sda-font-display); font-size:0.8rem; color:var(--sda-text-muted); word-break:break-all;">
        ${undecoded.join(', ')}
      </p>
    ` : ''}
  `;

  let pollActive = true;

  openModal({ title: 'Tüm Sensörler', bodyHtml, onMount: (body, { root }) => {
    const listEl = body.querySelector('[data-decodable-list]');
    if (listEl) {
      listEl.innerHTML = decodable.map((pid) => `
        <div class="sda-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="sda-card__label">${PID_DEFINITIONS[pid].name} <span style="opacity:0.6;">(${pid})</span></span>
          <span data-sensor-value="${pid}" class="sda-card__value" style="font-size:0.95rem;">--</span>
        </div>
      `).join('');
    }

    root.addEventListener('sda-modal-closed', () => { pollActive = false; }, { once: true });
    void pollLoop(body, decodable, () => pollActive);
  } });
}

/**
 * Çözülebilir PID'leri sırayla (ELM327 yarı çift yönlü olduğu için tek
 * tek) sorgulayıp ekrandaki değerleri günceller - modal kapanana kadar sürer.
 * @param {HTMLElement} body
 * @param {string[]} decodable
 * @param {() => boolean} isActive
 */
async function pollLoop(body, decodable, isActive) {
  while (isActive()) {
    for (const pid of decodable) {
      if (!isActive()) break;

      try {
        const result = await queryPid(pid);
        const valueEl = body.querySelector(`[data-sensor-value="${pid}"]`);
        if (valueEl && result) {
          valueEl.textContent = `${Math.round(result.value * 100) / 100} ${result.unit}`;
        }
      } catch {
        // Tek bir PID okunamazsa döngü durmaz, sıradakine geçilir.
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
