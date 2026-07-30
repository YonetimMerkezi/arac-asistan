/**
 * navigation-map-overlay.js
 * ---------------------------------------------------------------------------
 * Harita üzerindeki iki bağımsız UI parçası: canlı hız/hız-sınırı kartı ve
 * tam ekran geçiş düğmesi.
 *
 * navigation-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya
 * başına maks. 500 satır) - bu ikisi "haritanın üzerinde ne gösterilir"
 * ile ilgilenir, navigation-view.js ise haritanın kendisini/POI'yi yönetir.
 *
 * DÜZELTME (kritik hata): Önceki sürüm tam ekran konumlandırmasını (hız
 * kartının haritanın üzerinde kayan bir overlay olması) SALT CSS'e
 * bırakıyordu - kullanıcı "tam ekranda hızlar görünmüyor" bildirdi. Artık
 * konumlandırma doğrudan JS ile (inline stil) uygulanıyor - CSS
 * kademesi/özgüllüğü belirsizliğine yer bırakmıyor, davranış kesin.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { iconMarkup } from './icons.js';
import { onPosition } from '../core/gps-tracker.js';
import { getSpeedLimitNear } from '../maps/speed-limit-service.js';
import { getLivePidValue, onLiveDataChange } from '../core/vehicle-live-data-store.js';
import { isNavFullscreen, setNavFullscreen, onNavFullscreenChange } from '../core/nav-fullscreen-state.js';

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
 * Tam ekran düğmesini (ve fiziksel geri tuşuyla da tetiklenebilen paylaşılan
 * tam ekran durumunu) bağlar.
 *
 * Konumlandırma JS İLE DOĞRUDAN uygulanır (CSS sınıfına güvenilmez):
 *  - hız kartı, konumu KORUNARAK harita sarmalayıcısına TAŞINIR ve inline
 *    stille üstte sabitlenir,
 *  - durum satırı (rota özeti) alta sabitlenir,
 *  - üst bar/alt gezinme çubuğu body sınıfıyla gizlenir (bunlar basit
 *    display:none olduğu için CSS'e bırakılması güvenli).
 * @param {HTMLElement} container
 * @param {import('leaflet').Map} map
 */
export function bindFullscreenToggle(container, map) {
  const button = container.querySelector('[data-fullscreen-toggle]');
  const mapWrapper = container.querySelector('[data-map-wrapper]');
  const speedCard = container.querySelector('[data-speed-card]');
  const statusEl = container.querySelector('[data-status]');
  if (!button || !mapWrapper || !speedCard) return;

  const originalSpeedCardNextSibling = speedCard.nextSibling;
  const originalSpeedCardParent = speedCard.parentElement;
  const originalStatusStyle = statusEl?.getAttribute('style') ?? '';

  const applyState = (fullscreen) => {
    document.body.classList.toggle('sda-fullscreen-nav', fullscreen);

    if (fullscreen) {
      mapWrapper.prepend(speedCard);
      // JS İLE DOĞRUDAN konumlandırma - CSS kademesine/özgüllüğüne bağlı değil.
      speedCard.style.cssText = 'position:absolute; top:12px; left:12px; right:12px; z-index:600; margin:0; box-shadow:var(--sda-shadow-elevated);';
      if (statusEl) {
        statusEl.style.cssText = 'position:absolute; bottom:12px; left:12px; right:12px; z-index:600; margin:0; background:var(--sda-bg-elevated); padding:8px 12px; border-radius:var(--sda-radius-sm);';
      }
      button.innerHTML = iconMarkup('fullscreen-exit', { size: 22 });
      button.style.zIndex = '600';
    } else {
      if (originalSpeedCardNextSibling) {
        originalSpeedCardParent.insertBefore(speedCard, originalSpeedCardNextSibling);
      } else {
        originalSpeedCardParent.appendChild(speedCard);
      }
      speedCard.style.cssText = 'display:flex; align-items:center; justify-content:space-around; margin-bottom:8px;';
      if (statusEl) statusEl.setAttribute('style', originalStatusStyle);
      button.innerHTML = iconMarkup('fullscreen', { size: 22 });
    }

    // Leaflet, konteyner boyutu CSS ile değişince bunu KENDİLİĞİNDEN fark
    // etmez - boyut geçişi bitince (bir sonraki "frame") yeniden ölçmesi
    // gerektiğini açıkça söylemek gerekir, yoksa harita eski boyutunda/yanlış
    // konumlanmış kalır.
    requestAnimationFrame(() => map?.invalidateSize());
  };

  button.addEventListener('click', () => {
    setNavFullscreen(!isNavFullscreen());
  });

  onNavFullscreenChange(applyState);
  applyState(isNavFullscreen()); // Ekrana ilk girişte (ör. geri tuşuyla tam ekrandan çıkılmış olabilir) tutarlı başlangıç durumu.
}

/**
 * Uydu görünümü düğmesini bağlar - Esri'nin ücretsiz, API anahtarı
 * gerektirmeyen görüntü servisi (yalnızca düğmeye basılınca yüklenir,
 * varsayılan katman hâlâ sokak haritasıdır - gereksiz veri kullanımı olmasın).
 * @param {HTMLElement} container
 * @param {import('leaflet').Map} map
 * @param {import('leaflet').TileLayer} streetLayer - Zaten haritaya eklenmiş sokak katmanı.
 */
export function bindSatelliteToggle(container, map, streetLayer) {
  const satelliteButton = container.querySelector('[data-satellite-toggle]');
  if (!satelliteButton) return;

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Kaynak: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  });

  let satelliteActive = false;
  satelliteButton.addEventListener('click', () => {
    satelliteActive = !satelliteActive;
    if (satelliteActive) {
      map.removeLayer(streetLayer);
      satelliteLayer.addTo(map);
      satelliteButton.innerHTML = iconMarkup('map', { size: 20 });
    } else {
      map.removeLayer(satelliteLayer);
      streetLayer.addTo(map);
      satelliteButton.innerHTML = iconMarkup('satellite', { size: 20 });
    }
  });
}
