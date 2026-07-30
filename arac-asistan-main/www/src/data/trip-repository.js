/**
 * trip-repository.js
 * ---------------------------------------------------------------------------
 * Yolculuk (trip) verisi için veri erişim katmanı.
 *
 * Tüm ham SQL burada toplanır; trip-recorder.js ve rapor modülleri yalnızca
 * bu fonksiyonları çağırır, SQL bilmez (SOLID: Single Responsibility,
 * kod tekrarını önleme).
 * ---------------------------------------------------------------------------
 */

import { getDb } from './database.js';
import { logError } from '../core/logger.js';

/**
 * @typedef {Object} Trip
 * @property {number} id
 * @property {number} start_time
 * @property {number|null} end_time
 * @property {number} distance_km
 * @property {number} avg_speed_kmh
 * @property {number} max_speed_kmh
 * @property {number} fuel_used_l
 * @property {number|null} fuel_cost
 * @property {number} duration_s
 *
 * @typedef {Object} TripPoint
 * @property {number} latitude
 * @property {number} longitude
 * @property {number|null} speed_kmh
 * @property {number} recorded_at
 */

/**
 * Yeni bir yolculuk kaydı başlatır.
 * @param {number} startTime - Unix ms.
 * @returns {Promise<number>} Yeni yolculuğun id'si.
 */
export async function createTrip(startTime) {
  const db = getDb();
  const result = await db.run(
    'INSERT INTO trips (start_time) VALUES (?)',
    [startTime],
  );
  return result.changes?.lastId ?? -1;
}

/**
 * Bir yolculuğun özet alanlarını (mesafe, hız, yakıt, süre, bitiş zamanı) günceller.
 * @param {number} tripId
 * @param {Partial<Trip>} fields
 * @returns {Promise<void>}
 */
export async function updateTripSummary(tripId, fields) {
  const db = getDb();
  const columns = Object.keys(fields);
  if (columns.length === 0) return;

  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  const values = columns.map((col) => fields[col]);

  await db.run(`UPDATE trips SET ${setClause} WHERE id = ?`, [...values, tripId]);
}

/**
 * Bir yolculuğa yeni bir GPS noktası ekler.
 * @param {number} tripId
 * @param {number} latitude
 * @param {number} longitude
 * @param {number|null} speedKmh
 * @param {number} recordedAt - Unix ms.
 * @returns {Promise<void>}
 */
export async function addTripPoint(tripId, latitude, longitude, speedKmh, recordedAt) {
  const db = getDb();
  await db.run(
    'INSERT INTO trip_points (trip_id, latitude, longitude, speed_kmh, recorded_at) VALUES (?, ?, ?, ?, ?)',
    [tripId, latitude, longitude, speedKmh, recordedAt],
  );
}

/**
 * Tüm yolculukları en yeniden en eskiye sıralı döndürür.
 * @param {number} [limit=50]
 * @returns {Promise<Trip[]>}
 */
export async function listTrips(limit = 50) {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT * FROM trips ORDER BY start_time DESC LIMIT ?',
      [limit],
    );
    return result.values ?? [];
  } catch (error) {
    logError('trip-repository', 'Yolculuklar listelenemedi', error);
    return [];
  }
}

/**
 * Belirli bir zaman damgasından SONRA başlayan tüm yolculukları (tamamlanmış
 * veya devam eden) en yeniden en eskiye sıralı döndürür. ai/maintenance-predictor.js
 * (günlük ortalama km hesabı) ve ai/weekly-report.js (haftalık özet) kullanır.
 * @param {number} sinceUnixMs
 * @returns {Promise<Trip[]>}
 */
export async function listTripsSince(sinceUnixMs) {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT * FROM trips WHERE start_time >= ? ORDER BY start_time DESC',
      [sinceUnixMs],
    );
    return result.values ?? [];
  } catch (error) {
    logError('trip-repository', 'Belirli tarihten sonraki yolculuklar okunamadı', error);
    return [];
  }
}

/**
 * Tek bir yolculuğun detayını (özet + tüm GPS noktaları) döndürür.
 * @param {number} tripId
 * @returns {Promise<{trip: Trip|null, points: TripPoint[]}>}
 */
export async function getTripDetail(tripId) {
  const db = getDb();

  const tripResult = await db.query('SELECT * FROM trips WHERE id = ?', [tripId]);
  const trip = tripResult.values?.[0] ?? null;

  const pointsResult = await db.query(
    'SELECT latitude, longitude, speed_kmh, recorded_at FROM trip_points WHERE trip_id = ? ORDER BY recorded_at ASC',
    [tripId],
  );

  return { trip, points: pointsResult.values ?? [] };
}

/**
 * Bir yolculuğu ve tüm GPS noktalarını siler.
 * @param {number} tripId
 * @returns {Promise<void>}
 */
export async function deleteTrip(tripId) {
  const db = getDb();
  await db.run('DELETE FROM trip_points WHERE trip_id = ?', [tripId]);
  await db.run('DELETE FROM trips WHERE id = ?', [tripId]);
}

/**
 * Belirli bir zaman damgasından SONRA biten yolculukların toplam mesafesini
 * döndürür. Kilometre sayacı tahmini (fuel/odometer-estimator.js) için kullanılır.
 * @param {number} sinceUnixMs
 * @returns {Promise<number>} Kilometre.
 */
export async function sumDistanceSince(sinceUnixMs) {
  const db = getDb();
  const result = await db.query(
    'SELECT COALESCE(SUM(distance_km), 0) as total FROM trips WHERE start_time >= ? AND end_time IS NOT NULL',
    [sinceUnixMs],
  );
  return result.values?.[0]?.total ?? 0;
}

/**
 * Tüm tamamlanmış yolculukların toplam mesafe ve yakıt tüketimini döndürür.
 * "Ortalama tüketim" sesli komutu ve Faz 6 raporları bunu kullanır.
 * @returns {Promise<{totalDistanceKm: number, totalFuelL: number}>}
 */
export async function getAggregateTripStats() {
  const db = getDb();
  const result = await db.query(
    'SELECT COALESCE(SUM(distance_km), 0) as dist, COALESCE(SUM(fuel_used_l), 0) as fuel FROM trips WHERE end_time IS NOT NULL',
  );
  const row = result.values?.[0] ?? { dist: 0, fuel: 0 };
  return { totalDistanceKm: row.dist, totalFuelL: row.fuel };
}
