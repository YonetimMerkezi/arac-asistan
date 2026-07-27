/**
 * app-init.js
 * ---------------------------------------------------------------------------
 * Uygulamanın tek giriş noktası (entry point).
 *
 * Sorumluluğu yalnızca modülleri doğru sırayla başlatmaktır:
 *   1. Tema sistemi (kullanıcı görsel geri bildirimi hemen doğru olsun diye
 *      her şeyden önce çalışır - "flash of wrong theme" önlenir)
 *   2. Görünüm yönlendirici (nav)
 *   3. (Faz 1+) Bluetooth/OBD servisleri, sesli asistan, vb. buraya
 *      sırayla eklenecek - bu dosyanın kendisi her fazda genişleyecek
 *      tek merkezi bootstrap noktasıdır.
 *
 * index.html bu dosyayı `type="module"` olarak yükler.
 * ---------------------------------------------------------------------------
 */

import { initThemeManager } from './theme-manager.js';
import { initViewRouter } from './view-router.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  initBluetoothManager,
  tryAutoConnect,
  onStateChange as onBluetoothStateChange,
} from '../bluetooth/bluetooth-manager.js';
import { attachElm327Transport, runInitSequence, discoverSupportedPids, readVin, readFuelType } from '../obd/elm327.js';
import { setVehicleInfo } from './vehicle-info-store.js';
import { initDashboardView } from '../ui/dashboard-view.js';
import { speakConnectionGreeting } from '../voice/greeting.js';
import { initVoiceAlerts } from '../voice/voice-alerts.js';
import { initVoiceCommands } from '../voice/voice-commands.js';
import { startListeningMode } from '../voice/stt.js';
import { initDatabase } from '../data/database.js';
import { initTripRecorder } from '../trip/trip-recorder.js';
import { initTripView } from '../ui/trip-view.js';
import { initGpsTracker } from './gps-tracker.js';
import { initSpeedCameraService } from '../maps/speed-camera-service.js';
import { initSpeedWarning } from '../maps/speed-warning.js';
import { initFavoritesStore } from '../maps/favorites-store.js';
import { initAverageSpeedCorridor } from '../maps/average-speed-corridor.js';
import { initNavigationView } from '../ui/navigation-view.js';
import { initFuelView } from '../ui/fuel-view.js';
import { checkMaintenanceDue } from '../maintenance/maintenance-reminder.js';
import { initDiagnosticsView } from '../ui/diagnostics-view.js';

/** @type {string} Karşılama cümlesinde kullanılan sahip adı. */
const OWNER_NAME = 'Sedat';

/**
 * Uygulamayı başlatır. Hata durumunda kullanıcıya sessizce beyaz ekran
 * göstermek yerine kök elemana bir hata durumu yazdırır.
 * @returns {Promise<void>}
 */
async function bootstrap() {
  try {
    await initThemeManager();
    initViewRouter('dashboard');
    await initDatabase();
    await initFavoritesStore();
    await initBluetoothManager();
    initGpsTracker();
    bindConnectionStatusDot();
    initDashboardView();
    initTripRecorder();
    initTripView();
    initNavigationView();
    initFuelView();
    initDiagnosticsView();
    initSpeedCameraService();
    initSpeedWarning();
    await initAverageSpeedCorridor();
    void checkMaintenanceDue();

    // Kayıtlı OBD cihazı varsa sessizce bağlanmayı dene (araç çalıştığında).
    // Cihaz seçimi/eşleştirme arayüzü Faz 9'da (Ayarlar) eklenecek.
    void autoConnectAndInitializeObd();

    logInfo('app-init', 'Smart Drive AI başlatıldı');
  } catch (error) {
    logError('app-init', 'Uygulama başlatılırken kritik hata oluştu', error);
    renderFatalError();
  }
}

/**
 * Kayıtlı cihaza bağlanmayı dener; başarılı olursa ELM327 başlatma
 * dizisini, PID keşfini ve araç kimlik bilgilerini (VIN, yakıt tipi)
 * çalıştırır. Bağlantı yoksa sessizce çıkar - kullanıcı daha sonra
 * ayarlardan manuel bağlanabilecek (Faz 9).
 * @returns {Promise<void>}
 */
async function autoConnectAndInitializeObd() {
  const connected = await tryAutoConnect();
  if (!connected) return;

  attachElm327Transport();
  await runInitSequence();

  const [supportedPids, vin, fuelType] = await Promise.all([
    discoverSupportedPids(),
    readVin(),
    readFuelType(),
  ]);

  setVehicleInfo({ supportedPids, vin, fuelType });

  logInfo('app-init', 'Araç bilgileri alındı', {
    supportedPidCount: supportedPids.length,
    vin,
    fuelType,
  });
  // dashboard-view.js bu bilgiyi otomatik dinler (onVehicleInfoChange).

  initVoiceAlerts();
  initVoiceCommands();
  await speakConnectionGreeting(OWNER_NAME);
  void startListeningMode();
}

/**
 * Üst bardaki bağlantı durumu noktasını (sda-status-dot) bluetooth-manager
 * durumuna göre günceller.
 */
function bindConnectionStatusDot() {
  const dot = document.querySelector('.sda-status-dot');
  if (!dot) {
    logWarn('app-init', 'Durum noktası elemanı bulunamadı');
    return;
  }

  onBluetoothStateChange((state) => {
    const domState = state.status === 'connected'
      ? (state.quality === 'weak' ? 'error' : 'connected')
      : 'disconnected';
    dot.setAttribute('data-state', domState);
  });
}

/**
 * Başlatma sırasında kurtarılamaz bir hata oluşursa gösterilecek asgari,
 * bağımsız (başka modüle ihtiyaç duymayan) hata ekranı.
 */
function renderFatalError() {
  const root = document.getElementById('app-root');
  if (!root) return;

  root.innerHTML = `
    <div class="sda-empty-state" role="alert">
      <p class="sda-empty-state__title">Uygulama başlatılamadı</p>
      <p>Lütfen uygulamayı yeniden başlatın. Sorun devam ederse ayarlar üzerinden günlükleri kontrol edin.</p>
    </div>
  `;
}

// DOM hazır olduğunda başlat.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
