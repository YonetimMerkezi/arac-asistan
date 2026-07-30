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
import { getVehicleMarkerShape } from '../core/vehicle-marker-preference.js';
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

  /** @type {number|null} En son OBD hız okuması (varsa GPS'e tercih edilir - daha doğrudur). */
  let lastObdSpeed = null;

  /** @type {number|null} En son bilinen yol limiti (renklendirme kararı için). */
  let lastLimit = null;

  const renderSpeed = (gpsSpeedKmh) => {
    const speedEl = container.querySelector('[data-live-speed]');
    if (!speedEl) return;

    const displaySpeed = lastObdSpeed ?? gpsSpeedKmh;
    speedEl.textContent = displaySpeed !== null ? String(Math.round(displaySpeed)) : '--';

    const exceeding = lastLimit !== null && displaySpeed !== null && displaySpeed > lastLimit;
    speedEl.style.color = exceeding ? '#FF5A5F' : '#ffffff'; // Kadranın arka planı (bkz. navigation-view.js) her zaman koyu - tema rengine değil, sabit kontrast rengine bağlı kalınır.
  };

  const updateObdSpeed = () => {
    const cached = getLivePidValue('0D');
    lastObdSpeed = cached ? cached.value : null;
    renderSpeed(null);
  };

  updateObdSpeed();
  const unsubscribeObd = onLiveDataChange(updateObdSpeed);

  const unsubscribePosition = onPosition(async (position) => {
    const limitEl = container.querySelector('[data-live-speed-limit]');

    renderSpeed(position.speedKmh);

    const limit = await getSpeedLimitNear(position.latitude, position.longitude);
    lastLimit = limit;
    if (limitEl) limitEl.textContent = limit !== null ? String(limit) : '--';

    renderSpeed(position.speedKmh); // Limit yeni geldiyse renk kararını tazele.
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
  const summaryEl = container.querySelector('[data-route-summary]');
  if (!button || !mapWrapper || !speedCard) return;

  const originalSpeedCardNextSibling = speedCard.nextSibling;
  const originalSpeedCardParent = speedCard.parentElement;
  const originalStatusStyle = statusEl?.getAttribute('style') ?? '';
  const originalSummaryNextSibling = summaryEl?.nextSibling ?? null;
  const originalSummaryParent = summaryEl?.parentElement ?? null;
  const originalSummaryClass = summaryEl?.getAttribute('class') ?? '';

  // DÜZELTME: Hız kartı önceden haritanın ÜST kısmına, Leaflet'in kendi
  // yakınlaştırma (+/-) düğmeleriyle AYNI köşeye (sol üst) konuyordu -
  // ikisi görsel olarak ÇAKIŞIYORDU. Artık İKİSİ DE (hız kartı + rota
  // özeti) haritanın ALT kısmında, tek bir dikey yığın halinde duruyor -
  // üst-sol köşe tamamen Leaflet'in kendi kontrollerine bırakılıyor.
  const bottomStack = document.createElement('div');
  bottomStack.setAttribute('data-fullscreen-bottom-stack', '');
  bottomStack.style.cssText = 'position:absolute; bottom:12px; left:12px; right:12px; z-index:1500; display:flex; flex-direction:column; align-items:flex-start; gap:8px; pointer-events:none;';

  const applyState = (fullscreen) => {
    document.body.classList.toggle('sda-fullscreen-nav', fullscreen);

    if (fullscreen) {
      mapWrapper.appendChild(bottomStack);
      bottomStack.appendChild(speedCard);
      // Radarbot referansı: iki daire (hız kadranı + limit rozeti) haritanın
      // ÜZERİNDE doğrudan durur, aralarında/etrafında ayrı bir "kart" zemini
      // YOKTUR - önceki sürümdeki dolgulu hap (pill) arka planı kaldırıldı,
      // yalnızca konumlama ve tıklanabilirlik (`pointer-events`) korunuyor.
      speedCard.style.cssText = 'display:flex; align-items:center; gap:10px; margin:0; padding:0; background:transparent; box-shadow:none; pointer-events:auto;';

      if (statusEl) {
        statusEl.style.cssText = 'display:none;'; // Rota özeti kartı görünürken bu satır zaten boş - saklıyoruz.
      }

      if (summaryEl) {
        bottomStack.appendChild(summaryEl);
        summaryEl.removeAttribute('class');
        summaryEl.style.cssText = 'width:100%; margin:0; background:rgba(20,22,28,0.82); backdrop-filter:blur(6px); padding:10px 14px; border-radius:var(--sda-radius-md); pointer-events:auto;';
      }

      button.innerHTML = iconMarkup('fullscreen-exit', { size: 22 });
      button.style.zIndex = '1500';
    } else {
      bottomStack.remove();

      if (originalSpeedCardNextSibling) {
        originalSpeedCardParent.insertBefore(speedCard, originalSpeedCardNextSibling);
      } else {
        originalSpeedCardParent.appendChild(speedCard);
      }
      speedCard.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px;';
      if (statusEl) statusEl.setAttribute('style', originalStatusStyle);

      if (summaryEl && originalSummaryParent) {
        if (originalSummaryNextSibling) {
          originalSummaryParent.insertBefore(summaryEl, originalSummaryNextSibling);
        } else {
          originalSummaryParent.appendChild(summaryEl);
        }
        summaryEl.setAttribute('class', originalSummaryClass);
        summaryEl.style.cssText = summaryEl.dataset.wasVisible === 'true' ? 'display:block; margin-top:8px;' : 'display:none; margin-top:8px;';
      }

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

/**
 * Verilen konuma göre araç işaretçisini oluşturur/günceller - kullanıcının
 * Ayarlar'dan seçtiği şekle (nokta/ok/araba) göre çizilir, ok ve araba
 * şekilleri Google Haritalar'daki gibi araç yönüne göre döner.
 * @param {import('leaflet').Map} map
 * @param {import('leaflet').Marker|null} existingMarker
 * @param {import('../core/gps-tracker.js').LivePosition} position
 * @returns {import('leaflet').Marker}
 */
export function renderVehicleMarker(map, existingMarker, position) {
  const latLng = [position.latitude, position.longitude];
  const heading = position.headingDeg ?? 0;
  const shape = getVehicleMarkerShape();
  const icon = buildVehicleIcon(shape, heading);

  if (!existingMarker) {
    return L.marker(latLng, { icon }).addTo(map);
  }

  existingMarker.setLatLng(latLng);
  existingMarker.setIcon(icon);
  return existingMarker;
}

/**
 * Seçili şekle göre (Google Haritalar'daki gibi yöne dönen) araç
 * işaretçisi ikonu üretir.
 * @param {import('../core/vehicle-marker-preference.js').MarkerShape} shape
 * @param {number} headingDeg
 * @returns {import('leaflet').DivIcon}
 */
function buildVehicleIcon(shape, headingDeg) {
  if (shape === 'dot') {
    return L.divIcon({
      className: 'sda-vehicle-marker',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#FF8A3D;border:2px solid white;"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  if (shape === 'car') {
    return L.divIcon({
      className: 'sda-vehicle-marker',
      html: `<div style="transform:rotate(${headingDeg}deg); transition:transform 200ms linear; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));">${iconMarkup('car', { size: 30 })}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  // 'arrow' (varsayılan, Google Haritalar'ın hareket halindeki oku gibi).
  return L.divIcon({
    className: 'sda-vehicle-marker',
    html: `<div style="width:0; height:0; border-left:9px solid transparent; border-right:9px solid transparent; border-bottom:20px solid var(--sda-accent); transform:rotate(${headingDeg}deg); transition:transform 200ms linear; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));"></div>`,
    iconSize: [18, 20],
    iconAnchor: [9, 10],
  });
}
