/**
 * gps-tracker.js
 * ---------------------------------------------------------------------------
 * Tek, paylaşılan GPS izleme kaynağı.
 *
 * Neden gerekli: Faz 4'te trip-recorder.js kendi Geolocation.watchPosition()
 * çağrısını açmıştı. Faz 5 ile navigasyon, hız sınırı uyarısı ve radar
 * yakınlık uyarısı da konuma ihtiyaç duyuyor. Her modülün kendi GPS izlemesini
 * açması hem pil tüketimini gereksiz artırır hem "kod tekrarından kaçınma"
 * ilkesine aykırı olur - bu yüzden GPS izleme BURAYA taşındı, diğer tüm
 * modüller (trip-recorder dahil) artık onPosition() ile abone olur.
 * ---------------------------------------------------------------------------
 */

import { Geolocation } from '@capacitor/geolocation';
import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { logError, logInfo, logWarn } from './logger.js';

/**
 * @typedef {Object} LivePosition
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} speedKmh - 0 veya pozitif; GPS hız verisi yoksa 0.
 * @property {number|null} headingDeg - Pusula yönü (derece), yoksa null.
 * @property {number} accuracy - Metre.
 * @property {number} timestamp - Unix ms.
 */

/** @type {Set<(position: LivePosition) => void>} */
const listeners = new Set();

/** @type {string|null} Geolocation.watchPosition izleyici kimliği. */
let watchId = null;

/** @type {LivePosition|null} Son bilinen konum (yeni abone olan hemen okuyabilsin diye). */
let lastPosition = null;

/** @type {(() => void)|null} */
let unsubscribeBluetooth = null;

/**
 * GPS izleyicisini başlatır: Bluetooth bağlantı durumuna abone olur, araç
 * bağlandığında (motor çalıştığında) otomatik izlemeye başlar, bağlantı
 * kesildiğinde otomatik durur. trip-recorder.js, navigation-view.js,
 * speed-warning.js gibi modüller GPS'i kendileri AÇIP KAPATMAZ - yalnızca
 * onPosition() ile abone olur. Uygulama açılışında bir kez çağrılmalıdır.
 */
export function initGpsTracker() {
  if (unsubscribeBluetooth) return; // zaten başlatılmış

  unsubscribeBluetooth = onBluetoothStateChange((state) => {
    if (state.status === 'connected') {
      void startWatching();
    } else if (state.status === 'disconnected') {
      stopWatching();
    }
  });

  logInfo('gps-tracker', 'GPS izleyici başlatıldı (Bluetooth bağlantısına bağlı)');
}

/**
 * @returns {Promise<void>}
 */
async function startWatching() {
  if (watchId !== null) return; // zaten izleniyor

  try {
    const permission = await Geolocation.requestPermissions();
    const granted = permission.location === 'granted' || permission.coarseLocation === 'granted';
    if (!granted) {
      logWarn('gps-tracker', 'Konum izni verilmedi');
      return;
    }

    watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 10000 },
      (position, error) => {
        if (error) {
          logWarn('gps-tracker', 'GPS okuma hatası', error);
          return;
        }
        if (position) handlePosition(position);
      },
    );

    logInfo('gps-tracker', 'GPS izleme başladı');
  } catch (error) {
    logError('gps-tracker', 'GPS izleme başlatılamadı', error);
  }
}

function stopWatching() {
  if (watchId === null) return;
  Geolocation.clearWatch({ id: watchId }).catch(() => {});
  watchId = null;
  lastPosition = null;
  logInfo('gps-tracker', 'GPS izleme durdu');
}

/**
 * Konum güncellemelerine abone olur. Zaten bilinen bir konum varsa hemen
 * (bir sonraki mikro-görevde) iletilir.
 * @param {(position: LivePosition) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function onPosition(callback) {
  listeners.add(callback);
  if (lastPosition) {
    queueMicrotask(() => callback(lastPosition));
  }
  return () => listeners.delete(callback);
}

/**
 * En son bilinen konumu döndürür (abone olmadan tek seferlik okuma için).
 * @returns {LivePosition|null}
 */
export function getLastPosition() {
  return lastPosition;
}

/**
 * @param {import('@capacitor/geolocation').Position} position
 */
function handlePosition(position) {
  const { latitude, longitude, speed, heading, accuracy } = position.coords;

  lastPosition = {
    latitude,
    longitude,
    speedKmh: speed && speed > 0 ? speed * 3.6 : 0,
    headingDeg: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
    accuracy,
    timestamp: Date.now(),
  };

  for (const listener of listeners) {
    listener(lastPosition);
  }
}
