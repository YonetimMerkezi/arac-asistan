/**
 * average-speed-corridor.js
 * ---------------------------------------------------------------------------
 * Ortalama hız koridoru giriş/çıkış tespiti ve ortalama hız hesabı.
 *
 * corridor-repository.js'ten okunan (kullanıcı tanımlı) koridorları GPS
 * akışıyla karşılaştırır. Girişe/çıkışa yeterince yaklaşılınca:
 *  - Giriş: zaman damgası kaydedilir, sesli bilgilendirme yapılır
 *  - Çıkış: geçen süre + koridor uzunluğu (giriş-çıkış düz hat mesafesi,
 *    bir yaklaşıklıktır) üzerinden ortalama hız hesaplanır ve seslendirilir
 * ---------------------------------------------------------------------------
 */

import { onPosition } from '../core/gps-tracker.js';
import { listCorridors, createCorridor } from '../data/corridor-repository.js';
import { getCachedCameras } from './speed-camera-service.js';
import { findAverageSpeedZones } from './average-speed-zone-finder.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { speak } from '../voice/tts.js';
import { logInfo, logWarn } from '../core/logger.js';

/** @type {number} Giriş/çıkış noktasına bu mesafede (metre) tetiklenir. */
const TRIGGER_RADIUS_METERS = 60;

/** @type {number} Otomatik tespit taramasının yarıçapı (metre). */
const AUTO_DETECT_RADIUS_METERS = 5000;

/** @type {number} İki otomatik tarama arasında araç en az bu kadar (metre) yol almalı. */
const AUTO_DETECT_REFRESH_METERS = 2000;

/** @type {number} Yeni tespit edilen bir koridor, mevcut bir koridorun girişine bu mesafeden (metre)
 * yakınsa TEKRAR olarak kabul edilip eklenmez (aynı koridoru sürekli yeniden kaydetmeyi önler). */
const DUPLICATE_THRESHOLD_METERS = 150;

/** @type {{lat: number, lon: number}|null} */
let lastAutoDetectLocation = null;

/** @type {import('../data/corridor-repository.js').SpeedCorridor[]} */
let corridors = [];

/** @type {Map<number, number>} corridorId -> giriş zamanı (ms), koridordeyken. */
const activeEntries = new Map();

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * Koridor izleyicisini başlatır: tanımlı koridorları yükler, GPS akışına abone olur.
 * @returns {Promise<void>}
 */
export async function initAverageSpeedCorridor() {
  if (unsubscribe) return;

  corridors = await listCorridors();
  unsubscribe = onPosition(handlePosition);

  logInfo('average-speed-corridor', `${corridors.length} koridor yüklendi`);
}

/**
 * İzleyiciyi durdurur (bellek sızıntısı önleme).
 */
export function disposeAverageSpeedCorridor() {
  unsubscribe?.();
  unsubscribe = null;
  activeEntries.clear();
}

/**
 * Yeni bir koridor eklendiğinde (Faz 9 ayarlar ekranı) önbelleği tazeler.
 * @returns {Promise<void>}
 */
export async function refreshCorridors() {
  corridors = await listCorridors();
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function handlePosition(position) {
  for (const corridor of corridors) {
    const isInside = activeEntries.has(corridor.id);

    if (!isInside) {
      const distanceToEntry = haversineDistanceKm(
        position.latitude, position.longitude, corridor.entry_lat, corridor.entry_lon,
      ) * 1000;

      if (distanceToEntry <= TRIGGER_RADIUS_METERS) {
        activeEntries.set(corridor.id, Date.now());
        void speak(`${corridor.name} ortalama hız koridoruna girdiniz. Sınır ${corridor.limit_kmh} kilometre.`);
      }
    } else {
      const distanceToExit = haversineDistanceKm(
        position.latitude, position.longitude, corridor.exit_lat, corridor.exit_lon,
      ) * 1000;

      if (distanceToExit <= TRIGGER_RADIUS_METERS) {
        const enteredAt = activeEntries.get(corridor.id);
        activeEntries.delete(corridor.id);
        announceExit(corridor, enteredAt);
      }
    }
  }

  void maybeAutoDetectZones(position);
}

/**
 * Belirli bir mesafe kat edildiğinde, konum çevresinde otomatik koridor
 * tespiti dener ve bulunanları SESSİZCE kaydeder (Plan A - kullanıcı onayı
 * istenmez). Zaten kayıtlı (yakın girişli) bir koridorla çakışanlar atlanır.
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
async function maybeAutoDetectZones(position) {
  const needsScan = !lastAutoDetectLocation
    || haversineDistanceKm(
      lastAutoDetectLocation.lat, lastAutoDetectLocation.lon, position.latitude, position.longitude,
    ) * 1000 > AUTO_DETECT_REFRESH_METERS;

  if (!needsScan) return;
  lastAutoDetectLocation = { lat: position.latitude, lon: position.longitude };

  try {
    const candidates = await findAverageSpeedZones(
      position.latitude, position.longitude, AUTO_DETECT_RADIUS_METERS, getCachedCameras(),
    );

    for (const zone of candidates) {
      const isDuplicate = corridors.some((c) => haversineDistanceKm(
        c.entry_lat, c.entry_lon, zone.entryLat, zone.entryLon,
      ) * 1000 < DUPLICATE_THRESHOLD_METERS);
      if (isDuplicate) continue;

      await createCorridor({
        name: zone.name,
        entry_lat: zone.entryLat,
        entry_lon: zone.entryLon,
        exit_lat: zone.exitLat,
        exit_lon: zone.exitLon,
        limit_kmh: zone.limitKmh,
      });
      logInfo('average-speed-corridor', `Otomatik koridor kaydedildi: ${zone.name} (${zone.limitKmh} km/h)`);
      corridors = await listCorridors(); // Yeni eklenen hemen aktif olsun - tekrar tespit edilip yinelenmesin.
    }
  } catch (error) {
    logWarn('average-speed-corridor', 'Otomatik koridor taraması başarısız', error);
  }
}

/**
 * Koridordan çıkışta ortalama hızı hesaplayıp seslendirir.
 * @param {import('../data/corridor-repository.js').SpeedCorridor} corridor
 * @param {number} enteredAt
 */
function announceExit(corridor, enteredAt) {
  const elapsedHours = (Date.now() - enteredAt) / 3600000;
  const corridorLengthKm = haversineDistanceKm(
    corridor.entry_lat, corridor.entry_lon, corridor.exit_lat, corridor.exit_lon,
  );
  const avgSpeedKmh = elapsedHours > 0 ? corridorLengthKm / elapsedHours : 0;

  const exceeded = avgSpeedKmh > corridor.limit_kmh;
  const message = exceeded
    ? `${corridor.name} koridorundan çıktınız. Ortalama hızınız ${Math.round(avgSpeedKmh)} kilometre, sınırı aştınız.`
    : `${corridor.name} koridorundan çıktınız. Ortalama hızınız ${Math.round(avgSpeedKmh)} kilometre.`;

  void speak(message);
  logInfo('average-speed-corridor', message);
}
