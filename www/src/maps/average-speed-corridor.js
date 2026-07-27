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
import { listCorridors } from '../data/corridor-repository.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { speak } from '../voice/tts.js';
import { logInfo } from '../core/logger.js';

/** @type {number} Giriş/çıkış noktasına bu mesafede (metre) tetiklenir. */
const TRIGGER_RADIUS_METERS = 60;

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
