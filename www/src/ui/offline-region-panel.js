/**
 * offline-region-panel.js
 * ---------------------------------------------------------------------------
 * "Bölge İndir" modalı: haritada o an görünen alanı (karo görüntüleri +
 * yakıt/hastane/otopark/servis noktaları) tek pakette indirir, ayrıca daha
 * önce indirilmiş bölgeleri listeler/siler.
 *
 * navigation-view.js'ten BİLİNÇLİ ayrıldı (dosya başına maks. 500 satır
 * standardı) - bu dosya yalnızca modal içeriğini yönetir, harita/karo
 * katmanı navigation-view.js + offline-tile-layer.js'te kalır.
 * ---------------------------------------------------------------------------
 */

import { openModal } from './components/modal.js';
import { downloadRegion } from '../maps/offline-region-download.js';
import { listRegions, deleteRegion } from '../maps/offline-region-store.js';
import { iconMarkup } from './icons.js';

/** @type {number} Bölgeyi "yakınlaşmış" (sürüş) zoom seviyelerinde kullanılabilir kılmak için mevcut zoom'a göre aralık. */
const ZOOM_MARGIN_OUT = 3;
const ZOOM_MARGIN_IN = 2;
const MIN_ALLOWED_ZOOM = 12;
const MAX_ALLOWED_ZOOM = 17;

/**
 * Bölge indirme/yönetim modalını açar.
 * @param {import('leaflet').Map} map
 */
export function openOfflineRegionPanel(map) {
  const bodyHtml = `
    <p class="sda-card__label" style="margin:0 0 10px 0; line-height:1.4;">
      Şu an haritada görünen alanı, o bölgedeki akaryakıt/hastane/otopark/servis
      noktalarıyla birlikte telefona indirir. İnternet olmadan da harita ve bu
      noktalar görünür - ancak fiyatlar ve bölge indirildikten SONRA eklenen
      yeni yerler için hâlâ internet gerekir.
    </p>
    <input type="text" data-region-name placeholder="Bölge adı (ör. Elazığ Merkez)" class="sda-input" style="width:100%; margin-bottom:10px; box-sizing:border-box;" />
    <button type="button" data-download-region class="sda-btn sda-btn--primary" style="width:100%; margin-bottom:8px;">
      ${iconMarkup('download', { size: 18 })} Görünen Alanı İndir
    </button>
    <div data-download-progress style="display:none; margin-bottom:12px;">
      <div style="height:8px; border-radius:4px; background:var(--sda-bg-elevated); overflow:hidden;">
        <div data-progress-bar style="height:100%; width:0%; background:var(--sda-accent); transition:width 150ms linear;"></div>
      </div>
      <p data-progress-label class="sda-card__label" style="margin:6px 0 0 0;">--</p>
    </div>
    <p class="sda-card__label" style="margin:14px 0 6px 0; font-weight:700;">İndirilmiş Bölgeler</p>
    <div data-region-list></div>
  `;

  openModal({ title: 'Bölge İndir (Çevrimdışı)', bodyHtml, onMount: (body) => {
    const nameInput = body.querySelector('[data-region-name]');
    const downloadButton = body.querySelector('[data-download-region]');
    const progressWrap = body.querySelector('[data-download-progress]');
    const progressBar = body.querySelector('[data-progress-bar]');
    const progressLabel = body.querySelector('[data-progress-label]');
    const listEl = body.querySelector('[data-region-list]');

    void renderRegionList(listEl);

    downloadButton?.addEventListener('click', async () => {
      const bounds = map.getBounds();
      const bbox = {
        south: bounds.getSouth(), west: bounds.getWest(),
        north: bounds.getNorth(), east: bounds.getEast(),
      };
      const currentZoom = Math.round(map.getZoom());
      const minZoom = Math.max(currentZoom - ZOOM_MARGIN_OUT, MIN_ALLOWED_ZOOM);
      const maxZoom = Math.min(currentZoom + ZOOM_MARGIN_IN, MAX_ALLOWED_ZOOM);

      downloadButton.disabled = true;
      downloadButton.textContent = 'İndiriliyor...';
      progressWrap.style.display = 'block';
      progressBar.style.width = '0%';
      progressLabel.textContent = 'Karolar hazırlanıyor...';

      const result = await downloadRegion({
        name: nameInput.value,
        bbox,
        minZoom,
        maxZoom,
        onProgress: (progress) => {
          if (progress.phase === 'tiles') {
            const pct = Math.round((progress.completed / progress.total) * 70); // Karolar toplam ilerlemenin ~%70'i.
            progressBar.style.width = `${pct}%`;
            progressLabel.textContent = `Harita karoları indiriliyor: ${progress.completed}/${progress.total}`;
          } else if (progress.phase === 'pois') {
            const pct = 70 + Math.round((progress.completed / progress.total) * 30);
            progressBar.style.width = `${pct}%`;
            progressLabel.textContent = `Yakındaki noktalar taranıyor (${progress.completed}/${progress.total} kategori)...`;
          } else {
            progressBar.style.width = '100%';
            progressLabel.textContent = 'Tamamlandı.';
          }
        },
      });

      downloadButton.disabled = false;
      downloadButton.innerHTML = `${iconMarkup('download', { size: 18 })} Görünen Alanı İndir`;

      if (!result.ok) {
        progressLabel.textContent = `Hata: ${result.error}`;
        return;
      }

      progressLabel.textContent = `"${result.region.name}" indirildi: ${result.region.tileCount} karo, ${result.region.poiCount} nokta.`;
      nameInput.value = '';
      await renderRegionList(listEl);
    });
  } });
}

/**
 * @param {HTMLElement|null} listEl
 */
async function renderRegionList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '<p class="sda-card__label">Yükleniyor...</p>';

  const regions = await listRegions();
  if (regions.length === 0) {
    listEl.innerHTML = '<p class="sda-card__label">Henüz indirilmiş bölge yok.</p>';
    return;
  }

  listEl.innerHTML = regions.map((region) => `
    <div class="sda-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <span>
        <span class="sda-card__value" style="font-size:0.9rem; display:block;">${region.name}</span>
        <span class="sda-card__label">${region.tileCount} karo · ${region.poiCount} nokta · ${formatDate(region.downloadedAt)}</span>
      </span>
      <button type="button" data-delete-region="${region.id}" class="sda-nav-btn" style="background:var(--sda-danger-soft); padding:6px;">
        ${iconMarkup('delete', { size: 18 })}
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-delete-region]').forEach((button) => {
    button.addEventListener('click', async () => {
      const regionId = button.getAttribute('data-delete-region');
      button.setAttribute('disabled', 'true');
      await deleteRegion(regionId);
      await renderRegionList(listEl);
    });
  });
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
