/**
 * trip-recorder.js
 * ---------------------------------------------------------------------------
 * Yolculuk kaydı Bluetooth bağlantısıyla izlemeye başlar, fakat veritabanına
 * gerçek bir trips kaydı ancak araç anlamlı biçimde hareket ettikten sonra
 * yazılır. Böylece kontak/OBD testi, park halinde bağlantı ve uygulamanın
 * beklenmedik kapanması 0 km yolculuk üretmez.
 * ---------------------------------------------------------------------------
 */

import { onStateChange as onBluetoothStateChange } from '../bluetooth/bluetooth-manager.js';
import { onPosition } from '../core/gps-tracker.js';
import { queryPid } from '../obd/elm327.js';
import { createTrip, updateTripSummary, addTripPoint, deleteInvalidTrips } from '../data/trip-repository.js';
import { haversineDistanceKm } from './geo-utils.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

const MIN_POINT_INTERVAL_MS = 4000;
const FUEL_SAMPLE_INTERVAL_MS = 3000;
/** 50 metrenin altındaki oturumlar yolculuk sayılmaz. */
const MIN_SAVE_DISTANCE_KM = 0.05;
const STOICHIOMETRIC_AFR = 14.7;
const FUEL_DENSITY_G_PER_L = 750;

/**
 * @typedef {Object} ActiveTripState
 * @property {number|null} tripId
 * @property {number} startedAt
 * @property {number} distanceKm
 * @property {number} maxSpeedKmh
 * @property {number} fuelUsedLiters
 * @property {{lat: number, lng: number, at: number}|null} lastPoint
 * @property {{lat:number,lng:number,speedKmh:number,at:number}[]} pendingPoints
 * @property {Promise<number>|null} persistencePromise
 */

/** @type {ActiveTripState|null} */
let active = null;
let startInProgress = false;
let unsubscribePosition = null;
let fuelSampleInterval = null;
let unsubscribeBluetooth = null;

export function initTripRecorder() {
  if (unsubscribeBluetooth) return;

  // Önceki sürümlerden kalan 0 km / yarım kayıtları tek seferde temizle.
  void deleteInvalidTrips().catch((error) => {
    logWarn('trip-recorder', 'Eski geçersiz yolculuklar temizlenemedi', error);
  });

  unsubscribeBluetooth = onBluetoothStateChange((state) => {
    if (state.status === 'connected' && !active && !startInProgress) {
      startTrip();
    } else if (state.status !== 'connected' && active) {
      void stopTrip();
    }
  });

  logInfo('trip-recorder', 'Yolculuk kaydı modülü başlatıldı; gerçek hareket bekleniyor.');
}

export function getActiveTripStats() {
  if (!active) return null;
  return {
    tripId: active.tripId,
    startedAt: active.startedAt,
    distanceKm: active.distanceKm,
    maxSpeedKmh: active.maxSpeedKmh,
  };
}

export function disposeTripRecorder() {
  unsubscribeBluetooth?.();
  unsubscribeBluetooth = null;
  if (active) void stopTrip();
}

/**
 * Bluetooth bağlandığında yalnızca bellekte aday yolculuk açılır.
 * SQLite satırı burada oluşturulmaz.
 */
function startTrip() {
  startInProgress = true;
  try {
    active = {
      tripId: null,
      startedAt: Date.now(),
      distanceKm: 0,
      maxSpeedKmh: 0,
      fuelUsedLiters: 0,
      lastPoint: null,
      pendingPoints: [],
      persistencePromise: null,
    };

    unsubscribePosition = onPosition(handleTripPosition);
    startFuelSampling();
    logInfo('trip-recorder', 'Aday yolculuk başladı; 50 m hareket bekleniyor.');
  } finally {
    startInProgress = false;
  }
}

