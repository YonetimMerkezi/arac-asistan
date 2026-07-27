/**
 * database.js
 * ---------------------------------------------------------------------------
 * SQLite bağlantı yaşam döngüsü ve şema tanımı.
 *
 * @capacitor-community/sqlite üzerine ince bir katman. Diğer modüller
 * (trip-repository.js gibi) ham SQL yazmak yerine buradaki `getDb()` ve
 * yardımcı fonksiyonları kullanır - bağlantı açma/kapama mantığı tek
 * yerde toplanır (bellek sızıntısı ve çift-açma hatalarını önler).
 * ---------------------------------------------------------------------------
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { logError, logInfo } from '../core/logger.js';

/** @type {string} Veritabanı dosya adı (uzantısız, plugin kendi ekler). */
const DB_NAME = 'smart_drive_ai';

/** @type {number} Şema sürümü - şema değiştiğinde artırılmalı (migration tetikler). */
const DB_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  distance_km REAL NOT NULL DEFAULT 0,
  avg_speed_kmh REAL NOT NULL DEFAULT 0,
  max_speed_kmh REAL NOT NULL DEFAULT 0,
  fuel_used_l REAL NOT NULL DEFAULT 0,
  fuel_cost REAL,
  duration_s INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trip_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_kmh REAL,
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trip_points_trip_id ON trip_points(trip_id);

CREATE TABLE IF NOT EXISTS speed_corridors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entry_lat REAL NOT NULL,
  entry_lon REAL NOT NULL,
  exit_lat REAL NOT NULL,
  exit_lon REAL NOT NULL,
  limit_kmh REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS fuel_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchased_at INTEGER NOT NULL,
  liters REAL NOT NULL,
  amount REAL NOT NULL,
  odometer_km REAL,
  price_per_liter REAL
);

CREATE TABLE IF NOT EXISTS maintenance_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  last_done_km REAL,
  last_done_date INTEGER,
  interval_km REAL,
  interval_months INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS dtc_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  read_at INTEGER NOT NULL,
  codes_json TEXT NOT NULL
);
`;

/** @type {SQLiteConnection} */
const sqliteConnection = new SQLiteConnection(CapacitorSQLite);

/** @type {import('@capacitor-community/sqlite').SQLiteDBConnection|null} */
let db = null;

/**
 * Veritabanı bağlantısını açar ve şemayı (yoksa) oluşturur. Uygulama
 * açılışında bir kez çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function initDatabase() {
  if (db) return; // zaten açık

  try {
    const isConsistent = (await sqliteConnection.checkConnectionsConsistency()).result;
    const alreadyOpen = (await sqliteConnection.isConnection(DB_NAME, false)).result;

    db = isConsistent && alreadyOpen
      ? await sqliteConnection.retrieveConnection(DB_NAME, false)
      : await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);

    await db.open();
    await db.execute(SCHEMA_SQL);
    logInfo('database', 'Veritabanı hazır');
  } catch (error) {
    logError('database', 'Veritabanı başlatılamadı', error);
    throw error;
  }
}

/**
 * Açık veritabanı bağlantısını döndürür. initDatabase() önce çağrılmalıdır.
 * @returns {import('@capacitor-community/sqlite').SQLiteDBConnection}
 */
export function getDb() {
  if (!db) {
    throw new Error('Veritabanı henüz başlatılmadı - önce initDatabase() çağrılmalı');
  }
  return db;
}

/**
 * Bağlantıyı kapatır (uygulama arka plana alınırken/kapanırken kullanılabilir).
 * @returns {Promise<void>}
 */
export async function closeDatabase() {
  if (!db) return;
  try {
    await sqliteConnection.closeConnection(DB_NAME, false);
  } catch (error) {
    logError('database', 'Veritabanı kapatılırken hata', error);
  } finally {
    db = null;
  }
}
