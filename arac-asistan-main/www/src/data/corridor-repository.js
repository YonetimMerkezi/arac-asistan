/**
 * corridor-repository.js
 * ---------------------------------------------------------------------------
 * Ortalama hız koridoru (giriş/çıkış noktası + limit) veri erişim katmanı.
 *
 * NOT: Türkiye çapında hazır, ücretsiz bir "ortalama hız kontrol sistemi"
 * veri tabanı yok - bu yüzden koridorlar KULLANICI TARAFINDAN tanımlanır
 * (Faz 9 ayarlar ekranında bir "koridor ekle" formu ile). Bu dosya ve
 * average-speed-corridor.js mekanizmayı eksiksiz kurar; veri kaynağı
 * kullanıcının kendisidir - sahte/uydurma koridor verisi YOKTUR.
 * ---------------------------------------------------------------------------
 */

import { getDb } from './database.js';

/**
 * @typedef {Object} SpeedCorridor
 * @property {number} id
 * @property {string} name
 * @property {number} entry_lat
 * @property {number} entry_lon
 * @property {number} exit_lat
 * @property {number} exit_lon
 * @property {number} limit_kmh
 */

/**
 * Yeni bir koridor tanımlar.
 * @param {Omit<SpeedCorridor, 'id'>} corridor
 * @returns {Promise<number>} Yeni koridorun id'si.
 */
export async function createCorridor(corridor) {
  const db = getDb();
  const result = await db.run(
    'INSERT INTO speed_corridors (name, entry_lat, entry_lon, exit_lat, exit_lon, limit_kmh) VALUES (?, ?, ?, ?, ?, ?)',
    [corridor.name, corridor.entry_lat, corridor.entry_lon, corridor.exit_lat, corridor.exit_lon, corridor.limit_kmh],
  );
  return result.changes?.lastId ?? -1;
}

/**
 * Tüm tanımlı koridorları döndürür.
 * @returns {Promise<SpeedCorridor[]>}
 */
export async function listCorridors() {
  const db = getDb();
  const result = await db.query('SELECT * FROM speed_corridors');
  return result.values ?? [];
}

/**
 * Bir koridoru siler.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteCorridor(id) {
  const db = getDb();
  await db.run('DELETE FROM speed_corridors WHERE id = ?', [id]);
}
