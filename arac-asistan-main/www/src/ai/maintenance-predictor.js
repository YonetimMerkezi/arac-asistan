/**
 * maintenance-predictor.js
 * ---------------------------------------------------------------------------
 * Bakım kalemleri için "ne zaman gelir" TAHMİNİ - kullanıcının son 30
 * gündeki GERÇEK ortalama günlük kilometresine dayanır.
 *
 * DÜRÜSTLÜK NOTU: Uydurma bir olasılık yüzdesi ("%87 ihtimalle...") YOK.
 * Yeterli sürüş verisi yoksa `estimatedDaysRemaining` alanı `null` döner ve
 * UI bunu "tahmin için yetersiz veri" olarak göstermelidir - sahte bir sayı
 * uydurmak yerine.
 * ---------------------------------------------------------------------------
 */

import { listMaintenanceItems } from '../data/maintenance-repository.js';
import { getEstimatedOdometerKm } from '../fuel/odometer-estimator.js';
import { listTripsSince } from '../data/trip-repository.js';

/** @type {number} Günlük ortalama km hesaplanırken bakılan geçmiş pencere. */
const LOOKBACK_MS = 30 * 24 * 3600 * 1000;
const LOOKBACK_DAYS = 30;

/** @type {number} Bu sayının altında tamamlanmış yolculuk varsa günlük ortalama güvenilir sayılmaz. */
const MIN_TRIPS_FOR_PREDICTION = 3;

/**
 * @typedef {Object} MaintenancePrediction
 * @property {import('../data/maintenance-repository.js').MaintenanceItem} item
 * @property {number|null} kmRemaining - Taban km yoksa null.
 * @property {number|null} estimatedDaysRemaining - Yetersiz veri varsa null.
 */

/**
 * Tüm bakım kalemleri için kalan km + (yeterli veri varsa) tahmini gün sayısını,
 * en yakın (en az kalan) sıralı olarak döndürür.
 * @returns {Promise<MaintenancePrediction[]>}
 */
export async function predictMaintenance() {
  const [items, odometerKm, recentTrips] = await Promise.all([
    listMaintenanceItems(),
    getEstimatedOdometerKm(),
    listTripsSince(Date.now() - LOOKBACK_MS),
  ]);

  const completedRecent = recentTrips.filter((t) => t.end_time !== null);
  const dailyAvgKm = completedRecent.length >= MIN_TRIPS_FOR_PREDICTION
    ? completedRecent.reduce((sum, t) => sum + t.distance_km, 0) / LOOKBACK_DAYS
    : null;

  return items
    .filter((item) => item.interval_km && item.last_done_km !== null)
    .map((item) => {
      const kmRemaining = odometerKm !== null
        ? (item.last_done_km + item.interval_km) - odometerKm
        : null;

      const estimatedDaysRemaining = kmRemaining !== null && dailyAvgKm && dailyAvgKm > 0
        ? Math.round(kmRemaining / dailyAvgKm)
        : null;

      return { item, kmRemaining, estimatedDaysRemaining };
    })
    .sort((a, b) => (a.kmRemaining ?? Infinity) - (b.kmRemaining ?? Infinity));
}
