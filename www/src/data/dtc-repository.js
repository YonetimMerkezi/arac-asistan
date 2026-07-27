/**
 * dtc-repository.js
 * ---------------------------------------------------------------------------
 * Arıza kodu (DTC) okuma geçmişi veri erişim katmanı.
 * ---------------------------------------------------------------------------
 */

import { getDb } from './database.js';

/**
 * @typedef {Object} DtcHistoryEntry
 * @property {number} id
 * @property {number} read_at
 * @property {string[]} codes
 */

/**
 * Yeni bir okuma kaydı ekler.
 * @param {string[]} codes
 * @returns {Promise<void>}
 */
export async function recordDtcReading(codes) {
  const db = getDb();
  await db.run(
    'INSERT INTO dtc_history (read_at, codes_json) VALUES (?, ?)',
    [Date.now(), JSON.stringify(codes)],
  );
}

/**
 * Arıza kodu okuma geçmişini en yeniden en eskiye döndürür.
 * @param {number} [limit=50]
 * @returns {Promise<DtcHistoryEntry[]>}
 */
export async function listDtcHistory(limit = 50) {
  const db = getDb();
  const result = await db.query(
    'SELECT * FROM dtc_history ORDER BY read_at DESC LIMIT ?',
    [limit],
  );
  return (result.values ?? []).map((row) => ({
    ...row,
    codes: JSON.parse(row.codes_json),
  }));
}
