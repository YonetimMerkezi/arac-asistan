/**
 * navigation-fuel-panel.js
 * ---------------------------------------------------------------------------
 * Harita ekranındaki "Yakıt" kategorisinin TÜM zengin davranışı burada
 * toplanır: marka filtre sekmeleri, markaya göre RENKLİ işaretçiler, bir
 * istasyona dokununca açılan "Marka Ata + Kaydet + fiyat tablosu" modalı, ve
 * bölgedeki TÜM dağıtıcıları gösteren bağımsız fiyat tablosu.
 *
 * navigation-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya başına
 * maks. 500 satır) - navigasyon ekranı yalnızca haritayı/favorileri/rotayı
 * yönetir, bu dosya yalnızca "Yakıt" panelini. İkisi arasındaki tek bağlantı
 * navigation-view.js'in bu dosyanın export ettiği fonksiyonları çağırmasıdır
 * (Single Responsibility - her dosya kendi kaygısını taşır).
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { matchStationByName, getProvinceFuelPrices } from '../maps/fuel-price-service.js';
import { getFuelStationCache } from '../maps/fuel-station-cache.js';
import { isFavoriteBrand, toggleFavoriteBrand } from '../core/favorite-brands-store.js';
import { getAssignedBrand, assignBrand } from '../maps/station-brand-store.js';
import { setPendingFuelSelection } from '../core/pending-fuel-selection.js';
import { navigateTo } from '../core/view-router.js';
import { brandBadgeMarkup, brandMarkerMarkup, brandColor } from './components/brand-badge.js';
import { openModal } from './components/modal.js';
import { iconMarkup } from './icons.js';

/** @type {import('leaflet').Marker[]} Yalnızca bu panelin çizdiği işaretçiler (navigation-view.js'in genel POI işaretçilerinden ayrı). */
let fuelMarkers = [];

/** @type {string|null} Seçili marka filtresi (null = Tümü). */
let selectedBrandFilter = null;

/**
 * Bir kategori değişiminde (ör. Yakıt'tan Otopark'a geçilirken) çağrılmalıdır -
 * bu panelin işaretçilerini haritadan kaldırır ve filtre seçimini sıfırlar.
 * @param {import('leaflet').Map} map
 */
export function clearFuelPanel(map) {
  fuelMarkers.forEach((m) => map.removeLayer(m));
  fuelMarkers = [];
  selectedBrandFilter = null;
}

/**
 * Yakıt panelinin TAMAMINI (filtre sekmeleri + işaretçiler + liste + bölge
 * fiyat tablosu) çizer. Hem canlı arama hem önbellek güncellemesi yolundan
 * çağrılabilir (kod tekrarını önler).
 * @param {Object} args
 * @param {import('leaflet').Map} args.map
 * @param {HTMLElement} args.container - navigation-view.js'in ana konteyneri.
 * @param {import('../maps/poi-search.js').PoiResult[]} args.results
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} args.prices
 * @param {{il: string, ilce: string}|null} args.location
 */
export function renderFuelPanel({ map, container, results, prices, location }) {
  const listEl = container.querySelector('[data-poi-list]');
  const priceTableEl = container.querySelector('[data-price-table]');
  const statusEl = container.querySelector('[data-status]');
  const filterEl = container.querySelector('[data-brand-filter]');

  const rerender = () => renderFuelPanel({ map, container, results, prices, location });

  renderBrandFilterTabs(filterEl, prices, rerender);

  const filtered = selectedBrandFilter
    ? results.filter((poi) => sameBrand(resolveStationBrand(poi, prices), selectedBrandFilter))
    : results;

  renderMarkersAndList({ map, filtered, prices, listEl, statusEl, location, onChange: rerender });

  // Bölgedeki TÜM dağıtıcıların fiyatı - haritadaki yakın istasyonlarla
  // eşleştirmeye ÇALIŞMADAN, bağımsız bir "tüm firmalar" tablosu. OSM'deki
  // marka etiketleri çoğu istasyonda eksik olduğu için bu, "en azından
  // bölgedeki tüm fiyatları güvenilir şekilde gör" ihtiyacını karşılar.
  if (priceTableEl && location && prices.some((p) => p.benzin !== null)) {
    renderRegionPriceTable(priceTableEl, prices.filter((p) => p.benzin !== null), location);
  }
}

