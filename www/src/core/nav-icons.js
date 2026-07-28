/**
 * nav-icons.js
 * ---------------------------------------------------------------------------
 * Alt gezinme çubuğundaki düğmelere simge ekler.
 *
 * index.html'deki nav düğmeleri STATİKTİR (bir JS view dosyası tarafından
 * inşa edilmez) - bu yüzden simgeleri HTML'i elden değiştirmek yerine
 * açılışta programatik olarak ekliyoruz. Bu, index.html'e yeni bir sekme
 * eklendiğinde (ör. "Analiz") o düğmenin data-nav-target değerine göre
 * otomatik simge alması, hiçbir HTML düzenlemesi gerekmemesi anlamına gelir.
 * ---------------------------------------------------------------------------
 */

import { iconMarkup } from '../ui/icons.js';

/** @type {Record<string, string>} data-nav-target değeri -> icons.js semantik adı. */
const NAV_ICON_BY_TARGET = {
  dashboard: 'panel',
  trip: 'trip',
  navigation: 'map',
  fuel: 'fuel',
  diagnostics: 'diagnostics',
  ai: 'analytics',
  settings: 'settings',
};

/**
 * Tüm nav düğmelerine, data-nav-target'larına göre simge ekler. Bir düğme
 * NAV_ICON_BY_TARGET'te yoksa (yeni bir sekme eklenip burası unutulduysa)
 * sessizce atlanır - metin etiketi zaten yerinde durur.
 */
export function mountNavIcons() {
  document.querySelectorAll('.sda-bottom-nav [data-nav-target]').forEach((button) => {
    if (button.querySelector('.sda-icon')) return; // zaten eklenmiş

    const target = button.getAttribute('data-nav-target');
    const iconName = NAV_ICON_BY_TARGET[target];
    if (!iconName) return;

    const label = button.textContent.trim();
    button.innerHTML = `${iconMarkup(iconName, { size: 22 })}<span>${label}</span>`;
  });
}
