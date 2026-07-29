/**
 * trip-recorder.js
 * ---------------------------------------------------------------------------
 * Yolculuk kaydı: OBD bağlantısı kurulduğunda (araç çalıştığında) otomatik
 * başlar, bağlantı kesildiğinde (araç durduğunda) otomatik biter.
 *
 * Sorumlulukları:
 *  - Haversine ile kümülatif mesafe hesaplamak (GPS akışı core/gps-tracker.js'ten gelir)
 *  - MAF (hava kütle akışı, PID 10) entegrasyonuyla yakıt tüketimini tahmin
 *    etmek (Torque ve benzeri OBD uygulamalarının kullandığı, stokiyometrik
 *    hava/yakıt oranına dayalı yaygın bir yaklaşım)
 *  - Yolculuk özetini trip-repository.js üzerinden kalıcı hale getirmek
 *
 * NOT: GPS izlemeyi kendi AÇIP KAPAMAZ - core/gps-tracker.js bunu Bluetooth
 * bağlantı durumuna göre merkezi olarak yönetir; bu modül yalnızca onPosition()
 * ile abone olur (Faz 5'te navigasyon/hız uyarı modülleri de aynı kaynağı kullanır).
 * ---------------------------------------------------------------------------
 */

import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { onPosition } from '../core/gps-tracker.js';
import { queryPid } from '../obd/elm327.js';
import { createTrip, updateTripSummary, addTripPoint } from '../data/trip-repository.js';
import { haversineDistanceKm } from './geo-utils.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

/** @type {number} Ardışık iki GPS noktası arasında en az bu kadar süre (ms) geçmeli - DB şişmesin. */
const MIN_POINT_INTERVAL_MS = 4000;

/** @type {number} MAF örnekleme aralığı (ms). */
const FUEL_SAMPLE_INTERVAL_MS = 3000;

/** @type {number} Benzin için varsayılan stokiyometrik hava/yakıt oranı (kütlece). */
const STOICHIOMETRIC_AFR = 14.7;

/** @type {number} Benzin yoğunluğu (g/L), yakıt tipi bilinmiyorsa varsayılan. */
const FUEL_DENSITY_G_PER_L = 750;

/**
 * @typedef {Object} ActiveTripState
 * @property {number} tripId
 * @property {number} startedAt
 * @property {number} distanceKm
 * @property {number} maxSpeedKmh
 * @property {number} fuelUsedLiters
 * @property {{lat: number, lng: number, at: number}|null} lastPoint
 */

/** @type {ActiveTripState|null} */
let active = null;

/** @type {boolean} startTrip() senkron olarak HEMEN true yapar (ilk await'ten ÖNCE) -
 * bkz. startTrip()'in başındaki kritik hata düzeltmesi notu. */
let startInProgress = false;

/** @type {(() => void)|null} gps-tracker aboneliğini iptal eden fonksiyon. */
let unsubscribePosition = null;

/** @type {ReturnType<typeof setInterval>|null} */
let fuelSampleInterval = null;

/** @type {(() => void)|null} */
let unsubscribeBluetooth = null;

/**
 * Kayıt modülünü başlatır: Bluetooth bağlantı durumuna abone olur, bağlantı
 * kurulunca otomatik yolculuk başlatır, kesilince otomatik bitirir.
 */
export function initTripRecorder() {
  if (unsubscribeBluetooth) return; // zaten başlatılmış

  unsubscribeBluetooth = onBluetoothStateChange((state) => {
    if (state.status === 'connected' && !active && !startInProgress) {
      void startTrip();
    } else if (state.status !== 'connected' && active) {
      void stopTrip();
    }
  });

  logInfo('trip-recorder', 'Yolculuk kaydı modülü başlatıldı (otomatik başlat/bitir aktif)');
}

/**
 * Kaynakları serbest bırakır (bellek sızıntısı önleme).
 */
export function disposeTripRecorder() {
  unsubscribeBluetooth?.();
  unsubscribeBluetooth = null;
  if (active) void stopTrip();
}

/**
 * Yeni bir yolculuk başlatır: DB kaydı oluşturur, konum akışına abone olur,
 * yakıt örneklemesini başlatır.
 * @returns {Promise<void>}
 */
async function startTrip() {
  startInProgress = true; // KRİTİK: ilk await'ten ÖNCE, senkron olarak set edilir - bkz. dosya başı düzeltme notu.
  try {
    const startedAt = Date.now();
    const tripId = await createTrip(startedAt);

    active = {
      tripId,
      startedAt,
      distanceKm: 0,
      maxSpeedKmh: 0,
      fuelUsedLiters: 0,
      lastPoint: null,
    };

    unsubscribePosition = onPosition(handleTripPosition);
    startFuelSampling();

    logInfo('trip-recorder', `Yolculuk başladı (id: ${tripId})`);
  } catch (error) {
    logError('trip-recorder', 'Yolculuk başlatılamadı', error);
    active = null;
  } finally {
    startInProgress = false;
  }
}

