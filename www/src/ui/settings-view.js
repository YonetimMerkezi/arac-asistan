/**
 * settings-view.js
 * ---------------------------------------------------------------------------
 * Ayarlar ekranı: tema, birim, ses, Bluetooth cihaz eşleştirme, ortalama hız
 * koridoru ekleme.
 *
 * Bu dosya yalnızca UI/etkileşim mantığını içerir; gerçek durum yönetimi
 * ilgili store/servis dosyalarında (theme-manager.js, units-store.js, vb.)
 * kalır - Single Responsibility.
 * ---------------------------------------------------------------------------
 */

import { getThemeSettings, setThemeMode, setThemePackage } from '../core/theme-manager.js';
import { THEME_PACKAGES } from '../core/theme-packages.js';
import { iconMarkup } from './icons.js';
import { getUnits, setUnits } from '../core/units-store.js';
import { isMuted, setMuted } from '../voice/tts.js';
import {
  listPairedDevices,
  connectToDevice,
  disconnect as disconnectBluetooth,
  getState as getBluetoothState,
  onStateChange as onBluetoothStateChange,
} from '../bluetooth/bluetooth-manager.js';
import { getLastPosition } from '../core/gps-tracker.js';
import {
  isBackgroundServiceEnabled,
  startBackgroundService,
  stopBackgroundService,
} from '../core/background-service.js';
import { createCorridor, listCorridors, deleteCorridor } from '../data/corridor-repository.js';
import { refreshCorridors } from '../maps/average-speed-corridor.js';
import { logWarn } from '../core/logger.js';

/**
 * Ayarlar görünümünü başlatır.
 */
export function initSettingsView() {
  const container = document.querySelector('[data-view="settings"]');
  if (!container) {
    logWarn('settings-view', 'Ayarlar konteyneri bulunamadı');
    return;
  }

  render(container);

  onBluetoothStateChange(() => renderDeviceSection(container));
}

/**
 * @param {HTMLElement} container
 */
function render(container) {
  const theme = getThemeSettings();
  const units = getUnits();
  const muted = isMuted();

  container.innerHTML = `
    <h3 style="margin:4px 0;">Görünüm</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Tema</p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" data-theme="system" class="sda-nav-btn">Sistem</button>
        <button type="button" data-theme="dark" class="sda-nav-btn">Koyu</button>
        <button type="button" data-theme="light" class="sda-nav-btn">Açık</button>
      </div>
    </div>

    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Renk Paketi</p>
      <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
        ${THEME_PACKAGES.map((pkg) => `
          <button type="button" data-package="${pkg.id}" class="sda-nav-btn" style="display:flex; align-items:center; gap:6px;">
            <span class="sda-color-swatch" style="background:hsl(${pkg.accentHue} 90% 60%); width:14px; height:14px;"></span>
            ${pkg.label}
          </button>
        `).join('')}
      </div>
    </div>

    <h3 style="margin:4px 0;">Birimler</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Mesafe / Hız</p>
      <div style="display:flex; gap:8px; margin-top:8px; margin-bottom:12px;">
        <button type="button" data-distance="km" class="sda-nav-btn">Kilometre</button>
        <button type="button" data-distance="mi" class="sda-nav-btn">Mil</button>
      </div>
      <p class="sda-card__label">Sıcaklık</p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" data-temp="c" class="sda-nav-btn">Celsius</button>
        <button type="button" data-temp="f" class="sda-nav-btn">Fahrenheit</button>
      </div>
    </div>

    <h3 style="margin:4px 0;">Ses</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <button type="button" data-sound-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px;"></button>
    </div>

    <h3 style="margin:4px 0;">Araç Bağlantısı</h3>
    <div data-device-section style="margin-bottom:16px;"></div>

    <h3 style="margin:4px 0;">Arka Planda Çalışma</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Otomatik Bağlantı</p>
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:4px 0 12px;">
        Açıksa, ekran kilitliyken veya uygulama arka plandayken de araç
        bağlantısı ve sesli uyarılar korunmaya çalışılır (pil tüketimini artırır).
      </p>
      <button type="button" data-bg-service-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px;"></button>
    </div>

    <h3 style="margin:4px 0;">Ortalama Hız Koridorları</h3>
    <form data-corridor-form class="sda-card" style="display:grid; gap:8px; margin-bottom:12px;">
      <input name="name" type="text" placeholder="Koridor adı" required style="padding:8px;">
      <input name="limitKmh" type="number" step="1" placeholder="Hız sınırı (km/h)" required style="padding:8px;">
      <button type="button" data-set-entry class="sda-nav-btn">Giriş noktası: mevcut konumu kullan</button>
      <button type="button" data-set-exit class="sda-nav-btn">Çıkış noktası: mevcut konumu kullan</button>
      <button type="submit" class="sda-nav-btn" style="background:var(--sda-accent-soft);">Koridoru Kaydet</button>
    </form>
    <div data-corridor-list></div>
  `;

  bindThemeButtons(container, theme.mode);
  bindThemePackageButtons(container, theme.packageId);
  bindUnitButtons(container, units);
  bindSoundToggle(container, muted);
  renderDeviceSection(container);
  bindBackgroundServiceToggle(container);
  bindCorridorForm(container);
  void renderCorridorList(container);
}

