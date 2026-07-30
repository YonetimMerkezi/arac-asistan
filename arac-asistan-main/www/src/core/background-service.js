/**
 * background-service.js
 * ---------------------------------------------------------------------------
 * SmartDriveForegroundService (native) için JS köprüsü ve kullanıcı tercihi.
 *
 * Bu servis Bluetooth bağlantısını KENDİSİ YÖNETMEZ - yalnızca Android'in
 * uygulama sürecini öldürmesini engelleyen bir bildirim + WakeLock tutar.
 * Gerçek bağlantı/sesli asistan mantığı her zaman olduğu gibi JS'te
 * (bluetooth-manager.js, voice/*) çalışmaya devam eder; bu modül yalnızca
 * o JS'in ekran kilitliyken de yaşamasını sağlar.
 *
 * DÜRÜSTLÜK NOTU: Bu, gerçek bir cihazda test edilmemiştir (yalnızca
 * telefondan geliştiriliyor, konsola erişim yok). Android'in arka plan
 * kısıtlamaları üretici/ROM'a göre (özellikle MIUI gibi agresif pil
 * yönetimi olan cihazlarda) değişebilir - bazı telefonlarda "Otomatik
 * başlat" / "Pil optimizasyonundan muaf tut" gibi ek sistem ayarları
 * elle açılması gerekebilir.
 * ---------------------------------------------------------------------------
 */

import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { logError, logInfo } from './logger.js';

/** @type {string} Kullanıcının "Otomatik Bağlantı" (arka plan servisi) tercihi anahtarı. */
const STORAGE_KEY = 'sda_background_service_enabled';

/**
 * @typedef {Object} BackgroundServicePluginInterface
 * @property {(opts: {statusText: string}) => Promise<{started: boolean}>} start
 * @property {(opts: {statusText: string}) => Promise<void>} updateStatus
 * @property {() => Promise<void>} stop
 * @property {(opts: {enabled: boolean}) => Promise<void>} setAutoStartOnBoot
 * @property {() => Promise<{enabled: boolean}>} isAutoStartOnBoot
 */

/** @type {BackgroundServicePluginInterface} */
const BackgroundService = registerPlugin('BackgroundService');

/** @type {boolean} */
let isRunning = false;

/** @type {(() => void)|null} */
let unsubscribeBluetooth = null;

/**
 * Kayıtlı tercihe göre servisi başlatır (uygulama açılışında bir kez çağrılmalıdır).
 * Kullanıcı daha önce "Otomatik Bağlantı"yı açtıysa servis otomatik başlar.
 * @returns {Promise<void>}
 */
export async function initBackgroundService() {
  const enabled = await isBackgroundServiceEnabled();
  if (enabled) {
    await startBackgroundService();
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function isBackgroundServiceEnabled() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * Arka plan servisini başlatır, tercihi kalıcı olarak saklar ve Bluetooth
 * durum değişikliklerini servisin bildirimine yansıtmaya başlar.
 * @returns {Promise<boolean>} Başarılı olup olmadığı.
 */
export async function startBackgroundService() {
  try {
    await BackgroundService.start({ statusText: 'Araç bağlantısı bekleniyor...' });
    await Preferences.set({ key: STORAGE_KEY, value: 'true' });
    isRunning = true;

    if (!unsubscribeBluetooth) {
      unsubscribeBluetooth = onBluetoothStateChange((state) => {
        const text = state.status === 'connected'
          ? `Bağlandı: ${state.deviceName ?? state.deviceAddress}`
          : state.status === 'reconnecting'
            ? 'Yeniden bağlanılıyor...'
            : 'Araç bağlantısı bekleniyor...';
        void BackgroundService.updateStatus({ statusText: text }).catch(() => {});
      });
    }

    logInfo('background-service', 'Arka plan servisi başlatıldı');
    return true;
  } catch (error) {
    logError('background-service', 'Arka plan servisi başlatılamadı', error);
    return false;
  }
}

/**
 * Arka plan servisini durdurur ve tercihi kalıcı olarak saklar.
 * @returns {Promise<void>}
 */
export async function stopBackgroundService() {
  try {
    await BackgroundService.stop();
  } catch (error) {
    logError('background-service', 'Arka plan servisi durdurulamadı', error);
  }
  await Preferences.set({ key: STORAGE_KEY, value: 'false' });
  isRunning = false;
  unsubscribeBluetooth?.();
  unsubscribeBluetooth = null;
}

/**
 * @returns {boolean}
 */
export function isBackgroundServiceRunning() {
  return isRunning;
}

/**
 * Telefon açılışında "Bağlanmak için dokun" bildiriminin gösterilip
 * gösterilmeyeceğini ayarlar (bkz. BootReceiver.kt - native tarafta).
 *
 * DÜRÜSTLÜK NOTU: Bu, uygulamayı TAMAMEN GÖRÜNMEZ şekilde otomatik açıp
 * bağlamaz - Android'in arka plan aktivite başlatma kısıtlamaları bunu
 * güvenilir şekilde imkansız kılıyor. Açıksa, telefon açılışında tek
 * dokunuşla uygulamayı açan bir bildirim gösterilir - "uygulamayı aramak"
 * yerine "bildirime dokunmak" yeterli olur.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setBootNotificationEnabled(enabled) {
  await BackgroundService.setAutoStartOnBoot({ enabled });
}

/**
 * @returns {Promise<boolean>}
 */
export async function isBootNotificationEnabled() {
  const { enabled } = await BackgroundService.isAutoStartOnBoot();
  return enabled;
}
