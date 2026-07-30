/**
 * fuel-repository.js
 * ---------------------------------------------------------------------------
 * Yakıt alımları (litre, tutar, kilometre, litre fiyatı) veri erişim katmanı.
 * ---------------------------------------------------------------------------
 */

import { getDb } from './database.js';

/**
 * @typedef {Object} FuelPurchase
 * @property {number} id
 * @property {number} purchased_at
 * @property {number} liters
 * @property {number} amount
 * @property {number|null} odometer_km
 * @property {number|null} price_per_liter
 */

/**
 * Yeni bir yakıt alımı kaydeder.
 * @param {Omit<FuelPurchase, 'id'>} purchase
 * @returns {Promise<number>} Yeni kaydın id'si.
 */
export async function addFuelPurchase(purchase) {
  const db = getDb();
  const result = await db.run(
    'INSERT INTO fuel_purchases (purchased_at, liters, amount, odometer_km, price_per_liter) VALUES (?, ?, ?, ?, ?)',
    [purchase.purchased_at, purchase.liters, purchase.amount, purchase.odometer_km ?? null, purchase.price_per_liter ?? null],
  );
  return result.changes?.lastId ?? -1;
}

/**
 * Yakıt alımlarını en yeniden en eskiye sıralı döndürür.
 * @param {number} [limit=100]
 * @returns {Promise<FuelPurchase[]>}
 */
export async function listFuelPurchases(limit = 100) {
  const db = getDb();
  const result = await db.query(
    'SELECT * FROM fuel_purchases ORDER BY purchased_at DESC LIMIT ?',
    [limit],
  );
  return result.values ?? [];
}

/**
 * Bir yakıt alım kaydını siler.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteFuelPurchase(id) {
  const db = getDb();
  await db.run('DELETE FROM fuel_purchases WHERE id = ?', [id]);
}