async function ensureTripPersisted(state) {
  if (state.tripId != null) return state.tripId;
  if (state.persistencePromise) return state.persistencePromise;
  if (state.distanceKm < MIN_SAVE_DISTANCE_KM) return -1;

  state.persistencePromise = (async () => {
    const tripId = await createTrip(state.startedAt);
    state.tripId = tripId;

    const buffered = state.pendingPoints.splice(0);
    for (const point of buffered) {
      try {
        await addTripPoint(tripId, point.lat, point.lng, point.speedKmh, point.at);
      } catch (error) {
        logWarn('trip-recorder', 'Bekleyen GPS noktası kaydedilemedi', error);
      }
    }

    logInfo('trip-recorder', `Gerçek yolculuk kaydı açıldı (id: ${tripId}, ${round2(state.distanceKm)} km)`);
    return tripId;
  })().catch((error) => {
    state.persistencePromise = null;
    logError('trip-recorder', 'Yolculuk DB kaydı açılamadı', error);
    return -1;
  });

  return state.persistencePromise;
}

async function stopTrip() {
  if (!active) return;
  const finished = active;
  active = null;

  unsubscribePosition?.();
  unsubscribePosition = null;
  stopFuelSampling();

  // Araç 50 m bile gitmediyse DB'de hiçbir satır oluşturulmaz.
  if (finished.distanceKm < MIN_SAVE_DISTANCE_KM) {
    logInfo('trip-recorder', `Hareketsiz/çok kısa oturum yok sayıldı (${round2(finished.distanceKm)} km)`);
    return;
  }

  const tripId = await ensureTripPersisted(finished);
  if (tripId < 0) return;

  const durationS = Math.round((Date.now() - finished.startedAt) / 1000);
  const durationHours = durationS / 3600;
  const avgSpeedKmh = durationHours > 0 ? finished.distanceKm / durationHours : 0;

  try {
    await updateTripSummary(tripId, {
      end_time: Date.now(),
      distance_km: round2(finished.distanceKm),
      avg_speed_kmh: round2(avgSpeedKmh),
      max_speed_kmh: round2(finished.maxSpeedKmh),
      fuel_used_l: round2(finished.fuelUsedLiters),
      duration_s: durationS,
    });
    logInfo('trip-recorder', `Yolculuk bitti (id: ${tripId}, ${round2(finished.distanceKm)} km)`);
  } catch (error) {
    logError('trip-recorder', 'Yolculuk özeti kaydedilemedi', error);
  }
}

function handleTripPosition(position) {
  if (!active) return;
  const state = active;
  const { latitude, longitude, speedKmh } = position;
  const now = position.timestamp;

  if (state.lastPoint) {
    const segmentKm = haversineDistanceKm(
      state.lastPoint.lat, state.lastPoint.lng, latitude, longitude,
    );
    if (segmentKm < 1) state.distanceKm += segmentKm;
  }

  state.maxSpeedKmh = Math.max(state.maxSpeedKmh, speedKmh || 0);

  const shouldPersistPoint = !state.lastPoint || now - state.lastPoint.at >= MIN_POINT_INTERVAL_MS;
  state.lastPoint = { lat: latitude, lng: longitude, at: now };

  if (shouldPersistPoint) {
    const point = { lat: latitude, lng: longitude, speedKmh: speedKmh || 0, at: now };
    if (state.tripId != null) {
      addTripPoint(state.tripId, point.lat, point.lng, point.speedKmh, point.at).catch((error) => {
        logWarn('trip-recorder', 'GPS noktası kaydedilemedi', error);
      });
    } else {
      // Sadece hareket doğrulanana kadarki birkaç noktayı bellekte tut.
      state.pendingPoints.push(point);
      if (state.pendingPoints.length > 30) state.pendingPoints.shift();
    }
  }

  if (state.tripId == null && state.distanceKm >= MIN_SAVE_DISTANCE_KM) {
    void ensureTripPersisted(state);
  }
}

function startFuelSampling() {
  let sampleInFlight = false;

  fuelSampleInterval = setInterval(async () => {
    if (!active || sampleInFlight) return;
    sampleInFlight = true;
    try {
      const maf = await queryPid('10');
      if (!maf) return;
      const litersPerHour = (maf.value * 3600) / (STOICHIOMETRIC_AFR * FUEL_DENSITY_G_PER_L);
      const litersThisSample = litersPerHour * (FUEL_SAMPLE_INTERVAL_MS / 3600000);
      active.fuelUsedLiters += litersThisSample;
    } catch (error) {
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

function round2(n) {
  return Math.round(n * 100) / 100;
}
