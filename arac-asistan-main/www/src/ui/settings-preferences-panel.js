/**
 * settings-preferences-panel.js
 * ---------------------------------------------------------------------------
 * Ayarlar ekranındaki basit tercih anahtarları: Otomatik Bağlantı (arka
 * plan servisi), Ekran Açık Kalsın, ve sesli asistanın kullanacağı isim.
 *
 * settings-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya başına
 * maks. 500 satır) - bu üçü birbirinden bağımsız, küçük, tekrar eden bir
 * "anahtar/metin alanı" deseni paylaşıyor.
 * ---------------------------------------------------------------------------
 */

import { iconMarkup } from './icons.js';
import {
  isBackgroundServiceEnabled,
  startBackgroundService,
  stopBackgroundService,
  setBootNotificationEnabled,
  isBootNotificationEnabled,
} from '../core/background-service.js';
import { isKeepAwakeEnabled, setKeepAwakeEnabled } from '../core/keep-awake.js';
import { getOwnerName, setOwnerName } from '../core/owner-name-store.js';
import { getVehicleMarkerShape, setVehicleMarkerShape } from '../core/vehicle-marker-preference.js';

/**
 * @param {HTMLElement} container
 */
export function bindBackgroundServiceToggle(container) {
  const button = container.querySelector('[data-bg-service-toggle]');
  if (!button) return;

  const updateLabel = (enabled) => {
    const icon = iconMarkup(enabled ? 'done' : 'bolt', { size: 20 });
    const text = enabled ? 'Açık (kapatmak için dokun)' : 'Kapalı (açmak için dokun)';
    button.innerHTML = `${icon}<span>${text}</span>`;
  };

  void isBackgroundServiceEnabled().then(updateLabel);

  button.addEventListener('click', async () => {
    const currentlyEnabled = await isBackgroundServiceEnabled();
    if (currentlyEnabled) {
      await stopBackgroundService();
      updateLabel(false);
    } else {
      const started = await startBackgroundService();
      updateLabel(started);
    }
  });
}

/**
 * @param {HTMLElement} container
 */
export function bindKeepAwakeToggle(container) {
  const button = container.querySelector('[data-keep-awake-toggle]');
  if (!button) return;

  const updateLabel = (enabled) => {
    const icon = iconMarkup(enabled ? 'done' : 'bolt', { size: 20 });
    const text = enabled ? 'Açık (kapatmak için dokun)' : 'Kapalı (açmak için dokun)';
    button.innerHTML = `${icon}<span>${text}</span>`;
  };

  updateLabel(isKeepAwakeEnabled());

  button.addEventListener('click', async () => {
    const next = !isKeepAwakeEnabled();
    await setKeepAwakeEnabled(next);
    updateLabel(next);
  });
}

/**
 * @param {HTMLElement} container
 */
export function bindOwnerNameInput(container) {
  const input = container.querySelector('[data-owner-name-input]');
  if (!input) return;

  input.value = getOwnerName();

  // Her tuş vuruşunda değil, alandan çıkınca (blur) kaydedilir - gereksiz
  // yazma işlemini önler.
  input.addEventListener('blur', () => {
    void setOwnerName(input.value);
  });
}

/**
 * Telefon açılışında "bağlanmak için dokun" bildirimi anahtarını bağlar.
 * DÜRÜSTLÜK: Bu, tam sessiz/görünmez otomatik başlatma DEĞİLDİR (Android
 * kısıtlamaları nedeniyle güvenilir şekilde yapılamıyor) - açılışta tek
 * dokunuşla açılan bir bildirim gösterir.
 * @param {HTMLElement} container
 */
export function bindBootNotificationToggle(container) {
  const button = container.querySelector('[data-boot-notification-toggle]');
  if (!button) return;

  const updateLabel = (enabled) => {
    const icon = iconMarkup(enabled ? 'done' : 'bolt', { size: 20 });
    const text = enabled ? 'Açık (kapatmak için dokun)' : 'Kapalı (açmak için dokun)';
    button.innerHTML = `${icon}<span>${text}</span>`;
  };

  void isBootNotificationEnabled().then(updateLabel);

  button.addEventListener('click', async () => {
    const current = await isBootNotificationEnabled();
    const next = !current;
    await setBootNotificationEnabled(next);
    updateLabel(next);
  });
}

/**
 * Haritadaki araç işaretçisinin şeklini (nokta/ok/araba) seçen düğme grubunu
 * bağlar.
 * @param {HTMLElement} container
 */
export function bindVehicleMarkerShapeSelector(container) {
  const buttons = container.querySelectorAll('[data-marker-shape]');
  if (buttons.length === 0) return;

  const updateActive = (shape) => {
    buttons.forEach((button) => {
      const isActive = button.getAttribute('data-marker-shape') === shape;
      button.style.background = isActive ? 'var(--sda-accent)' : 'var(--sda-bg-elevated)';
      button.style.color = isActive ? 'white' : '';
    });
  };

  updateActive(getVehicleMarkerShape());

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const shape = button.getAttribute('data-marker-shape');
      await setVehicleMarkerShape(shape);
      updateActive(shape);
    });
  });
}