/**
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
function sameBrand(a, b) {
  if (!a || !b) return false;
  return a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr');
}

/**
 * Bir istasyon için gösterilecek markayı belirler - sırasıyla: kullanıcının
 * elle atadığı marka (station-brand-store) > OSM'in kendi "brand" etiketi >
 * istasyon adında geçen markayla fiyat listesi eşleşmesi (ör. adı "Opet
 * Elazığ Merkez" ama brand etiketi eksikse bile Opet olarak çözülür).
 * @param {import('../maps/poi-search.js').PoiResult} poi
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} prices
 * @returns {string|null}
 */
function resolveStationBrand(poi, prices) {
  const manual = poi.id !== null && poi.id !== undefined ? getAssignedBrand(poi.id) : null;
  if (manual) return manual;
  if (poi.brand) return poi.brand;
  return matchStationByName(prices, poi.name)?.dagitici ?? null;
}

/**
 * "Tümü" + bölgedeki her markanın kendi renginde bir filtre sekmesini çizer.
 * Bir sekmeye dokunmak yalnızca haritadaki/listedeki YAKIN istasyonları
 * filtreler - alttaki "tüm firmalar" fiyat tablosu her zaman TAM kalır.
 * @param {HTMLElement|null} filterEl
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} prices
 * @param {() => void} onChange
 */
function renderBrandFilterTabs(filterEl, prices, onChange) {
  if (!filterEl) return;
  if (prices.length === 0) {
    filterEl.innerHTML = '';
    return;
  }

  const brands = [...new Set(prices.map((p) => p.dagitici))].sort((a, b) => a.localeCompare(b, 'tr'));

  const tabs = [
    { label: 'Tümü', brand: null, color: 'var(--sda-bg-elevated-hover)', textColor: 'var(--sda-text-primary)' },
    ...brands.map((brand) => ({ label: brand, brand, color: brandColor(brand), textColor: '#FFFFFF' })),
  ];

  filterEl.innerHTML = tabs.map((tab) => `
    <button type="button" data-brand-tab="${tab.brand ?? ''}" class="sda-chip"
      aria-current="${selectedBrandFilter === tab.brand}"
      style="background:${selectedBrandFilter === tab.brand ? tab.color : 'var(--sda-bg-elevated)'};
             color:${selectedBrandFilter === tab.brand ? tab.textColor : 'var(--sda-text-muted)'};">
      ${tab.label}
    </button>
  `).join('');

  filterEl.querySelectorAll('[data-brand-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const value = tab.getAttribute('data-brand-tab');
      selectedBrandFilter = value || null;
      onChange();
    });
  });
}

/**
 * Yakıt işaretçilerini (markaya göre RENKLİ) ve liste satırlarını çizer.
 * Bir işaretçiye/satıra dokununca marka atama + fiyat modalı açılır.
 * @param {Object} args
 * @param {import('leaflet').Map} args.map
 * @param {import('../maps/poi-search.js').PoiResult[]} args.filtered
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} args.prices
 * @param {HTMLElement|null} args.listEl
 * @param {HTMLElement|null} args.statusEl
 * @param {{il: string, ilce: string}|null} args.location
 * @param {() => void} args.onChange - Marka ataması değişince listeyi yeniden çizmek için.
 */
