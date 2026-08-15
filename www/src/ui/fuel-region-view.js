/**
 * fuel-region-view.js
 * ---------------------------------------------------------------------------
 * "İl/İlçe Seç" alt sayfası: kullanıcının GPS konumundan BAĞIMSIZ olarak,
 * Türkiye'nin herhangi bir il/ilçesindeki akaryakıt fiyatlarını görmesini
 * sağlar (ör. gideceği şehirdeki fiyatları önceden kontrol etmek için).
 *
 * Fiyat tablosunun kendisi navigation-fuel-panel.js'teki
 * renderRegionPriceTable() ile AYNI fonksiyonu kullanır - iki ekranın farklı
 * fiyat kartı tasarımına sahip olması (kod tekrarı + tutarsızlık riski)
 * yerine, konum kaynağı (GPS vs. elle seçim) farklı, GÖRÜNÜM aynı.
 * ---------------------------------------------------------------------------
 */

import { listProvinces, listDistricts } from '../data/turkey-provinces.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { renderRegionPriceTable } from './navigation-fuel-panel.js';
import { openModal } from './components/modal.js';

/**
 * İl/İlçe seçme + fiyat gösterme alt sayfasını açar.
 */
export function openFuelRegionPicker() {
  const provinces = listProvinces();

  const bodyHtml = `
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <select data-province-select class="sda-select" style="flex:1;">
        <option value="">İl seç...</option>
        ${provinces.map((p) => `<option value="${p}">${p}</option>`).join('')}
      </select>
      <select data-district-select class="sda-select" style="flex:1;" disabled>
        <option value="">Önce il seç</option>
      </select>
    </div>
    <button type="button" data-show-prices class="sda-btn sda-btn--primary" style="width:100%; margin-bottom:12px;" disabled>
      Fiyatları Göster
    </button>
    <div data-region-price-table></div>
  `;

  openModal({ title: 'İl/İlçe Seç', bodyHtml, onMount: (body) => {
    const provinceSelect = body.querySelector('[data-province-select]');
    const districtSelect = body.querySelector('[data-district-select]');
    const showButton = body.querySelector('[data-show-prices]');
    const priceTableEl = body.querySelector('[data-region-price-table]');

    provinceSelect?.addEventListener('change', () => {
      const districts = listDistricts(provinceSelect.value);
      districtSelect.disabled = districts.length === 0;
      districtSelect.innerHTML = districts.length > 0
        ? `<option value="">İlçe seç...</option>${districts.map((d) => `<option value="${d}">${d}</option>`).join('')}`
        : '<option value="">Önce il seç</option>';
      showButton.disabled = true;
      priceTableEl.innerHTML = '';
    });

    districtSelect?.addEventListener('change', () => {
      showButton.disabled = !districtSelect.value;
    });

    showButton?.addEventListener('click', async () => {
      const il = provinceSelect.value;
      const ilce = districtSelect.value;
      if (!il || !ilce) return;

      showButton.disabled = true;
      showButton.textContent = 'Yükleniyor...';
      priceTableEl.innerHTML = '';

      await gosterVeyaTazele(false);

      showButton.disabled = false;
      showButton.textContent = 'Fiyatları Göster';

      /**
       * Seçilen il/ilçe için fiyatları çeker ve tabloyu çizer - GPS'e değil,
       * kullanıcının BURADA seçtiği bölgeye bağlıdır. "Güncelle" düğmesi
       * (renderRegionPriceTable içindeki onRefresh) forceRefresh=true ile
       * bunu tekrar çağırır (10 dakikalık dahili önbelleği yoksayarak).
       * @param {boolean} forceRefresh
       */
      async function gosterVeyaTazele(forceRefresh) {
        const stations = await getFuelPrices(il, ilce, undefined, forceRefresh);
        const withPrices = stations.filter((s) => s.benzin !== null);

        if (withPrices.length === 0) {
          priceTableEl.innerHTML = '<p class="sda-card__label">Bu bölge için fiyat verisi bulunamadı.</p>';
          return;
        }
        renderRegionPriceTable(priceTableEl, withPrices, { il, ilce }, stations, Date.now(), () => gosterVeyaTazele(true));
      }
    });
  } });
}
