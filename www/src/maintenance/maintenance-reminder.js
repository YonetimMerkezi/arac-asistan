/**
 * maintenance-reminder.js
 * ---------------------------------------------------------------------------
 * Bakım kalemlerini tahmini kilometre sayacı ve güncel tarihe göre kontrol
 * eder; süresi/kilometresi dolan bir kalem için BİR KEZ sesli hatırlatma yapar
 * (aynı kalem için tekrar tekrar uyarmaz - Preferences'ta "uyarıldı" işareti tutulur).
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { listMaintenanceItems } from '../data/maintenance-repository.js';
import { getEstimatedOdometerKm } from '../fuel/odometer-estimator.js';
import { speak } from '../voice/tts.js';
import { logInfo } from '../core/logger.js';

/** @type {string} Daha önce uyarılmış kalem id'lerini tutan Preferences anahtarı. */
const ALERTED_KEY = 'sda_maintenance_alerted_ids';

/**
 * Tüm bakım kalemlerini kontrol eder; süresi dolmuş ve daha önce
 * uyarılmamış kalemler için sesli hatırlatma yapar.
 * @returns {Promise<void>}
 */
export async function checkMaintenanceDue() {
  const [items, odometerKm] = await Promise.all([
    listMaintenanceItems(),
    getEstimatedOdometerKm(),
  ]);
  if (items.length === 0) return;

  const alertedIds = await getAlertedIds();
  const now = Date.now();
  const newlyDue = items.filter((item) => !alertedIds.has(item.id) && isDue(item, odometerKm, now));

  for (const item of newlyDue) {
    alertedIds.add(item.id);
    void speak(`${item.label} bakım zamanı geldi.`);
    logInfo('maintenance-reminder', `Bakım hatırlatması: ${item.label}`);
  }

  if (newlyDue.length > 0) {
    await saveAlertedIds(alertedIds);
  }
}

/**
 * En yakın (henüz süresi dolmamış) bakım kalemini döndürür - sesli komut
 * "bakım ne zaman" bunu kullanır.
 * @returns {Promise<{item: import('../data/maintenance-repository.js').MaintenanceItem, kmRemaining: number|null}|null>}
 */
export async function getNextUpcomingMaintenance() {
  const [items, odometerKm] = await Promise.all([listMaintenanceItems(), getEstimatedOdometerKm()]);
  if (items.length === 0) return null;

  const withRemaining = items
    .filter((item) => item.interval_km && item.last_done_km !== null && odometerKm !== null)
    .map((item) => ({
      item,
      kmRemaining: (item.last_done_km + item.interval_km) - odometerKm,
    }))
    .sort((a, b) => a.kmRemaining - b.kmRemaining);

  return withRemaining[0] ?? null;
}

/**
 * Bir kalemin süresinin dolup dolmadığını (km veya tarih bazında) belirler.
 * @param {import('../data/maintenance-repository.js').MaintenanceItem} item
 * @param {number|null} odometerKm
 * @param {number} nowUnixMs
 * @returns {boolean}
 */
function isDue(item, odometerKm, nowUnixMs) {
  const kmDue = item.interval_km && item.last_done_km !== null && odometerKm !== null
    && odometerKm >= item.last_done_km + item.interval_km;

  const monthsMs = (item.interval_months ?? 0) * 30 * 24 * 3600 * 1000;
  const dateDue = item.interval_months && item.last_done_date !== null
    && nowUnixMs >= item.last_done_date + monthsMs;

  return Boolean(kmDue || dateDue);
}

/**
 * @returns {Promise<Set<number>>}
 */
async function getAlertedIds() {
  const { value } = await Preferences.get({ key: ALERTED_KEY });
  return new Set(value ? JSON.parse(value) : []);
}

/**
 * @param {Set<number>} ids
 * @returns {Promise<void>}
 */
async function saveAlertedIds(ids) {
  await Preferences.set({ key: ALERTED_KEY, value: JSON.stringify([...ids]) });
}
