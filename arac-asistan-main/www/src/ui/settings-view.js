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
  scanAndConnectElm,
  disconnect as disconnectBluetooth,
  getState as getBluetoothState,
  onStateChange as onBluetoothStateChange,
} from '../bluetooth/bluetooth-manager.js';
import { getLastPosition } from '../core/gps-tracker.js';
import { bindBackgroundServiceToggle, bindKeepAwakeToggle, bindOwnerNameInput, bindBootNotificationToggle, bindVehicleMarkerShapeSelector } from './settings-preferences-panel.js';
import { bindBackupPanel } from './settings-backup-panel.js';
import { bindGreetingPanel } from './settings-greeting-panel.js';
import { createCorridor, listCorridors, deleteCorridor } from '../data/corridor-repository.js';
import { refreshCorridors } from '../maps/average-speed-corridor.js';
import { getEcuStatus, onEcuStatusChange } from '../obd/ecu-connection-store.js';
import { openDiagnosticsLogModal } from './diagnostics-log-view.js';
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
  onEcuStatusChange(() => renderDeviceSection(container));
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
        <button type="button" data-theme="auto" class="sda-nav-btn">Otomatik (Gündüz/Gece)</button>
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
    <button type="button" data-open-log class="sda-btn sda-btn--ghost" style="margin-bottom:16px;">
      ${iconMarkup('info', { size: 18 })} Bağlantı Günlüğü
    </button>

    <h3 style="margin:4px 0;">Arka Planda Çalışma</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Otomatik Bağlantı</p>
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:4px 0 12px;">
        Açıksa, ekran kilitliyken veya uygulama arka plandayken de araç
        bağlantısı ve sesli uyarılar korunmaya çalışılır (pil tüketimini artırır).
      </p>
      <button type="button" data-bg-service-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px;"></button>
    </div>

    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Telefon Açılışında Bildirim</p>
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:4px 0 12px;">
        Açıksa, telefon her açıldığında "Araca bağlanmak için dokunun"
        bildirimi gösterilir - uygulamayı aramanıza gerek kalmaz, tek
        dokunuşla açılır. (Android kısıtlamaları nedeniyle tamamen
        dokunmadan, kendiliğinden açılamıyor.)
      </p>
      <button type="button" data-boot-notification-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px;"></button>
    </div>

    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Haritadaki Araç İşaretçisi</p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" data-marker-shape="arrow" class="sda-nav-btn" style="flex:1;">Ok</button>
        <button type="button" data-marker-shape="car" class="sda-nav-btn" style="flex:1;">Araba</button>
        <button type="button" data-marker-shape="dot" class="sda-nav-btn" style="flex:1;">Nokta</button>
      </div>
    </div>

    <h3 style="margin:4px 0;">Ekran</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Ekran Açık Kalsın</p>
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:4px 0 12px;">
        Açıksa, uygulama açıkken telefon ekranı kendiliğinden kararıp
        kilitlenmez (pil tüketimini artırır).
      </p>
      <button type="button" data-keep-awake-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px;"></button>
    </div>

    <h3 style="margin:4px 0;">Sesli Asistan</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">İsminiz</p>
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:4px 0 8px;">
        Sesli karşılamada ve komutlarda bu isimle hitap edilir - arabayı
        birden fazla kişi kullanıyorsa değiştirebilirsiniz.
      </p>
      <input type="text" data-owner-name-input class="sda-select" style="width:100%;" placeholder="İsminiz">
    </div>

    <div class="sda-card" style="margin-bottom:16px;">
      <p class="sda-card__label">Karşılama Mesajı Sesli Okunsun</p>
      <button type="button" data-greeting-spoken-toggle class="sda-nav-btn" style="width:100%; flex-direction:row; gap:8px; margin-top:8px;"></button>
      <p class="sda-card__label" style="margin:12px 0 4px;">Neler söylensin?</p>
      <div data-greeting-fields-list></div>
    </div>

    <h3 style="margin:4px 0;">Veri Yedekleme</h3>
    <div class="sda-card" style="margin-bottom:16px;">
      <p style="font-size:0.85rem; color:var(--sda-text-muted); margin:0 0 12px;">
        Tüm yolculuklar, yakıt kayıtları, bakım geçmişi, koridorlar ve
        ayarlarınızı tek bir dosyaya kaydedin - telefon değiştirirken veya
        yedek almak istediğinizde kullanın.
      </p>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <button type="button" data-backup-export class="sda-nav-btn" style="background:var(--sda-accent-soft); flex:1;">Yedekle</button>
        <button type="button" data-backup-import class="sda-nav-btn" style="background:var(--sda-bg-elevated); flex:1;">Geri Yükle</button>
      </div>
      <input type="file" data-backup-file-input accept="application/json,.json" hidden>
      <p data-backup-status class="sda-card__label" style="min-height:1em;"></p>
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
  container.querySelector('[data-open-log]')?.addEventListener('click', openDiagnosticsLogModal);
  bindBackgroundServiceToggle(container);
  bindKeepAwakeToggle(container);
  bindOwnerNameInput(container);
  bindBootNotificationToggle(container);
  bindVehicleMarkerShapeSelector(container);
  bindBackupPanel(container);
  bindGreetingPanel(container);
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
function renderDeviceSection(container) {
  const section = container.querySelector('[data-device-section]');
  if (!section) return;

  const state = getBluetoothState();

  if (state.status === 'connected') {
    const ecu = getEcuStatus();
    section.innerHTML = `
      <div class="sda-card">
        <p class="sda-card__label">Bağlı cihaz</p>
        <p class="sda-card__value" style="font-size:1rem;">${state.deviceName ?? state.deviceAddress}</p>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
          <span class="sda-card__label">ELM Bağlantısı</span>
          <span style="color:var(--sda-success); font-weight:600;">Bağlandı</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span class="sda-card__label">ECU Bağlantısı</span>
          <span style="color:${ecuStatusColor(ecu.status)}; font-weight:600;">${ecuStatusLabel(ecu.status)}</span>
        </div>
        ${ecu.hint ? `<p class="sda-card__label" style="margin-top:6px; color:var(--sda-warning);">${ecu.hint}</p>` : ''}

        <button type="button" data-disconnect class="sda-nav-btn" style="margin-top:12px; background:var(--sda-danger-soft);">Bağlantıyı Kes</button>
      </div>
    `;
    section.querySelector('[data-disconnect]')?.addEventListener('click', () => disconnectBluetooth());
    return;
  }

  // KRİTİK: Önceki sürüm burada TÜM eşleştirilmiş Bluetooth cihazlarını
  // (kulaklık, hoparlör, diğer telefonlar vb.) listeleyip kullanıcının
  // aralarından OBD adaptörünü kendisinin bulmasını bekliyordu - kalabalık
  // ve kafa karıştırıcıydı. Artık Car Scanner benzeri TEK DÜĞME: kullanıcı
  // hiçbir cihaz listesi görmez, "Bağlan" dokunuşu bluetooth-manager.js'teki
  // scanAndConnectElm() ile eşleştirilmiş cihazlar arasından ELM327/OBD2
  // adaptörünü kendisi bulup doğrudan bağlanır.
  if (!section.querySelector('[data-connect-elm]')) {
    section.innerHTML = `
      <button type="button" data-connect-elm class="sda-btn sda-btn--primary" style="width:100%;">
        ${iconMarkup('bluetooth', { size: 20 })} Bağlan
      </button>
      <p data-connect-status class="sda-card__label" style="margin-top:8px;"></p>
    `;
    bindConnectElmButton(section);
  }

  updateConnectStatusLine(section, state);
}

