/**
 * driving-analysis.js
 * ---------------------------------------------------------------------------
 * Sürüş stili analizi — saf fonksiyonlar (DB/state bağımlılığı yok).
 *
 * DÜRÜSTLÜK NOTU: Standart OBD-II PID kümesinde ivmeölçer verisi YOKTUR.
 * Bu yüzden "sert hızlanma/fren" tespiti, trip_points tablosundaki GPS hız
 * örneklerinden (yaklaşık 4 saniyede bir, bkz. trip-recorder.js) türetilen
 * hız/zaman eğiminden (km/h/s) yapılır. Bu bir ivmeölçer değil, GPS tabanlı
 * bir YAKLAŞIKLIKTIR - UI'da böyle etiketlenmelidir, "kesin" gibi sunulmamalıdır.
 * ---------------------------------------------------------------------------
 */

/** @type {number} Bu eşiğin ÜZERİNDEKİ hızlanma (km/h/s) "sert hızlanma" sayılır. */
export const HARSH_ACCEL_THRESHOLD_KMH_PER_S = 9;

/** @type {number} Bu eşiğin ALTINDAKİ (negatif) ivme "sert fren" sayılır. */
export const HARSH_BRAKE_THRESHOLD_KMH_PER_S = -11;

/** @type {number} İki nokta arası bu saniyeden uzunsa (GPS sinyal kaybı/duraklama) örnek atlanır. */
const MAX_VALID_GAP_S = 15;

/**
 * @typedef {Object} TripPointLite
 * @property {number|null} speed_kmh
 * @property {number} recorded_at - Unix ms.
 */

/**
 * @typedef {Object} TripAnalysis
 * @property {number} harshAccelCount
 * @property {number} harshBrakeCount
 * @property {number} sampledPointCount - Analize dahil edilen (geçerli aralıklı) örnek sayısı.
 * @property {number} eventsPer100Km
 */

/**
 * Bir yolculuğun GPS noktalarından sert hızlanma/fren olaylarını sayar.
 * @param {TripPointLite[]} points - `recorded_at`'e göre ARTAN sıralı olmalı.
 * @param {number} distanceKm
 * @returns {TripAnalysis}
 */
export function analyzeTripPoints(points, distanceKm) {
  let harshAccelCount = 0;
  let harshBrakeCount = 0;
  let sampledPointCount = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.speed_kmh == null || curr.speed_kmh == null) continue;

    const dtSeconds = (curr.recorded_at - prev.recorded_at) / 1000;
    if (dtSeconds <= 0 || dtSeconds > MAX_VALID_GAP_S) continue; // kopukluk/anlamsız aralık - atla

    sampledPointCount++;
    const rateKmhPerS = (curr.speed_kmh - prev.speed_kmh) / dtSeconds;

    if (rateKmhPerS >= HARSH_ACCEL_THRESHOLD_KMH_PER_S) {
      harshAccelCount++;
    } else if (rateKmhPerS <= HARSH_BRAKE_THRESHOLD_KMH_PER_S) {
      harshBrakeCount++;
    }
  }

  const totalEvents = harshAccelCount + harshBrakeCount;
  const eventsPer100Km = distanceKm > 0 ? (totalEvents / distanceKm) * 100 : 0;

  return { harshAccelCount, harshBrakeCount, sampledPointCount, eventsPer100Km };
}
