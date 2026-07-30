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
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { logError, logInfo, logWarn } from './logger.js';

/**
 * @typedef {Object} LivePosition
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} speedKmh - 0 veya pozitif; GPS hız verisi yoksa 0.
 * @property {number|null} headingDeg - Pusula yönü (derece), yoksa null.
 * @property {number} accuracy - Metre.
 * @property {number|null} altitude - Rakım (metre), cihaz/GPS sağlamıyorsa null.
 * @property {number} timestamp - Unix ms.
 */

/** @type {Set<(position: LivePosition) => void>} */
const listeners = new Set();

/** @type {string|null} Geolocation.watchPosition izleyici kimliği. */
let watchId = null;

/** @type {LivePosition|null} Son bilinen konum (yeni abone olan hemen okuyabilsin diye). */
let lastPosition = null;

/** @type {{lat: number, lon: number, timestamp: number}|null} Hız yedek hesabı için ÖNCEKİ ham okuma. */
let previousRawReading = null;

/** @type {(() => void)|null} */
let unsubscribeBluetooth = null;

/**
 * GPS izleyicisini başlatır: Bluetooth bağlantı durumuna abone olur, araç
 * bağlandığında (motor çalıştığında) otomatik izlemeye başlar. trip-recorder.js,
 * speed-warning.js gibi modüller GPS'i kendileri AÇMAZ - yalnızca onPosition()
 * ile abone olur. Uygulama açılışında bir kez çağrılmalıdır.
 *
 * DÜZELTME: Önceden izin isteme SADECE Bluetooth bağlantısı kurulunca
 * tetikleniyordu - bu yüzden ELM327'ye hiç bağlanmamış bir kullanıcı Harita
 * ekranını açsa bile konum izni hiç istenmiyordu. Artık navigation-view.js
 * gibi konuma ihtiyaç duyan ekranlar ensureGpsTracking()'i DOĞRUDAN, araç
 * bağlantısından bağımsız olarak çağırabiliyor.
 */
export function initGpsTracker() {
  if (unsubscribeBluetooth) return; // zaten başlatılmış

  unsubscribeBluetooth = onBluetoothStateChange((state) => {
    if (state.status === 'connected') {
      void ensureGpsTracking();
    }
    // NOT: Bağlantı kesilince İZLEME DURDURULMUYOR - kullanıcı hâlâ Harita
    // ekranında olabilir. GPS yalnızca uygulama kapanınca durur.
  });

  logInfo('gps-tracker', 'GPS izleyici başlatıldı');
}

/**
 * GPS izlemeyi başlatır (izin gerekiyorsa ister). Zaten izleniyorsa hiçbir
 * şey yapmaz (idempotent) - hem Bluetooth bağlantısı hem navigation-view.js
 * gibi ekranlar güvenle çağırabilir.
 * @returns {Promise<boolean>} İzin verilip verilmediği / izleme başlayıp başlamadığı.
 */
export async function ensureGpsTracking() {
  if (watchId !== null) return true; // zaten izleniyor

  try {
    const permission = await Geolocation.requestPermissions();
    logInfo('gps-tracker', 'Konum izni sonucu', permission);

    const granted = permission.location === 'granted' || permission.coarseLocation === 'granted';
    if (!granted) {
      logWarn('gps-tracker', 'Konum izni verilmedi');
      return false;
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
    return true;
  } catch (error) {
    logError('gps-tracker', 'GPS izleme başlatılamadı', error);
    return false;
  }
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
  const { latitude, longitude, speed, heading, accuracy, altitude } = position.coords;
  const now = Date.now();

  // DÜZELTME: Bazı cihazlarda/GPS çiplerinde native `coords.speed` alanı
  // GÜVENİLİR DOLMUYOR - araç hareket halindeyken bile sürekli null/0
  // gelebiliyor ("anlık hız hep 0" şikayetinin sebebi). Native hız
  // yoksa/0 ise, ÖNCEKİ okumaya göre kat edilen mesafe/geçen süreden
  // KENDİMİZ hesaplıyoruz - GPS'in kendi hız alanı kadar hassas olmasa da,
  // gerçek hareketi "hep 0" göstermekten çok daha doğrudur.
  let speedKmh = speed && speed > 0 ? speed * 3.6 : 0;

  if (speedKmh === 0 && previousRawReading) {
    const elapsedSeconds = (now - previousRawReading.timestamp) / 1000;
    // Çok kısa aralıklarda (GPS gürültüsü) ya da çok uzun aralıklarda
    // (durup kalkma, uygulama arka plandaydı vb.) hesaplama güvenilmez -
    // makul bir pencerede (1-15 sn) hesaplanır.
    if (elapsedSeconds >= 1 && elapsedSeconds <= 15) {
      const distanceKm = haversineDistanceKm(previousRawReading.lat, previousRawReading.lon, latitude, longitude);
      const calculatedKmh = (distanceKm / elapsedSeconds) * 3600;
      // GPS "sıçraması" (aynı yerde dururken küçük konum gürültüsü) çok
      // düşük hızları abartmasın diye bir eşik uygulanır.
      if (calculatedKmh > 3) speedKmh = calculatedKmh;
    }
  }

  previousRawReading = { lat: latitude, lon: longitude, timestamp: now };

  lastPosition = {
    latitude,
    longitude,
    speedKmh,
    headingDeg: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
    accuracy,
    altitude: typeof altitude === 'number' && !Number.isNaN(altitude) ? altitude : null,
    timestamp: now,
  };

  for (const listener of listeners) {
    listener(lastPosition);
  }
}