/**
 * Aktif yolculuğu bitirir: abonelikleri kaldırır, özet alanları hesaplayıp DB'ye yazar.
 * @returns {Promise<void>}
 */
async function stopTrip() {
  if (!active) return;
  const finished = active;
  active = null;

  unsubscribePosition?.();
  unsubscribePosition = null;
  stopFuelSampling();

  const durationS = Math.round((Date.now() - finished.startedAt) / 1000);
  const durationHours = durationS / 3600;
  const avgSpeedKmh = durationHours > 0 ? finished.distanceKm / durationHours : 0;

  try {
    await updateTripSummary(finished.tripId, {
      end_time: Date.now(),
      distance_km: round2(finished.distanceKm),
      avg_speed_kmh: round2(avgSpeedKmh),
      max_speed_kmh: round2(finished.maxSpeedKmh),
      fuel_used_l: round2(finished.fuelUsedLiters),
      duration_s: durationS,
    });
    logInfo('trip-recorder', `Yolculuk bitti (id: ${finished.tripId}, ${round2(finished.distanceKm)} km)`);
  } catch (error) {
    logError('trip-recorder', 'Yolculuk özeti kaydedilemedi', error);
  }
}

/**
 * gps-tracker.js'ten gelen her yeni konumu işler: mesafe/hız istatistiklerini
 * günceller ve (throttle edilmiş) bir trip_points satırı ekler.
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function handleTripPosition(position) {
  if (!active) return;

  const { latitude, longitude, speedKmh } = position;
  const now = position.timestamp;

  if (active.lastPoint) {
    const segmentKm = haversineDistanceKm(
      active.lastPoint.lat, active.lastPoint.lng, latitude, longitude,
    );
    // GPS sıçramalarını (sinyal kaybı sonrası anlamsız uzun sıçrama) filtrele.
    if (segmentKm < 1) {
      active.distanceKm += segmentKm;
    }
  }

  active.maxSpeedKmh = Math.max(active.maxSpeedKmh, speedKmh);

  const shouldPersistPoint = !active.lastPoint || now - active.lastPoint.at >= MIN_POINT_INTERVAL_MS;
  active.lastPoint = { lat: latitude, lng: longitude, at: now };

  if (shouldPersistPoint) {
    addTripPoint(active.tripId, latitude, longitude, speedKmh, now).catch((error) => {
      logWarn('trip-recorder', 'GPS noktası kaydedilemedi', error);
    });
  }
}

/**
 * MAF tabanlı yakıt tüketimi örneklemesini başlatır.
 *
 * DÜZELTME: `setInterval`'ın async callback'i önceki turun bitmesini
 * BEKLEMEZ - komut kuyruğu yoğunken (birden fazla modül aynı ELM327 hattını
 * paylaşıyor) bir queryPid('10') çağrısı 3 saniyeden uzun sürebiliyordu,
 * bu da YENİ bir sorgunun ESKİSİ hâlâ beklerken kuyruğa eklenmesine, yani
 * tıkanıklığın kendi kendini beslemesine yol açıyordu. Artık bir örnekleme
 * hâlâ sürüyorsa yeni turlar sessizce atlanır.
 */
function startFuelSampling() {
  let sampleInFlight = false;

  fuelSampleInterval = setInterval(async () => {
    if (!active || sampleInFlight) return;
    sampleInFlight = true;
    try {
      const maf = await queryPid('10'); // g/s
      if (!maf) return;

      const litersPerHour = (maf.value * 3600) / (STOICHIOMETRIC_AFR * FUEL_DENSITY_G_PER_L);
      const litersThisSample = litersPerHour * (FUEL_SAMPLE_INTERVAL_MS / 3600000);
      active.fuelUsedLiters += litersThisSample;
    } catch (error) {
      // Tek bir örnekleme hatası kaydı bozmasın, sessizce atla.
      logWarn('trip-recorder', 'Yakıt örneklemesi başarısız', error);
    } finally {
      sampleInFlight = false;
    }
  }, FUEL_SAMPLE_INTERVAL_MS);
}

function stopFuelSampling() {
  if (fuelSampleInterval) {
    clearInterval(fuelSampleInterval);
    fuelSampleInterval = null;
  }
}

/**
 * @param {number} n
 * @returns {number} İki ondalık basamağa yuvarlanmış değer.
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
