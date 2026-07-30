/**
 * route-cost-estimator.js
 * ---------------------------------------------------------------------------
 * Bir rotanın (mesafe) yaklaşık yakıt maliyetini hesaplar.
 *
 * Tüketim varsayımı KEYFİ bir sabit DEĞİLDİR - kullanıcının kendi geçmiş
 * yolculuklarından (data/trip-repository.js zaten mesafe+yakıt topluyor)
 * hesaplanan GERÇEK ortalama L/100km kullanılır. Henüz yeterli geçmiş yoksa
 * (ör. uygulama yeni kurulmuşsa) makul bir genel varsayıma (7.5 L/100km,
 * orta sınıf benzinli bir binek araç için tipik şehir dışı ortalaması)
 * düşülür - bu açıkça DEFAULT_CONSUMPTION_L_PER_100KM olarak işaretli.
 * ---------------------------------------------------------------------------
 */

import { getAggregateTripStats } from '../data/trip-repository.js';

/** @type {number} Yeterli geçmiş yolculuk verisi yoksa kullanılan genel varsayım (L/100km). */
const DEFAULT_CONSUMPTION_L_PER_100KM = 7.5;

/** @type {number} Bu km'nin altındaki toplam geçmiş mesafe "yeterli veri" sayılmaz. */
const MIN_HISTORY_KM_FOR_ESTIMATE = 20;

/**
 * Kullanıcının geçmiş yolculuklarından ortalama tüketimi (L/100km) hesaplar.
 * Yeterli geçmiş yoksa genel varsayıma düşer.
 * @returns {Promise<number>}
 */
export async function estimateAverageConsumption() {
  try {
    const stats = await getAggregateTripStats();
    if (stats.totalDistanceKm >= MIN_HISTORY_KM_FOR_ESTIMATE && stats.totalFuelL > 0) {
      return (stats.totalFuelL / stats.totalDistanceKm) * 100;
    }
  } catch {
    // Geçmiş okunamazsa (ör. henüz hiç yolculuk yoksa) sessizce varsayıma düş.
  }
  return DEFAULT_CONSUMPTION_L_PER_100KM;
}

/**
 * Verilen mesafe, tüketim ve birim fiyata göre yakıt maliyetini hesaplar.
 * @param {number} distanceKm
 * @param {number} litersPer100Km
 * @param {number} pricePerLiter
 * @returns {{liters: number, cost: number}}
 */
export function estimateFuelCost(distanceKm, litersPer100Km, pricePerLiter) {
  const liters = (distanceKm * litersPer100Km) / 100;
  return { liters, cost: liters * pricePerLiter };
}
