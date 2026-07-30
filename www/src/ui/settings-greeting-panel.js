/**
 * settings-greeting-panel.js
 * ---------------------------------------------------------------------------
 * Ayarlar ekranındaki "Karşılama Mesajı" bölümü: sesli okuma açık/kapalı
 * anahtarı + hangi bilgilerin söyleneceğini seçen onay kutuları.
 * ---------------------------------------------------------------------------
 */

import { iconMarkup } from './icons.js';
import {
  isGreetingSpoken,
  setGreetingSpoken,
  getGreetingFields,
  setGreetingFields,
  GREETING_FIELD_OPTIONS,
} from '../core/greeting-preferences-store.js';

/**
 * @param {HTMLElement} container
 */
export function bindGreetingPanel(container) {
  bindSpokenToggle(container);
  bindFieldCheckboxes(container);
}

/**
 * @param {HTMLElement} container
 */
function bindSpokenToggle(container) {
  const button = container.querySelector('[data-greeting-spoken-toggle]');
  if (!button) return;

  const updateLabel = (enabled) => {
    const icon = iconMarkup(enabled ? 'done' : 'bolt', { size: 20 });
    const text = enabled ? 'Açık (kapatmak için dokun)' : 'Kapalı (açmak için dokun)';
    button.innerHTML = `${icon}<span>${text}</span>`;
  };

  updateLabel(isGreetingSpoken());

  button.addEventListener('click', async () => {
    const next = !isGreetingSpoken();
    await setGreetingSpoken(next);
    updateLabel(next);
  });
}

/**
 * @param {HTMLElement} container
 */
function bindFieldCheckboxes(container) {
  const listEl = container.querySelector('[data-greeting-fields-list]');
  if (!listEl) return;

  const selected = new Set(getGreetingFields());

  listEl.innerHTML = GREETING_FIELD_OPTIONS.map(({ field, label }) => `
    <label style="display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer;">
      <input type="checkbox" data-greeting-field="${field}" ${selected.has(field) ? 'checked' : ''}>
      <span style="font-size:0.9rem;">${label}</span>
    </label>
  `).join('');

  listEl.querySelectorAll('[data-greeting-field]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const field = checkbox.getAttribute('data-greeting-field');
      if (checkbox.checked) {
        selected.add(field);
      } else {
        selected.delete(field);
      }
      await setGreetingFields([...selected]);
    });
  });
}
