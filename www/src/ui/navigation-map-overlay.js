/**
 * navigation-map-overlay.js
 * ---------------------------------------------------------------------------
 * Harita üzerindeki iki bağımsız UI parçası: canlı hız/hız-sınırı kartı ve
 * tam ekran geçiş düğmesi.
 *
 * navigation-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya
 * başına maks. 500 satır) - bu ikisi "haritanın üzerinde ne gösterilir"
 * ile ilgilenir, navigation-view.js ise haritanın kendisini/POI'yi yönetir.
 * ---------------------------------------------------------------------------
 */

import { iconMarkup } from './icons.js';
import { onPosition } from '../core/gps-tracker.js';
import { getSpeedLimitNear } from '../maps/speed-limit-service.js';
import { getLivePidValue, onLiveDataChange } from '../core/vehicle-live-data-store.js';

/** @type {(() => void)|null} */
let unsubscribeSpeedLimit = null;

/**
 * Canlı hız kartını hem OBD (araç beyni) hem GPS kaynağından besler - GPS
 * hızı limitle karşılaştırılır (speed-warning.js zaten sesli uyarıyor, bu
 * yalnızca GÖRSEL karşılığı; ayrı bir ağ isteği YAPMAZ, aynı önbelleği okur).
 *
 * OBD hızı için AYRI bir sorgu ATILMAZ - dashboard-view.js zaten PID 0D'yi
 * sürekli okuyor (Panel açık olmasa bile, bağlantı sürdüğü sürece); burada
 * yalnızca o paylaşılan sonucu (vehicle-live-data-store.js) okunur - aksi
 * halde aynı komut kuyruğuna gereksiz ikinci bir tüketici eklenmiş olurdu.
 * @param {HTMLElement} container
 */
export function bindLiveSpeedLimitCard(container) {
  unsubscribeSpeedLimit?.();

  const updateObdSpeed = () => {
    const obdEl = container.querySelector('[data-live-speed-obd]');
    if (!obdEl) return;
    const cached = getLivePidValue('0D');
    obdEl.textContent = cached ? String(Math.round(cached.value)) : '--';
  };

  updateObdSpeed();
  const unsubscribeObd = onLiveDataChange(updateObdSpeed);

  const unsubscribePosition = onPosition(async (position) => {
    const gpsEl = container.querySelector('[data-live-speed-gps]');
    const limitEl = container.querySelector('[data-live-speed-limit]');
    if (!gpsEl || !limitEl) return;

    gpsEl.textContent = String(Math.round(position.speedKmh));

    const limit = await getSpeedLimitNear(position.latitude, position.longitude);
    limitEl.textContent = limit !== null ? String(limit) : '--';

    const exceeding = limit !== null && position.speedKmh > limit;
    gpsEl.style.color = exceeding ? 'var(--sda-danger)' : 'var(--sda-text-primary)';
  });

  unsubscribeSpeedLimit = () => {
    unsubscribeObd();
    unsubscribePosition();
  };
}

/**
 * Tam ekran harita düğmesini bağlar. "Tam ekran" olunca:
 *  - body'e bir sınıf eklenir (üst bar/alt gezinme çubuğu CSS ile gizlenir),
 *  - hız kartı, konumu KORUNARAK (yeniden çizilmeden) harita sarmalayıcısına
 *    TAŞINIR - böylece haritanın üzerinde kayan bir kart olarak görünür
 *    (bkz. theme.css'teki `body.sda-fullscreen-nav [data-speed-card]` kuralı;
 *    bu kural ancak kart GERÇEKTEN map-wrapper içindeyse işe yarar, çünkü
 *    normalde bulunduğu [data-nav-chrome] tam ekranda `display:none` olur).
 * @param {HTMLElement} container
 * @param {import('leaflet').Map} map
 */
export function bindFullscreenToggle(container, map) {
  const button = container.querySelector('[data-fullscreen-toggle]');
  const mapWrapper = container.querySelector('[data-map-wrapper]');
  const speedCard = container.querySelector('[data-speed-card]');
  if (!button || !mapWrapper || !speedCard) return;

  const originalNextSibling = speedCard.nextSibling;
  const originalParent = speedCard.parentElement;
  let isFullscreen = false;

  button.addEventListener('click', () => {
    isFullscreen = !isFullscreen;
    document.body.classList.toggle('sda-fullscreen-nav', isFullscreen);

    if (isFullscreen) {
      mapWrapper.prepend(speedCard);
      button.innerHTML = iconMarkup('fullscreen-exit', { size: 20 });
    } else {
      if (originalNextSibling) {
        originalParent.insertBefore(speedCard, originalNextSibling);
      } else {
        originalParent.appendChild(speedCard);
      }
      button.innerHTML = iconMarkup('fullscreen', { size: 20 });
    }

    // Leaflet, konteyner boyutu CSS ile değişince bunu KENDİLİĞİNDEN fark
    // etmez - boyut geçişi bitince (bir sonraki "frame") yeniden ölçmesi
    // gerektiğini açıkça söylemek gerekir, yoksa harita eski boyutunda/yanlış
    // konumlanmış kalır.
    requestAnimationFrame(() => map?.invalidateSize());
  });
}
