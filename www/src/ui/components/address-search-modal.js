/**
 * address-search-modal.js
 * ---------------------------------------------------------------------------
 * "Nereye gidiyorsun?" alt sayfası: kullanıcı bir adres/yer adı yazar,
 * yazarken önerileri görür (autocomplete), birini seçince o noktaya rota
 * çizilir.
 *
 * ÖNCEKİ DURUM: Navigasyon ekranı yalnızca ÖNCEDEN kaydedilmiş Ev/İş
 * konumlarına veya yakın POI aramasına rota çizebiliyordu - kullanıcının
 * KEYFİ bir adrese/yer adına gitmesinin hiçbir yolu yoktu. Bu dosya o
 * temel eksikliği kapatır.
 * ---------------------------------------------------------------------------
 */

import { searchAddress } from '../../maps/forward-geocode.js';
import { drawRouteTo } from '../navigation-route-panel.js';
import { openModal } from './modal.js';

/** @type {number} Yazma durduktan sonra arama isteğinin gönderilmesi için beklenen süre (ms) -
 * Nominatim saniyede en fazla 1 istek kabul eder, her tuş vuruşunda sorgu atmak yasaktır. */
const DEBOUNCE_MS = 600;

/**
 * Adres arama alt sayfasını açar.
 * @param {import('leaflet').Map} map
 * @param {HTMLElement} container - Navigasyon ekranının ana konteyneri (durum satırı için).
 */
export function openAddressSearchModal(map, container) {
  const bodyHtml = `
    <input type="text" data-address-input placeholder="Adres, mahalle, işletme adı..." class="sda-select" style="width:100%; margin-bottom:12px;" autofocus>
    <div data-address-results></div>
  `;

  openModal({ title: 'Nereye Gidiyorsun?', bodyHtml, onMount: (body, { close }) => {
    const input = body.querySelector('[data-address-input]');
    const resultsEl = body.querySelector('[data-address-results]');
    let debounceHandle = null;

    input?.addEventListener('input', () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => runSearch(input.value, resultsEl, map, container, close), DEBOUNCE_MS);
    });
  } });
}

/**
 * @param {string} query
 * @param {HTMLElement|null} resultsEl
 * @param {import('leaflet').Map} map
 * @param {HTMLElement} container
 * @param {() => void} closeModal
 */
async function runSearch(query, resultsEl, map, container, closeModal) {
  if (!resultsEl) return;

  if (query.trim().length < 3) {
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.innerHTML = '<p class="sda-card__label">Aranıyor...</p>';

  const suggestions = await searchAddress(query);

  if (suggestions.length === 0) {
    resultsEl.innerHTML = '<p class="sda-card__label">Sonuç bulunamadı.</p>';
    return;
  }

  resultsEl.innerHTML = suggestions.map((s, i) => `
    <button type="button" data-suggestion="${i}" class="sda-card" style="display:block; width:100%; text-align:left; margin-bottom:6px; border:none;">
      <span class="sda-card__value" style="font-size:0.9rem;">${s.label}</span>
    </button>
  `).join('');

  resultsEl.querySelectorAll('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      const suggestion = suggestions[Number(button.getAttribute('data-suggestion'))];
      if (!suggestion) return;

      // Seçilen sonucun tam adı uzun olabilir - durum satırında yalnızca
      // ilk parçası (ör. mahalle/cadde adı) gösterilir, tamamı değil.
      const shortLabel = suggestion.label.split(',')[0];
      closeModal();
      void drawRouteTo(map, { lat: suggestion.lat, lon: suggestion.lon, label: shortLabel }, container);
    });
  });
}
