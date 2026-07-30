/**
 * speed-camera-service.js
 * ---------------------------------------------------------------------------
 * Sabit hız denetim noktalarına (OSM'de highway=speed_camera olarak
 * etiketlenmiş, herkese açık haritalama verisi) yaklaşınca sesli uyarı verir.
 *
 * ÖNEMLİ: Bu, aktif polis radarı TESPİTİ (RF alıcısı) DEĞİLDİR - yalnızca
 * herkese açık OSM haritalama verisindeki SABİT nokta konumlarını gösterir
 * (Yandex Navi, Google Maps gibi uygulamaların da yaptığı gibi).
 * ---------------------------------------------------------------------------
 */

import { queryNearbyTaggedNodes } from './overpass-client.js';
import { onPosition } from '../core/gps-tracker.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { speak } from '../voice/tts.js';
import { logInfo } from '../core/logger.js';

/** @type {number} Bu yarıçap (metre) içindeki noktalar getirilir. */
const SEARCH_RADIUS_METERS = 2000;

/** @type {number} Önbelleği tazelemek için araç en az bu kadar (metre) yol almalı. */
const REFRESH_DISTANCE_METERS = 800;

/** @type {number} Bu mesafeye (metre) yaklaşınca sesli uyarı verilir. */
const ALERT_DISTANCE_METERS = 500;

/** @typedef {{lat: number, lon: number, alerted: boolean}} CameraPoint */

/** @type {CameraPoint[]} */
let cachedCameras = [];

/** @type {{lat: number, lon: number}|null} */
let lastRefreshLocation = null;

/** @type {(() => void)|null} */
let unsubscribe = null;

/** @type {Set<(cameras: CameraPoint[]) => void>} Harita ekranı gibi görsel tüketiciler için abonelik. */
const updateListeners = new Set();

/**
 * Şu an önbellekteki (en son konum çevresinde bulunan) sabit noktaları döndürür.
 * Harita ekranının ikon çizebilmesi için - sesli uyarı akışından BAĞIMSIZ.
 * @returns {CameraPoint[]}
 */
export function getCachedCameras() {
  return cachedCameras;
}

/**
 * Önbellek her tazelendiğinde (yeni konum çevresinde nokta bulunduğunda)
 * çağrılır - harita ekranı bunu dinleyip ikonlarını güncel tutar.
 * @param {(cameras: CameraPoint[]) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function onCamerasUpdate(callback) {
  updateListeners.add(callback);
  if (cachedCameras.length > 0) {
    queueMicrotask(() => callback(cachedCameras));
  }
  return () => updateListeners.delete(callback);
}

/**
 * Hız denetim noktası izleyicisini başlatır.
 */
export function initSpeedCameraService() {
  if (unsubscribe) return;
  unsubscribe = onPosition(handlePosition);
  logInfo('speed-camera-service', 'Hız denetim noktası izleyicisi başlatıldı');
}

/**
 * İzleyiciyi durdurur (bellek sızıntısı önleme).
 */
export function disposeSpeedCameraService() {
  unsubscribe?.();
  unsubscribe = null;
  cachedCameras = [];
  lastRefreshLocation = null;
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
async function handlePosition(position) {
  const { latitude, longitude } = position;

  const needsRefresh = !lastRefreshLocation
    || haversineDistanceKm(lastRefreshLocation.lat, lastRefreshLocation.lon, latitude, longitude) * 1000 > REFRESH_DISTANCE_METERS;

  if (needsRefresh) {
    await refreshCameras(latitude, longitude);
  }

  checkProximity(latitude, longitude);
}

/**
 * Overpass'ten yakındaki sabit noktaları çeker ve önbelleği günceller.
 * @param {number} lat
 * @param {number} lon
 */
async function refreshCameras(lat, lon) {
  lastRefreshLocation = { lat, lon };

  const elements = await queryNearbyTaggedNodes(lat, lon, SEARCH_RADIUS_METERS, 'highway', 'speed_camera');

  cachedCameras = elements
    .filter((el) => typeof el.lat === 'number' && typeof el.lon === 'number')
    .map((el) => ({ lat: el.lat, lon: el.lon, alerted: false }));

  if (cachedCameras.length > 0) {
    logInfo('speed-camera-service', `${cachedCameras.length} sabit nokta bulundu`);
  }

  for (const listener of updateListeners) {
    listener(cachedCameras);
  }
}

/**
 * Önbellekteki noktalara olan mesafeyi kontrol eder; eşiğin altına
 * girildiğinde (ve daha önce uyarılmadıysa) sesli uyarı verir.
 * @param {number} lat
 * @param {number} lon
 */
function checkProximity(lat, lon) {
  for (const camera of cachedCameras) {
    if (camera.alerted) continue;

    const distanceMeters = haversineDistanceKm(lat, lon, camera.lat, camera.lon) * 1000;
    if (distanceMeters <= ALERT_DISTANCE_METERS) {
      camera.alerted = true;
      void speak(`${Math.round(distanceMeters / 100) * 100} metre sonra hız denetim noktası.`);
    }
  }
}