/**
 * @param {HTMLElement} container
 * @param {string} activeMode
 */
function bindThemeButtons(container, activeMode) {
  container.querySelectorAll('[data-theme]').forEach((button) => {
    const mode = button.getAttribute('data-theme');
    if (mode === activeMode) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', async () => {
      await setThemeMode(mode);
      container.querySelectorAll('[data-theme]').forEach((b) => b.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'page');
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} activePackageId
 */
function bindThemePackageButtons(container, activePackageId) {
  container.querySelectorAll('[data-package]').forEach((button) => {
    const id = button.getAttribute('data-package');
    if (id === activePackageId) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', async () => {
      await setThemePackage(id);
      container.querySelectorAll('[data-package]').forEach((b) => b.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'page');
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {{distance: string, temperature: string}} units
 */
function bindUnitButtons(container, units) {
  container.querySelectorAll('[data-distance]').forEach((button) => {
    const value = button.getAttribute('data-distance');
    if (value === units.distance) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', async () => {
      await setUnits({ distance: value });
      container.querySelectorAll('[data-distance]').forEach((b) => b.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'page');
    });
  });

  container.querySelectorAll('[data-temp]').forEach((button) => {
    const value = button.getAttribute('data-temp');
    if (value === units.temperature) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', async () => {
      await setUnits({ temperature: value });
      container.querySelectorAll('[data-temp]').forEach((b) => b.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'page');
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {boolean} muted
 */
function bindSoundToggle(container, muted) {
  const button = container.querySelector('[data-sound-toggle]');
  if (!button) return;

  const updateLabel = (isMutedNow) => {
    const icon = iconMarkup(isMutedNow ? 'volume-off' : 'volume-on', { size: 20 });
    const text = isMutedNow ? 'Sesli asistan kapalı (açmak için dokun)' : 'Sesli asistan açık (kapatmak için dokun)';
    button.innerHTML = `${icon}<span>${text}</span>`;
  };
  updateLabel(muted);

  button.addEventListener('click', async () => {
    const next = !isMuted();
    await setMuted(next);
    updateLabel(next);
  });
}

/**
 * @param {HTMLElement} container
 */
function bindBackgroundServiceToggle(container) {
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
function renderDeviceSection(container) {
  const section = container.querySelector('[data-device-section]');
  if (!section) return;

  const state = getBluetoothState();

  if (state.status === 'connected') {
    section.innerHTML = `
      <div class="sda-card">
        <p class="sda-card__label">Bağlı cihaz</p>
        <p class="sda-card__value" style="font-size:1rem;">${state.deviceName ?? state.deviceAddress}</p>
        <button type="button" data-disconnect class="sda-nav-btn" style="margin-top:8px; background:var(--sda-danger-soft);">Bağlantıyı Kes</button>
      </div>
    `;
    section.querySelector('[data-disconnect]')?.addEventListener('click', () => disconnectBluetooth());
    return;
  }

  // ÖNEMLİ: "connecting"/"reconnecting" durumunda listeyi YENİDEN ÇEKMİYORUZ.
  // Önceki sürümde her durum değişikliği (connecting dahil) tüm bölümü
  // "Cihazlar taranıyor..." ile değiştirip listPairedDevices()'i yeniden
  // çağırıyordu - bu, kullanıcının az önce tıkladığı "bağlanılıyor..." /
  // "bağlantı kurulamadı" mesajını göstermeden SİLİYORDU (ekranda görülen
  // "titreme" buydu). Artık bağlanma sürecinde sabit, tek bir durum kartı
  // gösteriliyor.
  if (state.status === 'connecting' || state.status === 'reconnecting') {
    section.innerHTML = `
      <div class="sda-card">
        <p class="sda-card__label">${state.status === 'connecting' ? 'Bağlanıyor' : 'Yeniden bağlanıyor'}</p>
        <p class="sda-card__value" style="font-size:1rem;">${state.deviceName ?? state.deviceAddress ?? '...'}</p>
      </div>
    `;
    return;
  }

  section.innerHTML = '<p class="sda-card__label">Cihazlar taranıyor...</p>';
  void listPairedDevices().then((devices) => {
    // Bu asenkron sonuç döndüğünde bağlantı durumu artık "disconnected"
    // değilse (ör. kullanıcı hızlıca bağlandıysa) eski listeyi ÇİZME -
    // aksi halde "connected" kartının üzerine yazabilir.
    if (getBluetoothState().status !== 'disconnected') return;

    if (devices.length === 0) {
      section.innerHTML = '<p class="sda-card__label">Eşleştirilmiş cihaz yok. Önce Android Bluetooth ayarlarından ELM327 adaptörünü eşleştirin.</p>';
      return;
    }

    section.innerHTML = devices.map((d) => `
      <button type="button" data-connect="${d.address}" data-name="${d.name ?? ''}" class="sda-card" style="display:block; width:100%; text-align:left; margin-bottom:8px; border:none;">
        <p class="sda-card__value" style="font-size:1rem;">${d.name ?? 'İsimsiz cihaz'}</p>
        <p class="sda-card__label">${d.address}</p>
      </button>
    `).join('') + '<p data-connect-status class="sda-card__label"></p>';

    const statusEl = section.querySelector('[data-connect-status]');

    section.querySelectorAll('[data-connect]').forEach((button) => {
      button.addEventListener('click', async () => {
        const address = button.getAttribute('data-connect');
        const name = button.getAttribute('data-name');

        // NOT: connectToDevice() çağrısı hemen "connecting" durumuna geçer,
        // bu da yukarıdaki durum dinleyicisini tetikleyip bu bölümü
        // "Bağlanıyor" kartına çevirir - bu yüzden burada statusEl/button'a
        // yazdığımız değerler çoğu zaman hiç görünmeden değişir; asıl kalıcı
        // geri bildirim yukarıdaki "connecting" ve aşağıdaki hata bloğu.
        button.disabled = true;
        const ok = await connectToDevice(address, name);

        if (!ok && getBluetoothState().status === 'disconnected') {
          button.disabled = false;
          if (statusEl) {
            statusEl.textContent = 'Bağlantı kurulamadı. Cihazın açık ve menzilde olduğundan emin olun, tekrar deneyin.';
          }
        }
      });
    });
  });
}

/**
 * @param {HTMLElement} container
 */
function bindCorridorForm(container) {
  const form = container.querySelector('[data-corridor-form]');
  if (!form) return;

  let entryPoint = null;
  let exitPoint = null;

  form.querySelector('[data-set-entry]')?.addEventListener('click', () => {
    const pos = getLastPosition();
    if (!pos) { window.alert('Konum henüz alınamadı.'); return; }
    entryPoint = { lat: pos.latitude, lon: pos.longitude };
    form.querySelector('[data-set-entry]').textContent = 'Giriş noktası: ayarlandı ✓';
  });

  form.querySelector('[data-set-exit]')?.addEventListener('click', () => {
    const pos = getLastPosition();
    if (!pos) { window.alert('Konum henüz alınamadı.'); return; }
    exitPoint = { lat: pos.latitude, lon: pos.longitude };
    form.querySelector('[data-set-exit]').textContent = 'Çıkış noktası: ayarlandı ✓';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!entryPoint || !exitPoint) {
      window.alert('Önce giriş ve çıkış noktalarını ayarlayın.');
      return;
    }

    const data = new FormData(form);
    await createCorridor({
      name: data.get('name'),
      entry_lat: entryPoint.lat,
      entry_lon: entryPoint.lon,
      exit_lat: exitPoint.lat,
      exit_lon: exitPoint.lon,
      limit_kmh: parseFloat(data.get('limitKmh')),
    });
    await refreshCorridors();

    form.reset();
    entryPoint = null;
    exitPoint = null;
    form.querySelector('[data-set-entry]').textContent = 'Giriş noktası: mevcut konumu kullan';
    form.querySelector('[data-set-exit]').textContent = 'Çıkış noktası: mevcut konumu kullan';
    await renderCorridorList(container);
  });
}

/**
 * @param {HTMLElement} container
 */
async function renderCorridorList(container) {
  const listEl = container.querySelector('[data-corridor-list]');
  if (!listEl) return;

  const corridors = await listCorridors();
  if (corridors.length === 0) {
    listEl.innerHTML = '<p class="sda-card__label">Henüz koridor tanımlanmadı.</p>';
    return;
  }

  listEl.innerHTML = corridors.map((c) => `
    <div class="sda-card" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <p class="sda-card__label">${c.name}</p>
        <p class="sda-card__value" style="font-size:0.95rem;">Sınır: ${c.limit_kmh} km/h</p>
      </div>
      <button type="button" data-delete-corridor="${c.id}" style="background:none;border:none;color:var(--sda-danger);">Sil</button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-delete-corridor]').forEach((button) => {
    button.addEventListener('click', async () => {
      await deleteCorridor(Number(button.getAttribute('data-delete-corridor')));
      await refreshCorridors();
      await renderCorridorList(container);
    });
  });
}
