/**
 * driving-score.js
 * ---------------------------------------------------------------------------
 * Sürüş puanı hesabı (0-100), ŞEFFAF ve açıklanabilir bir formülle: 100 km
 * başına düşen sert hızlanma/fren olayı sayısına göre ceza puanı düşülür.
 *
 * DÜRÜSTLÜK NOTU: Bu bir makine öğrenmesi/"AI güven skoru" DEĞİLDİR - sabit,
 * belgelenmiş bir formüldür. Az mesafeli veya az GPS noktalı yolculuklar
 * (istatistiksel olarak anlamsız olur) puanlamaya dahil edilmez.
 * ---------------------------------------------------------------------------
 */

import { analyzeTripPoints } from './driving-analysis.js';
import { getTripDetail } from '../data/trip-repository.js';

/** @type {number} Her 100 km'deki 1 sert olay için düşülen puan. */
export const PENALTY_PER_EVENT_PER_100KM = 6;

/** @type {number} Bu km'nin altındaki yolculuklar puanlamaya dahil edilmez (istatistiksel anlamsızlık). */
export const MIN_DISTANCE_FOR_SCORING_KM = 1.5;

/** @type {number} Bu sayının altında GPS noktası olan yolculuklar puanlamaya dahil edilmez. */
export const MIN_POINTS_FOR_SCORING = 3;

/**
 * @typedef {Object} TripScore
 * @property {number} tripId
 * @property {number} score - 0-100.
 * @property {number} harshAccelCount
 * @property {number} harshBrakeCount
 * @property {number} distanceKm
 */

/**
 * Tek bir yolculuğun sürüş puanını hesaplar.
 * @param {number} tripId
 * @returns {Promise<TripScore|null>} Yolculuk çok kısaysa/az veri varsa null.
 */
export async function scoreTrip(tripId) {
  const { trip, points } = await getTripDetail(tripId);
  if (!trip || trip.distance_km < MIN_DISTANCE_FOR_SCORING_KM || points.length < MIN_POINTS_FOR_SCORING) {
    return null;
  }

  const analysis = analyzeTripPoints(points, trip.distance_km);
  const penalty = analysis.eventsPer100Km * PENALTY_PER_EVENT_PER_100KM;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    tripId,
    score,
    harshAccelCount: analysis.harshAccelCount,
    harshBrakeCount: analysis.harshBrakeCount,
    distanceKm: trip.distance_km,
  };
}

/**
 * Birden fazla yolculuğun puanlarını hesaplayıp mesafe ağırlıklı ortalamasını
 * döndürür (uzun yolculuklar ortalamaya kısa yolculuklardan daha fazla ağırlık verir).
 * @param {number[]} tripIds
 * @returns {Promise<{averageScore: number|null, scoredTrips: TripScore[]}>}
 */
export async function scoreTrips(tripIds) {
  const results = await Promise.all(tripIds.map(scoreTrip));
  const scoredTrips = results.filter((r) => r !== null);

  if (scoredTrips.length === 0) {
    return { averageScore: null, scoredTrips: [] };
  }

  const totalDistance = scoredTrips.reduce((sum, t) => sum + t.distanceKm, 0);
  const weightedSum = scoredTrips.reduce((sum, t) => sum + t.score * t.distanceKm, 0);
  const averageScore = totalDistance > 0 ? Math.round(weightedSum / totalDistance) : null;

  return { averageScore, scoredTrips };
}
