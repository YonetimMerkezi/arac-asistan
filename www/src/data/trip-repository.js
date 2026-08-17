/**
 * trip-repository.js
 * ---------------------------------------------------------------------------
 * Yolculuk (trip) verisi için veri erişim katmanı.
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

export async function createTrip(startTime) {
  const db = getDb();
  const result = await db.run(
    'INSERT INTO trips (start_time) VALUES (?)',
    [startTime],
  );
  return result.changes?.lastId ?? -1;
}

export async function updateTripSummary(tripId, fields) {
  const db = getDb();
  const columns = Object.keys(fields);
  if (columns.length === 0) return;

  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  const values = columns.map((col) => fields[col]);
  await db.run(`UPDATE trips SET ${setClause} WHERE id = ?`, [...values, tripId]);
}

export async function addTripPoint(tripId, latitude, longitude, speedKmh, recordedAt) {
  const db = getDb();
  await db.run(
    'INSERT INTO trip_points (trip_id, latitude, longitude, speed_kmh, recorded_at) VALUES (?, ?, ?, ?, ?)',
    [tripId, latitude, longitude, speedKmh, recordedAt],
  );
}

export async function listTrips(limit = 50) {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT * FROM trips WHERE end_time IS NOT NULL AND COALESCE(distance_km, 0) >= 0.01 ORDER BY start_time DESC LIMIT ?',
      [limit],
    );
    return result.values ?? [];
  } catch (error) {
    logError('trip-repository', 'Yolculuklar listelenemedi', error);
    return [];
  }
}

export async function listTripsSince(sinceUnixMs) {
  try {
    const db = getDb();
    const result = await db.query(
      'SELECT * FROM trips WHERE start_time >= ? AND end_time IS NOT NULL AND COALESCE(distance_km, 0) >= 0.01 ORDER BY start_time DESC',
      [sinceUnixMs],
    );
    return result.values ?? [];
  } catch (error) {
    logError('trip-repository', 'Belirli tarihten sonraki yolculuklar okunamadı', error);
    return [];
  }
}

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

export async function deleteTrip(tripId) {
  const db = getDb();
  await db.run('DELETE FROM trip_points WHERE trip_id = ?', [tripId]);
  await db.run('DELETE FROM trips WHERE id = ?', [tripId]);
}

/**
 * Önceki sürümlerden kalmış 0 km ve tamamlanmamış yolculukları temizler.
 * Yeni kayıt modeli hareket gerçekleşmeden trips satırı oluşturmadığı için
 * bu kayıtlar artık normal akışta yeniden oluşmaz.
 * @returns {Promise<void>}
 */
export async function deleteInvalidTrips() {
  const db = getDb();
  await db.run(
    'DELETE FROM trip_points WHERE trip_id IN (SELECT id FROM trips WHERE end_time IS NULL OR COALESCE(distance_km, 0) < 0.01)',
  );
  await db.run(
    'DELETE FROM trips WHERE end_time IS NULL OR COALESCE(distance_km, 0) < 0.01',
  );
}

export async function sumDistanceSince(sinceUnixMs) {
  const db = getDb();
  const result = await db.query(
    'SELECT COALESCE(SUM(distance_km), 0) as total FROM trips WHERE start_time >= ? AND end_time IS NOT NULL AND COALESCE(distance_km, 0) >= 0.01',
    [sinceUnixMs],
  );
  return result.values?.[0]?.total ?? 0;
}

export async function getAggregateTripStats() {
  const db = getDb();
  const result = await db.query(
    'SELECT COALESCE(SUM(distance_km), 0) as dist, COALESCE(SUM(fuel_used_l), 0) as fuel FROM trips WHERE end_time IS NOT NULL AND COALESCE(distance_km, 0) >= 0.01',
  );
  const row = result.values?.[0] ?? { dist: 0, fuel: 0 };
  return { totalDistanceKm: row.dist, totalFuelL: row.fuel };
}
