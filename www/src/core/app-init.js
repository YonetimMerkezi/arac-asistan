/**
 * app-init.js
 * ---------------------------------------------------------------------------
 * Uygulamanın tek giriş noktası (entry point).
 * Sorumluluğu yalnızca modülleri doğru sırayla başlatmaktır.
 * ---------------------------------------------------------------------------
 */
import { initThemeManager } from './theme-manager.js';
import { initKeepAwake } from './keep-awake.js';
import { initOwnerName, getOwnerName } from './owner-name-store.js';
import { initGreetingPreferences } from './greeting-preferences-store.js';
import { initVehicleMarkerPreference } from './vehicle-marker-preference.js';
import { initBackButtonHandler } from './back-button.js';
import { requestAllPermissionsUpfront } from './permissions-bootstrap.js';
import { initViewRouter } from './view-router.js';
import { mountNavIcons } from './nav-icons.js';
import { initUnitsStore } from './units-store.js';
import { initTts } from '../voice/tts.js';
import { initDashboardConfigStore } from './dashboard-config-store.js';
import { logError, logInfo, logWarn } from './logger.js';
import { initBluetoothManager, tryAutoConnect, getState as getBluetoothState, onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { attachElm327Transport, detachElm327Transport, runInitSequence, discoverSupportedPids, readVin, readFuelType } from '../obd/elm327.js';
import { setEcuStatus, getEcuStatus, onEcuStatusChange } from '../obd/ecu-connection-store.js';
import { setVehicleInfo } from './vehicle-info-store.js';
import { initDashboardView } from '../ui/dashboard-view.js';
import { speakConnectionGreeting } from '../voice/greeting.js';
import { speak } from '../voice/tts.js';
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
import { initNavigationDriveView } from '../ui/navigation-drive-view.js';
import { initFuelView } from '../ui/fuel-view.js';
import { checkMaintenanceDue } from '../maintenance/maintenance-reminder.js';
import { initDiagnosticsView } from '../ui/diagnostics-view.js';
import { initAiView } from '../ui/ai-view.js';
import { initSettingsView } from '../ui/settings-view.js';
import { initFavoriteBrandsStore } from './favorite-brands-store.js';
import { initStationBrandStore } from '../maps/station-brand-store.js';
import { initFuelStationCache } from '../maps/fuel-station-cache.js';
import { initBackgroundService, notifyVehicleConnected } from './background-service.js';
import { initFirebaseService } from '../cloud/firebase-service.js';
import { initFirebaseSettingsPanel } from '../ui/settings-firebase-panel.js';

let elm327InitializedForThisConnection = false;
let isVehicleConnectionVerified = false;

window.addEventListener('error', (event) => {
  logError('app-init', 'Yakalanmamış hata', event.error ?? event.message);
  showNonFatalErrorBanner(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  logError('app-init', 'Yakalanmamış promise reddi', event.reason);
  showNonFatalErrorBanner(event.reason);
});

async function bootstrap() {
  try {
    await initThemeManager();
    initBackButtonHandler();
    void initKeepAwake();
    await initOwnerName();
    await initGreetingPreferences();
    await initVehicleMarkerPreference();
    void requestAllPermissionsUpfront();
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
    initNavigationDriveView();
    initFuelView();
    initDiagnosticsView();
    initAiView();
    initSettingsView();
    initFirebaseSettingsPanel();
    void initFirebaseService();
    initSpeedCameraService();
    initSpeedWarning();
    await initAverageSpeedCorridor();
    void checkMaintenanceDue();
    void initBackgroundService();

    onBluetoothStateChange((state) => {
      if (state.status === 'connected' && !elm327InitializedForThisConnection) {
        elm327InitializedForThisConnection = true;
        void notifyVehicleConnected(state.deviceName ?? state.deviceAddress);
        void initializeElm327AndVoice();
      } else if (state.status !== 'connected') {
        elm327InitializedForThisConnection = false;
        setEcuStatus('idle');
        if (isVehicleConnectionVerified) {
          isVehicleConnectionVerified = false;
          void speak('Araç bağlantısı kesildi.');
        }
      }
    });

    void tryAutoConnect();
    logInfo('app-init', 'Smart Drive AI başlatıldı');
  } catch (error) {
    logError('app-init', 'Uygulama başlatılırken kritik hata oluştu', error);
    renderFatalError(error);
  }
}

async function initializeElm327AndVoice() {
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 4000;
  setEcuStatus('handshaking');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      attachElm327Transport();
      await runInitSequence();
      const [supportedPids, vin, fuelType] = await Promise.all([
        discoverSupportedPids(),
        readVin(),
        readFuelType(),
      ]);
      setVehicleInfo({ supportedPids, vin, fuelType });
      logInfo('app-init', `Araç bilgileri alındı (deneme ${attempt}/${MAX_ATTEMPTS})`, {
        supportedPidCount: supportedPids.length,
        vin,
        fuelType,
      });
      const verified = await speakConnectionGreeting(getOwnerName());
      if (!verified) {
        if (attempt < MAX_ATTEMPTS) {
          logWarn('app-init', `Bağlantı doğrulanamadı, ${RETRY_DELAY_MS}ms sonra tekrar denenecek (${attempt}/${MAX_ATTEMPTS})`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        setEcuStatus('failed', 'Kontak açık mı, motor çalışıyor mu kontrol edin');
        return;
      }
      isVehicleConnectionVerified = true;
      setEcuStatus('connected');
      initVoiceAlerts();
      initVoiceCommands();
      void startListeningMode();
      return;
    } catch (error) {
      logError('app-init', `ELM327 başlatma sırasında hata (deneme ${attempt}/${MAX_ATTEMPTS})`, error);
      detachElm327Transport();
      stopListeningMode();
      if (attempt >= MAX_ATTEMPTS) {
        elm327InitializedForThisConnection = false;
        setEcuStatus('failed', 'Bağlantı hatası - tekrar deneyin');
        return;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function bindConnectionStatusDot() {
  const dot = document.querySelector('.sda-status-dot');
  if (!dot) { logWarn('app-init', 'Durum noktası elemanı bulunamadı'); return; }
  const update = () => {
    const bt = getBluetoothState();
    const ecu = getEcuStatus();
    let domState = 'disconnected';
    if (bt.status === 'connected' && ecu.status === 'connected' && bt.quality !== 'weak') domState = 'connected';
    else if (bt.status === 'connected' || bt.status === 'reconnecting') domState = 'error';
    dot.setAttribute('data-state', domState);
  };
  onBluetoothStateChange(update);
  onEcuStatusChange(update);
  update();
}

function bindConnectionStatusToast() {
  onBluetoothStateChange((state) => {
    const existing = document.querySelector('[data-connection-toast]');
    if (existing) existing.remove();
    if (state.status === 'disconnected') return;
    const toast = document.createElement('div');
    toast.setAttribute('data-connection-toast', '');
    toast.setAttribute('role', 'status');
    const isConnected = state.status === 'connected';
    toast.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;' + `background:${isConnected ? 'var(--sda-success,#34D399)' : 'var(--sda-accent,#FF8A3D)'};` + 'color:#14171C;padding:8px 12px;font-size:.8rem;text-align:center;font-weight:600;';
    toast.textContent = isConnected
      ? `Bağlandı: ${state.deviceName ?? state.deviceAddress}`
      : state.status === 'reconnecting'
        ? 'Araç bağlantısı yeniden kuruluyor...'
        : `${state.deviceName ?? state.deviceAddress ?? 'Araç'} cihazına bağlanılıyor...`;
    document.body.appendChild(toast);
    if (isConnected) setTimeout(() => toast.remove(), 4000);
  });
}

function showNonFatalErrorBanner(error) {
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Bilinmeyen hata');
  const existing = document.querySelector('[data-error-banner]');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.setAttribute('data-error-banner', '');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--sda-danger,#FF5A5F);color:#14171C;padding:10px 12px;font-size:.8rem;white-space:pre-wrap;word-break:break-word;';
  banner.textContent = `Hata: ${details}`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'float:right;background:none;border:none;font-size:1rem;padding:0 4px;';
  closeBtn.addEventListener('click', () => banner.remove());
  banner.prepend(closeBtn);
  document.body.appendChild(banner);
}

function renderFatalError(error) {
  const root = document.getElementById('app-root');
  if (!root) return;
  const details = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error ?? 'Bilinmeyen hata');
  root.innerHTML = `<div class="sda-empty-state" role="alert"><p class="sda-empty-state__title">Uygulama başlatılamadı</p><p>Lütfen uygulamayı yeniden başlatın. Aşağıdaki teknik detayı geliştiriciyle paylaşabilirsiniz.</p><pre style="white-space:pre-wrap;text-align:left;font-size:.75rem;color:var(--sda-danger);background:var(--sda-bg-elevated);padding:12px;border-radius:8px;margin-top:12px;overflow-x:auto;">${escapeHtml(details)}</pre></div>`;
}

function escapeHtml(text) { return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap); else bootstrap();
