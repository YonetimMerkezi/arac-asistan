/**
 * app-init.js
 * ---------------------------------------------------------------------------
 * Uygulamanın tek giriş noktası (entry point).
 *
 * Sorumluluğu yalnızca modülleri doğru sırayla başlatmaktır - bu dosya her
 * fazda genişleyen tek merkezi bootstrap noktasıdır.
 *
 * index.html bu dosyayı `type="module"` olarak yükler.
 * ---------------------------------------------------------------------------
 */
import { initThemeManager } from './theme-manager.js';
import { initViewRouter } from './view-router.js';
import { mountNavIcons } from './nav-icons.js';
import { initUnitsStore } from './units-store.js';
import { initTts } from '../voice/tts.js';
import { initDashboardConfigStore } from './dashboard-config-store.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  initBluetoothManager,
  tryAutoConnect,
  onStateChange as onBluetoothStateChange,
} from '../bluetooth/bluetooth-manager.js';
import { attachElm327Transport, detachElm327Transport, runInitSequence, discoverSupportedPids, readVin, readFuelType } from '../obd/elm327.js';
import { setVehicleInfo } from './vehicle-info-store.js';
import { initDashboardView } from '../ui/dashboard-view.js';
import { speakConnectionGreeting } from '../voice/greeting.js';
import { initVoiceAlerts } from '../voice/voice-alerts.js';
import { initVoiceCommands } from '../voice/voice-commands.js';
import { startListeningMode, stopListeningMode } from '../voice/stt.js';
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
import { initAiView } from '../ui/ai-view.js';
import { initSettingsView } from '../ui/settings-view.js';
import { initFavoriteBrandsStore } from './favorite-brands-store.js';
import { initStationBrandStore } from '../maps/station-brand-store.js';
import { initFuelStationCache } from '../maps/fuel-station-cache.js';
import { initBackgroundService } from './background-service.js';

/** @type {string} Karşılama cümlesinde kullanılan sahip adı. */
const OWNER_NAME = 'Sedat';

/**
 * @type {boolean} ELM327 başlatma dizisinin şu anki bağlantı için zaten
 * çalıştırılıp çalıştırılmadığı. Bluetooth durumu "connected" olduğunda
 * (KAYNAĞI FARK ETMEKSİZİN - otomatik bağlanma veya Ayarlar'dan elle
 * bağlanma) tekrar tekrar tetiklenmesin diye.
 */
let elm327InitializedForThisConnection = false;

