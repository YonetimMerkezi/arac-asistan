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

/** @type {number} Bir adımın konumuna bu mesafede (metre) yaklaşınca ERKEN (ön) uyarı seslendirilir - "200 metre sonra sola dönün" gibi. */
const EARLY_ANNOUNCE_RADIUS_METERS = 200;

/** @type {number} Bir adımın konumuna bu mesafede (metre) yaklaşınca SON (dönüş anı) talimatı seslendirilir. */
const NEAR_ANNOUNCE_RADIUS_METERS = 20;

/** @type {import('./route-service.js').RouteStep[]} */
let activeSteps = [];

/** @type {number} Sıradaki (henüz son talimatı seslendirilmemiş) adımın indeksi. */
let nextStepIndex = 0;

/** @type {boolean} Sıradaki adım için ERKEN uyarı zaten söylendi mi (aynı adım için iki kez söylenmesin). */
let earlyAnnouncedForCurrentStep = false;

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
  earlyAnnouncedForCurrentStep = false;
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
  earlyAnnouncedForCurrentStep = false;
}

/**
 * Bir talimatı "ön uyarı" biçimine çevirir - ör. "Sola dönün" -> "200 metre
 * sonra sola dönün". Yalnızca ilk harfi küçültülür (talimat cümle içine
 * gömülüyor, büyük harfle başlamamalı).
 * @param {string} instruction
 * @returns {string}
 */
function toEarlyInstruction(instruction) {
  const lowered = instruction.charAt(0).toLowerCase() + instruction.slice(1);
  return `${EARLY_ANNOUNCE_RADIUS_METERS} metre sonra ${lowered}`;
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

  if (distanceMeters <= NEAR_ANNOUNCE_RADIUS_METERS) {
    // Dönüş anı geldi - asıl talimat (kısa, doğrudan) seslendirilir.
    void speak(step.instruction);
    nextStepIndex += 1;
    earlyAnnouncedForCurrentStep = false;
    return;
  }

  if (!earlyAnnouncedForCurrentStep && distanceMeters <= EARLY_ANNOUNCE_RADIUS_METERS) {
    // Dönüşten önce bir kez ön uyarı - gerçek dönüş talimatıyla KARIŞTIRILMASIN
    // diye farklı cümle kalıbı kullanılır ("200 metre sonra ...").
    void speak(toEarlyInstruction(step.instruction));
    earlyAnnouncedForCurrentStep = true;
  }
}
