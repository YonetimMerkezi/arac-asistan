/**
 * weekly-report.js
 * ---------------------------------------------------------------------------
 * Son 7 günün özet raporu: yolculuk sayısı, mesafe, yakıt, ortalama tüketim,
 * sürüş puanı, arıza kodu okuma sayısı. Tamamı mevcut, gerçek verilerden
 * hesaplanır - uydurma/tahmini bir alan YOK.
 * ---------------------------------------------------------------------------
 */

import { listTripsSince } from '../data/trip-repository.js';
import { listDtcHistory } from '../data/dtc-repository.js';
import { scoreTrips } from './driving-score.js';

/** @type {number} */
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * @typedef {Object} WeeklyReport
 * @property {number} tripCount - Tamamlanmış yolculuk sayısı.
 * @property {number} totalDistanceKm
 * @property {number} totalFuelL
 * @property {number|null} litersPer100Km - Mesafe 0 ise null.
 * @property {number|null} averageScore - Puanlanabilir yolculuk yoksa null.
 * @property {number} dtcReadingsCount
 * @property {number} sinceUnixMs
 */

/**
 * Son 7 günün raporunu üretir.
 * @returns {Promise<WeeklyReport>}
 */
export async function buildWeeklyReport() {
  const sinceUnixMs = Date.now() - WEEK_MS;

  const trips = await listTripsSince(sinceUnixMs);
  const completedTrips = trips.filter((t) => t.end_time !== null);

  const totalDistanceKm = round2(completedTrips.reduce((sum, t) => sum + t.distance_km, 0));
  const totalFuelL = round2(completedTrips.reduce((sum, t) => sum + t.fuel_used_l, 0));
  const litersPer100Km = totalDistanceKm > 0 ? round2((totalFuelL / totalDistanceKm) * 100) : null;

  const { averageScore } = await scoreTrips(completedTrips.map((t) => t.id));

  const dtcHistory = await listDtcHistory(200);
  const dtcReadingsCount = dtcHistory.filter((entry) => entry.read_at >= sinceUnixMs).length;

  return {
    tripCount: completedTrips.length,
    totalDistanceKm,
    totalFuelL,
    litersPer100Km,
    averageScore,
    dtcReadingsCount,
    sinceUnixMs,
  };
}

/**
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
