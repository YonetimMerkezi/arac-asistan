/**
 * turn-by-turn.js
 * ---------------------------------------------------------------------------
 * Aktif rota için basit sesli dönüş rehberliği.
 *
 * route-service.js'in döndürdüğü `steps` dizisini (OSRM manevralarından
 * Türkçeye çevrilmiş talimatlar) GPS akışıyla karşılaştırır: araç bir
 * sonraki adımın konumuna yeterince yaklaşınca o talimat seslendirilir ve
 * bir sonraki adıma geçilir.
 *
 * DÜRÜSTLÜK NOTU: Bu YENİDEN YÖNLENDİRME (rota dışına çıkınca otomatik
 * yeni rota hesaplama) YAPMAZ - yalnızca mevcut rotanın adımlarını sırayla
 * seslendirir. Kullanıcı rotadan büyük ölçüde saparsa rehberlik "senkron
 * dışı" kalabilir; bu bilinen bir sınırlamadır, sessizce farklı davranmaz.
 * ---------------------------------------------------------------------------
 */

import { onPosition } from '../core/gps-tracker.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { speak } from '../voice/tts.js';
import { logInfo } from '../core/logger.js';

/** @type {number} Bir adımın konumuna bu mesafede (metre) yaklaşınca talimat seslendirilir. */
const ANNOUNCE_RADIUS_METERS = 80;

/** @type {import('./route-service.js').RouteStep[]} */
let activeSteps = [];

/** @type {number} Sıradaki (henüz seslendirilmemiş) adımın indeksi. */
let nextStepIndex = 0;

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * Verilen rota için sesli rehberliği başlatır. Zaten aktif bir rehberlik
 * varsa (ör. kullanıcı yeni bir rota seçti) önce onu durdurur.
 * @param {import('./route-service.js').RouteResult} route
 */
export function startGuidance(route) {
  stopGuidance();

  activeSteps = route.steps ?? [];
  nextStepIndex = 0;
  if (activeSteps.length === 0) return;

  unsubscribe = onPosition(handlePosition);
  logInfo('turn-by-turn', `Sesli rehberlik başladı (${activeSteps.length} adım)`);

  // İlk adım genelde "Yola çıkın" - hemen seslendirilir, GPS'in ilk adıma
  // "yaklaşmasını" beklemeye gerek yok (zaten başlangıç noktasındayız).
  if (activeSteps[0]) {
    void speak(activeSteps[0].instruction);
    nextStepIndex = 1;
  }
}

/**
 * Aktif rehberliği durdurur (yeni rota seçildiğinde, Harita ekranından
 * çıkıldığında veya hedefe ulaşılınca çağrılır).
 */
export function stopGuidance() {
  unsubscribe?.();
  unsubscribe = null;
  activeSteps = [];
  nextStepIndex = 0;
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
function handlePosition(position) {
  if (nextStepIndex >= activeSteps.length) {
    stopGuidance(); // Son adım da seslendirildi - rehberlik bitti.
    return;
  }

  const step = activeSteps[nextStepIndex];
  const distanceMeters = haversineDistanceKm(
    position.latitude, position.longitude, step.location[0], step.location[1],
  ) * 1000;

  if (distanceMeters <= ANNOUNCE_RADIUS_METERS) {
    void speak(step.instruction);
    nextStepIndex += 1;
  }
}
