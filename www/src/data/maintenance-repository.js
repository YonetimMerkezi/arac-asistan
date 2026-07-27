/**
 * maintenance-repository.js
 * ---------------------------------------------------------------------------
 * Bakım kalemleri (yağ, filtre, triger, lastik, muayene, sigorta, kasko,
 * egzoz emisyonu) veri erişim katmanı.
 * ---------------------------------------------------------------------------
 */

import { getDb } from './database.js';

/**
 * @typedef {Object} MaintenanceItem
 * @property {number} id
 * @property {string} type - ör. "oil", "filter", "timing_belt", "tires", "inspection", "insurance", "kasko", "emission".
 * @property {string} label - Türkçe görünen ad.
 * @property {number|null} last_done_km
 * @property {number|null} last_done_date
 * @property {number|null} interval_km
 * @property {number|null} interval_months
 * @property {string|null} notes
 */

/**
 * Yeni bir bakım kalemi tanımlar.
 * @param {Omit<MaintenanceItem, 'id'>} item
 * @returns {Promise<number>}
 */
export async function addMaintenanceItem(item) {
  const db = getDb();
  const result = await db.run(
    `INSERT INTO maintenance_items
      (type, label, last_done_km, last_done_date, interval_km, interval_months, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      item.type, item.label,
      item.last_done_km ?? null, item.last_done_date ?? null,
      item.interval_km ?? null, item.interval_months ?? null,
      item.notes ?? null,
    ],
  );
  return result.changes?.lastId ?? -1;
}

/**
 * Tüm bakım kalemlerini döndürür.
 * @returns {Promise<MaintenanceItem[]>}
 */
export async function listMaintenanceItems() {
  const db = getDb();
  const result = await db.query('SELECT * FROM maintenance_items ORDER BY id DESC');
  return result.values ?? [];
}

/**
 * Bir bakım kalemini (ör. yapıldığında son km/tarih) günceller.
 * @param {number} id
 * @param {Partial<MaintenanceItem>} fields
 * @returns {Promise<void>}
 */
export async function updateMaintenanceItem(id, fields) {
  const db = getDb();
  const columns = Object.keys(fields);
  if (columns.length === 0) return;

  const setClause = columns.map((col) => `${col} = ?`).join(', ');
  const values = columns.map((col) => fields[col]);
  await db.run(`UPDATE maintenance_items SET ${setClause} WHERE id = ?`, [...values, id]);
}

/**
 * Bir bakım kalemini siler.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteMaintenanceItem(id) {
  const db = getDb();
  await db.run('DELETE FROM maintenance_items WHERE id = ?', [id]);
}