// GELİŞTİRME NOTU: Masaüstü devtools erişimi olmadığı için (yalnızca
// telefondan geliştiriliyor), bootstrap() dışında (ör. "void" ile
// beklenmeden çağrılan fonksiyonlarda) oluşan hataları da yakalayıp
// ekranda görünür kılıyoruz - aksi halde sessizce kaybolurlar.
window.addEventListener('error', (event) => {
  logError('app-init', 'Yakalanmamış hata', event.error ?? event.message);
  showNonFatalErrorBanner(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  logError('app-init', 'Yakalanmamış promise reddi', event.reason);
  showNonFatalErrorBanner(event.reason);
});

/**
 * Uygulamayı başlatır. Hata durumunda kullanıcıya sessizce beyaz ekran
 * göstermek yerine kök elemana bir hata durumu yazdırır.
 * @returns {Promise<void>}
 */
async function bootstrap() {
  try {
    await initThemeManager();
    initViewRouter('dashboard');
    mountNavIcons();
    await initUnitsStore();
    await initTts();
    await initDashboardConfigStore();
    await initFavoriteBrandsStore();
    await initStationBrandStore();
    await initDatabase();
    await initFavoritesStore();
    await initBluetoothManager();
    initGpsTracker();
    initFuelStationCache();
    bindConnectionStatusDot();
    bindConnectionStatusToast();
    initDashboardView();
    initTripRecorder();
    initTripView();
    initNavigationView();
    initFuelView();
    initDiagnosticsView();
    initAiView();
    initSettingsView();
    initSpeedCameraService();
    initSpeedWarning();
    await initAverageSpeedCorridor();
    void checkMaintenanceDue();
    void initBackgroundService();

    // KRİTİK: ELM327 başlatma dizisi artık Bluetooth bağlantı durumunu
    // DİNLEYEREK tetiklenir - bağlantının kaynağı (uygulama açılışında
    // otomatik bağlanma MI, yoksa Ayarlar ekranından kullanıcının ELLE
    // seçtiği bir cihaza bağlanma MI) önemli değildir. Önceki sürümde bu
    // yalnızca otomatik bağlanma akışında tetikleniyordu - Ayarlar'dan
    // elle bağlanan bir kullanıcı için Bluetooth soketi açılıyor ama
    // ELM327'ye hiç "ATZ" bile gönderilmiyordu, bu yüzden veri hiç akmıyordu.
    onBluetoothStateChange((state) => {
      if (state.status === 'connected' && !elm327InitializedForThisConnection) {
        elm327InitializedForThisConnection = true;
        void initializeElm327AndVoice();
      } else if (state.status !== 'connected') {
        elm327InitializedForThisConnection = false;
      }
    });

    // Kayıtlı OBD cihazı varsa sessizce bağlanmayı dene (araç çalıştığında).
    // Bağlantı kurulursa yukarıdaki dinleyici ELM327 başlatmasını tetikler.
    void tryAutoConnect();

    logInfo('app-init', 'Smart Drive AI başlatıldı');
  } catch (error) {
    logError('app-init', 'Uygulama başlatılırken kritik hata oluştu', error);
    renderFatalError(error);
  }
}

/**
 * Bluetooth bağlantısı kurulduğunda (kaynağı fark etmeksizin) ELM327
 * başlatma dizisini, PID keşfini, araç kimlik bilgilerini, karşılama
 * cümlesini ve sesli komut dinlemeyi başlatır.
 * @returns {Promise<void>}
 */
async function initializeElm327AndVoice() {
  try {
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

    initVoiceAlerts();
    initVoiceCommands();
    await speakConnectionGreeting(OWNER_NAME);
    void startListeningMode();
  } catch (error) {
    logError('app-init', 'ELM327 başlatma sırasında hata', error);
    detachElm327Transport();
    stopListeningMode();
    elm327InitializedForThisConnection = false;
  }
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
 * Araç bağlantı durumunu (bağlanıyor/bağlandı/koptu), kullanıcı hangi
 * ekranda olursa olsun görünür kılan küçük bir şerit gösterir - Ayarlar
 * ekranına gitmeden de "bağlandı mı, denemeye mi devam ediyor" bilgisini
 * verir. "Bağlandı" bildirimi birkaç saniye sonra kendiliğinden kaybolur.
 */
function bindConnectionStatusToast() {
  onBluetoothStateChange((state) => {
    const existing = document.querySelector('[data-connection-toast]');
    if (existing) existing.remove();

    if (state.status === 'disconnected') return; // sessiz - "koptu" her an olabilir, rahatsız etmesin.

    const toast = document.createElement('div');
    toast.setAttribute('data-connection-toast', '');
    toast.setAttribute('role', 'status');
    const isConnected = state.status === 'connected';
    toast.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9998; '
      + `background:${isConnected ? 'var(--sda-success, #34D399)' : 'var(--sda-accent, #FF8A3D)'}; `
      + 'color:#14171C; padding:8px 12px; font-size:0.8rem; text-align:center; font-weight:600;';

    toast.textContent = isConnected
      ? `Bağlandı: ${state.deviceName ?? state.deviceAddress}`
      : state.status === 'reconnecting'
        ? 'Araç bağlantısı yeniden kuruluyor...'
        : `${state.deviceName ?? state.deviceAddress ?? 'Araç'} cihazına bağlanılıyor...`;

    document.body.appendChild(toast);

    if (isConnected) {
      setTimeout(() => toast.remove(), 4000);
    }
  });
}

/**
 * bootstrap() dışında oluşan (fatal olmayan) bir hatayı ekranın üstünde
 * küçük, kapatılabilir bir bant olarak gösterir - çalışan arayüzü SİLMEZ,
 * yalnızca üzerine görünür bir teşhis bilgisi ekler.
 * @param {Error|string|unknown} error
 */
function showNonFatalErrorBanner(error) {
  const details = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error ?? 'Bilinmeyen hata');

  const existing = document.querySelector('[data-error-banner]');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.setAttribute('data-error-banner', '');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; '
    + 'background:var(--sda-danger, #FF5A5F); color:#14171C; padding:10px 12px; '
    + 'font-size:0.8rem; white-space:pre-wrap; word-break:break-word;';
  banner.textContent = `Hata: ${details}`;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'float:right; background:none; border:none; font-size:1rem; padding:0 4px;';
  closeBtn.addEventListener('click', () => banner.remove());
  banner.prepend(closeBtn);

  document.body.appendChild(banner);
}

/**
 * Başlatma sırasında kurtarılamaz bir hata oluşursa gösterilecek asgari,
 * bağımsız (başka modüle ihtiyaç duymayan) hata ekranı.
 *
 * GELİŞTİRME NOTU: Bu proje yalnızca telefondan geliştirildiği için masaüstü
 * `chrome://inspect` konsoluna erişim yok - bu yüzden hata ekranı gerçek
 * hatayı (isim/mesaj/stack) doğrudan gösterir, jenerik bir mesajla
 * gizlemez. Bu bilgi ekran görüntüsüyle paylaşılıp sorunu teşhis etmek
 * için kullanılabilir.
 * @param {Error|unknown} [error]
 */
function renderFatalError(error) {
  const root = document.getElementById('app-root');
  if (!root) return;

  const details = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
    : String(error ?? 'Bilinmeyen hata');

  root.innerHTML = `
    <div class="sda-empty-state" role="alert">
      <p class="sda-empty-state__title">Uygulama başlatılamadı</p>
      <p>Lütfen uygulamayı yeniden başlatın. Aşağıdaki teknik detayı geliştiriciyle paylaşabilirsiniz.</p>
      <pre style="white-space:pre-wrap; text-align:left; font-size:0.75rem; color:var(--sda-danger); background:var(--sda-bg-elevated); padding:12px; border-radius:8px; margin-top:12px; overflow-x:auto;">${escapeHtml(details)}</pre>
    </div>
  `;
}

/**
 * Basit HTML kaçışı - hata mesajı `innerHTML` içine yazıldığı için gerekli
 * (hata mesajında `<`/`&` gibi karakterler olursa yapıyı bozmasın).
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// DOM hazır olduğunda başlat.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