/**
 * @param {import('../obd/ecu-connection-store.js').EcuStatus} status
 * @returns {string}
 */
function ecuStatusLabel(status) {
  const labels = { idle: 'Beklemede', handshaking: 'Bağlanıyor', connected: 'Bağlandı', failed: 'Yanıt Yok' };
  return labels[status] ?? status;
}

/**
 * @param {import('../obd/ecu-connection-store.js').EcuStatus} status
 * @returns {string}
 */
function ecuStatusColor(status) {
  if (status === 'connected') return 'var(--sda-success)';
  if (status === 'failed') return 'var(--sda-danger)';
  return 'var(--sda-warning)'; // idle/handshaking
}

/**
 * "Bağlan" düğmesini bağlar - eşleştirilmiş cihaz listesini hiç göstermeden
 * doğrudan ELM327/OBD2 adaptörünü bulup bağlanmayı dener.
 * @param {HTMLElement} section
 */
function bindConnectElmButton(section) {
  const button = section.querySelector('[data-connect-elm]');
  const statusEl = section.querySelector('[data-connect-status]');

  button?.addEventListener('click', async () => {
    button.disabled = true;
    if (statusEl) statusEl.textContent = 'ELM327/OBD2 adaptörü aranıyor...';

    const result = await scanAndConnectElm();

    button.disabled = false;
    if (!result.ok && statusEl) {
      statusEl.textContent = result.reason === 'not_found'
        ? 'Eşleştirilmiş cihazlar arasında bir OBD adaptörü bulunamadı. Önce Android Bluetooth ayarlarından ELM327 adaptörünü eşleştirin.'
        : 'Bağlantı kurulamadı. Adaptörün açık ve menzilde olduğundan emin olup tekrar deneyin.';
    }
  });
}

/**
 * connecting/reconnecting durumlarını KALICI durum satırına yazar - listeyi
 * yeniden çizmez, yalnızca metni günceller.
 * @param {HTMLElement} section
 * @param {import('../bluetooth/bluetooth-manager.js').BluetoothState} state
 */
function updateConnectStatusLine(section, state) {
  const statusEl = section.querySelector('[data-connect-status]');
  if (!statusEl) return;

  if (state.status === 'connecting') {
    statusEl.textContent = `${state.deviceName ?? state.deviceAddress ?? 'Cihaz'} cihazına bağlanılıyor...`;
  } else if (state.status === 'reconnecting') {
    statusEl.textContent = 'Yeniden bağlanılıyor...';
  }
  // "disconnected" durumunda burada BİLİNÇLİ OLARAK hiçbir şey yazılmıyor -
  // tıklama işleyicisinin yazdığı "bağlantı kurulamadı" mesajının üzerine
  // yazıp silmemek için. Mesaj yalnızca kullanıcı tekrar bir cihaza
  // dokunduğunda ("bağlanılıyor..." ile) değişir.
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