function renderMarkersAndList({ map, filtered, prices, listEl, statusEl, location, onChange }) {
  fuelMarkers.forEach((m) => map.removeLayer(m));

  fuelMarkers = filtered.slice(0, 15).map((poi) => {
    const brand = resolveStationBrand(poi, prices);
    const marker = L.marker([poi.lat, poi.lon], {
      icon: L.divIcon({ className: 'sda-brand-marker', html: brandMarkerMarkup(brand), iconSize: [30, 30], iconAnchor: [15, 30] }),
    }).addTo(map);
    marker.on('click', () => openStationModal({ poi, prices, location, onSaved: onChange }));
    return marker;
  });

  if (listEl) {
    if (filtered.length === 0) {
      listEl.innerHTML = '';
    } else {
      listEl.innerHTML = filtered.slice(0, 15).map((poi, index) => {
        const brand = resolveStationBrand(poi, prices);
        const price = matchStationByName(prices, brand ?? poi.name);
        const priceLine = price
          ? `Benzin ${price.benzin ?? '-'} ₺ · Motorin ${price.motorin ?? '-'} ₺${price.lpg ? ` · LPG ${price.lpg} ₺` : ''}`
          : 'Fiyat bilgisi yok';
        return `
          <button type="button" data-fuel-row="${index}" class="sda-card" style="display:flex; align-items:center; gap:10px; width:100%; text-align:left; margin-bottom:6px; border:none;">
            ${brandBadgeMarkup(brand, { size: 34 })}
            <span style="flex:1; min-width:0;">
              <span class="sda-card__value" style="font-size:0.92rem; display:block;">${poi.name}</span>
              <span class="sda-card__label" style="margin:2px 0 0 0; display:block;">${priceLine}</span>
            </span>
            <span class="sda-card__label" style="white-space:nowrap;">${poi.distanceKm.toFixed(1)} km</span>
          </button>
        `;
      }).join('');

      listEl.querySelectorAll('[data-fuel-row]').forEach((row) => {
        row.addEventListener('click', () => {
          const index = Number(row.getAttribute('data-fuel-row'));
          const poi = filtered[index];
          if (!poi) return;
          map.setView([poi.lat, poi.lon], 16);
          openStationModal({ poi, prices, location, onSaved: onChange });
        });
      });
    }
  }

  if (filtered.length > 0) {
    const bounds = L.latLngBounds(filtered.slice(0, 15).map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }

  if (statusEl) {
    statusEl.textContent = filtered.length > 0
      ? `${filtered.length} sonuç bulundu, en yakını ${filtered[0].distanceKm.toFixed(1)} km`
      : 'Bu bölgede OpenStreetMap üzerinde kayıtlı sonuç bulunamadı.';
  }
}

/**
 * Bir istasyona dokununca açılan alt-sayfa: istasyon adı, mevcut çözülen
 * marka, elle marka atama açılır menüsü + Kaydet, ve o markanın güncel
 * fiyat tablosu ("İstasyona tıkla, markayı ildeki firmalardan seç, kaydet"
 * akışı).
 * @param {Object} args
 * @param {import('../maps/poi-search.js').PoiResult} args.poi
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} args.prices
 * @param {{il: string, ilce: string}|null} args.location
 * @param {() => void} args.onSaved - Marka kaydedildikten sonra haritayı/listeyi yeniden çizmek için.
 */
function openStationModal({ poi, prices, location, onSaved }) {
  // DÜZELTME: `prices` parametresi, bu modalı açan işaretçi HANGİ ANDA
  // oluşturulduysa o andaki fiyat listesinin bir kopyasıdır (closure) -
  // önbellek daha sonra tazelenmiş olsa bile (ör. bir markanın fiyatı biraz
  // geç gelmişse) bu eski kopya değişmez. Marka atama listesi bu yüzden
  // bazen "Bölgedeki Yakıt Fiyatları" tablosunda (her zaman ANLIK önbellekten
  // okur) görünen bir markayı içermeyebiliyordu. Çözüm: pencere açılırken
  // önbellekten TAZE bir okuma yap, doluysa onu kullan.
  const freshCache = getFuelStationCache();
  // Bu diziyi (ilçe-bazlı liste + varsa il geneli genişletmesi) SONRADAN
  // güncelleyebilmek için `let` - province verisi asenkron gelince buraya eklenir.
  let currentPrices = freshCache.prices.length > 0 ? freshCache.prices : prices;

  const currentBrand = resolveStationBrand(poi, currentPrices);
  const brandOptionsFrom = (list) => [...new Set(list.map((p) => p.dagitici))].sort((a, b) => a.localeCompare(b, 'tr'));

  const bodyHtml = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:var(--sda-space-4);">
      <span data-station-badge>${brandBadgeMarkup(currentBrand, { size: 44 })}</span>
      <div>
        <p class="sda-card__value" style="font-size:1rem; margin:0;">${poi.name}</p>
        <p class="sda-card__label" style="margin:2px 0 0 0;">${poi.distanceKm.toFixed(1)} km uzaklıkta</p>
      </div>
    </div>

    <p class="sda-card__label" style="margin-bottom:6px;">Marka Ata</p>
    <div style="display:flex; gap:8px; margin-bottom:4px;">
      <select data-brand-select class="sda-select" style="flex:1;">
        <option value="">Marka seç...</option>
        ${brandOptionsFrom(currentPrices).map((b) => `<option value="${b}" ${sameBrand(b, currentBrand) ? 'selected' : ''}>${b}</option>`).join('')}
      </select>
      <button type="button" data-save-brand class="sda-btn sda-btn--primary">Kaydet</button>
    </div>
    <p data-save-feedback class="sda-card__label" style="margin:0 0 var(--sda-space-4) 0; min-height:1em;"></p>

    <p class="sda-card__label" style="margin-bottom:6px;">Güncel Fiyat Tablosu</p>
    <div data-modal-price-list></div>

    <button type="button" data-modal-refuel class="sda-btn sda-btn--secondary" style="width:100%; margin-top:var(--sda-space-4);">
      ${iconMarkup('fuel', { size: 18 })} Yakıt Al
    </button>
  `;

  openModal({ title: 'Akaryakıt İstasyonu', bodyHtml, onMount: (body) => {
    renderModalPriceList(body.querySelector('[data-modal-price-list]'), currentPrices, currentBrand);

    // İlçenin fiyat listesinde olmayan bir marka, ilin BAŞKA bir ilçesinde
    // raporlanıyor olabilir (ör. bir ilçede Opet yoksa ama ilin genelinde
    // varsa). Modal açılışını YAVAŞLATMAMAK için bu genişletme arka planda
    // yapılır; yeni marka bulunursa seçim listesine ve fiyat tablosuna
    // sessizce eklenir.
    if (location?.il) {
      getProvinceFuelPrices(location.il).then((province) => {
        const bilinenler = new Set(currentPrices.map((p) => p.dagitici));
        const yeniler = province.filter((p) => !bilinenler.has(p.dagitici));
        if (yeniler.length === 0) return;

        currentPrices = [...currentPrices, ...yeniler];

        const select = body.querySelector('[data-brand-select]');
        if (select) {
          for (const y of yeniler) {
            const opt = document.createElement('option');
            opt.value = y.dagitici;
            opt.textContent = `${y.dagitici} (il geneli)`;
            select.appendChild(opt);
          }
        }
        renderModalPriceList(body.querySelector('[data-modal-price-list]'), currentPrices, currentBrand);
      }).catch(() => {}); // Yedek JSON'a da ulaşılamıyorsa sessizce vazgeç - ilçe listesi zaten gösteriliyor.
    }

    body.querySelector('[data-save-brand]')?.addEventListener('click', async () => {
      const select = body.querySelector('[data-brand-select]');
      const chosen = select?.value || null;
      if (!chosen || poi.id === null || poi.id === undefined) return;

      await assignBrand(poi.id, chosen);

      // DÜZELTME: onSaved() yalnızca ARKA PLANDAKİ haritayı/listeyi
      // yeniliyordu - bu modal kapanıp yeniden açılmadığı için üstteki
      // rozet ("?") kaydettikten sonra da eskisi gibi kalıyor, kaydetmemiş
      // gibi bir izlenim veriyordu. Şimdi modalın kendi rozeti/fiyat
      // tablosu da YERİNDE güncelleniyor.
      const badgeContainer = body.querySelector('[data-station-badge]');
      if (badgeContainer) badgeContainer.innerHTML = brandBadgeMarkup(chosen, { size: 44 });
      renderModalPriceList(body.querySelector('[data-modal-price-list]'), currentPrices, chosen);

      const feedback = body.querySelector('[data-save-feedback]');
      if (feedback) {
        feedback.textContent = `✓ "${chosen}" olarak kaydedildi.`;
        feedback.style.color = 'var(--sda-success, #2a9d5c)';
      }

      onSaved();
    });

    body.querySelector('[data-modal-refuel]')?.addEventListener('click', () => {
      const select = body.querySelector('[data-brand-select]');
      const brand = select?.value || currentBrand;
      if (brand) startRefuel(brand);
    });
  } });
}

/**
 * Modal içindeki fiyat listesini çizer - seçili/çözülen marka en üstte ve
 * vurgulu, diğerleri altında.
 * @param {HTMLElement|null} listEl
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} prices
 * @param {string|null} highlightBrand
 */
function renderModalPriceList(listEl, prices, highlightBrand) {
  if (!listEl) return;
  const ordered = [...prices].sort((a, b) => {
    const aHi = sameBrand(a.dagitici, highlightBrand) ? -1 : 0;
    const bHi = sameBrand(b.dagitici, highlightBrand) ? -1 : 0;
    return aHi - bHi || (a.benzin ?? Infinity) - (b.benzin ?? Infinity);
  });

  listEl.innerHTML = ordered.map((s) => `
    <div class="sda-card" style="display:flex; align-items:center; gap:10px; margin-bottom:6px;
      ${sameBrand(s.dagitici, highlightBrand) ? 'border-color:' + brandColor(s.dagitici) + '; border-width:2px;' : ''}">
      ${brandBadgeMarkup(s.dagitici, { size: 30 })}
      <span class="sda-card__value" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.9rem;">${s.dagitici}</span>
      <span class="sda-card__label" style="text-align:right;">Benzin ${s.benzin ?? '-'} ₺<br>Motorin ${s.motorin ?? '-'} ₺<br>LPG ${s.lpg ?? '-'} ₺</span>
    </div>
  `).join('');
}

/**
 * "Yakıt Al" akışını başlatır: bir sonraki Yakıt ekranı açılışında bu
 * markanın (varsayılan Benzin) fiyatının otomatik dolması için bekleyen
 * seçimi kaydeder ve ekranı değiştirir.
 * @param {string} brand
 */
function startRefuel(brand) {
  setPendingFuelSelection(brand, 'benzin');
  navigateTo('fuel');
}

/**
 * Konumun il/ilçesindeki TÜM dağıtıcıların güncel fiyatlarını renkli marka
 * rozetleri, kutulanmış Benzin/Motorin/LPG değerleri ve her satırda bir
 * "Yakıt Al" düğmesiyle gösterir. Favori markalar (varsa) en üstte, geri
 * kalanı fiyata göre (ucuzdan pahalıya) sıralanır.
 * @param {HTMLElement} priceTableEl
 * @param {import('../maps/fuel-price-service.js').FuelStationPrice[]} stations
 * @param {{il: string, ilce: string}} location
 */
export function renderRegionPriceTable(priceTableEl, stations, location) {
  const favorites = stations.filter((s) => isFavoriteBrand(s.dagitici))
    .sort((a, b) => a.dagitici.localeCompare(b.dagitici, 'tr'));
  const others = stations.filter((s) => !isFavoriteBrand(s.dagitici))
    .sort((a, b) => (a.benzin ?? Infinity) - (b.benzin ?? Infinity));
  const ordered = [...favorites, ...others];

  priceTableEl.innerHTML = `
    <p class="sda-card__label">${location.il} / ${location.ilce} - Tüm Firmaların Yakıt Fiyatları</p>
    ${ordered.map((s) => `
      <div class="sda-card sda-card--elevated" style="margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
          ${brandBadgeMarkup(s.dagitici, { size: 36 })}
          <span class="sda-card__value" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:1rem;">${s.dagitici}</span>
          <button type="button" data-fav-brand="${s.dagitici}" style="background:none; border:none; font-size:1.2rem; padding:0; flex-shrink:0;" aria-label="Favori">
            ${isFavoriteBrand(s.dagitici) ? '⭐' : '☆'}
          </button>
          <button type="button" data-refuel-brand="${s.dagitici}" class="sda-btn sda-btn--secondary" style="padding:6px 10px; flex-shrink:0;" aria-label="Yakıt Al">
            ${iconMarkup('fuel', { size: 18 })}
          </button>
        </div>
        <div style="display:flex; gap:8px;">
          <div class="sda-fuel-box"><span class="sda-fuel-box__label">Benzin</span><span class="sda-fuel-box__value">${s.benzin ?? '-'} ₺</span></div>
          <div class="sda-fuel-box"><span class="sda-fuel-box__label">Motorin</span><span class="sda-fuel-box__value">${s.motorin ?? '-'} ₺</span></div>
          <div class="sda-fuel-box"><span class="sda-fuel-box__label">LPG</span><span class="sda-fuel-box__value">${s.lpg ?? '-'} ₺</span></div>
        </div>
      </div>
    `).join('')}
  `;

  priceTableEl.querySelectorAll('[data-fav-brand]').forEach((starBtn) => {
    starBtn.addEventListener('click', async () => {
      await toggleFavoriteBrand(starBtn.getAttribute('data-fav-brand'));
      renderRegionPriceTable(priceTableEl, stations, location); // favori değişti, yeniden sırala.
    });
  });

  priceTableEl.querySelectorAll('[data-refuel-brand]').forEach((btn) => {
    btn.addEventListener('click', () => startRefuel(btn.getAttribute('data-refuel-brand')));
  });
}
