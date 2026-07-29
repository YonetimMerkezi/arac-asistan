/**
 * address-search-modal.js
 * ---------------------------------------------------------------------------
 * "Nereden / Nereye gidiyorsun?" alt sayfası: kullanıcı hem başlangıç hem
 * varış noktasını yazabilir, yazarken önerileri görür (autocomplete).
 *
 * ÖNCEKİ DURUM: Yalnızca varış noktası seçilebiliyordu, başlangıç HER ZAMAN
 * mevcut GPS konumuydu - kullanıcının "İstanbul'dan Ankara'ya" gibi mevcut
 * konumundan BAĞIMSIZ bir rota planlamasının yolu yoktu.
 *
 * Nereden alanı BOŞ bırakılırsa mevcut konum kullanılır (önceki davranışla
 * geriye dönük uyumlu) - yalnızca DOLDURULURSA o nokta başlangıç olur.
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
    <p class="sda-card__label" style="margin-bottom:4px;">Nereden (boş = mevcut konumunuz)</p>
    <input type="text" data-origin-input placeholder="Mevcut konumunuz" class="sda-select" style="width:100%; margin-bottom:4px;">
    <div data-origin-results style="margin-bottom:12px;"></div>

    <p class="sda-card__label" style="margin-bottom:4px;">Nereye</p>
    <input type="text" data-destination-input placeholder="Adres, mahalle, işletme adı..." class="sda-select" style="width:100%; margin-bottom:4px;" autofocus>
    <div data-destination-results></div>
  `;

  /** @type {{lat: number, lon: number, label: string}|null} Seçilirse geçersiz kılınan başlangıç noktası. */
  let selectedOrigin = null;

  openModal({ title: 'Nereden / Nereye Gidiyorsun?', bodyHtml, onMount: (body, { close }) => {
    const originInput = body.querySelector('[data-origin-input]');
    const originResultsEl = body.querySelector('[data-origin-results]');
    const destinationInput = body.querySelector('[data-destination-input]');
    const destinationResultsEl = body.querySelector('[data-destination-results]');

    let originDebounce = null;
    let destinationDebounce = null;

    originInput?.addEventListener('input', () => {
      selectedOrigin = null; // Kullanıcı elle yazmaya başlarsa önceki seçim geçersizleşir.
      if (originDebounce) clearTimeout(originDebounce);
      originDebounce = setTimeout(() => {
        runSearch(originInput.value, originResultsEl, (suggestion) => {
          selectedOrigin = suggestion;
          originInput.value = suggestion.label.split(',')[0];
          originResultsEl.innerHTML = '';
        });
      }, DEBOUNCE_MS);
    });

    destinationInput?.addEventListener('input', () => {
      if (destinationDebounce) clearTimeout(destinationDebounce);
      destinationDebounce = setTimeout(() => {
        runSearch(destinationInput.value, destinationResultsEl, (suggestion) => {
          const shortLabel = suggestion.label.split(',')[0];
          close();
          void drawRouteTo(map, { lat: suggestion.lat, lon: suggestion.lon, label: shortLabel }, container, selectedOrigin);
        });
      }, DEBOUNCE_MS);
    });
  } });
}

/**
 * Ortak arama + öneri listesi çizme mantığı - hem Nereden hem Nereye
 * alanları tarafından paylaşılır.
 * @param {string} query
 * @param {HTMLElement|null} resultsEl
 * @param {(suggestion: {lat: number, lon: number, label: string}) => void} onSelect
 */
async function runSearch(query, resultsEl, onSelect) {
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
      if (suggestion) onSelect(suggestion);
    });
  });
}
