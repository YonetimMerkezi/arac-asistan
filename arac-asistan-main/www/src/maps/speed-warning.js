/**
 * speed-warning.js
 * ---------------------------------------------------------------------------
 * Hız sınırı karşılaştırması ve sesli uyarı.
 *
 * gps-tracker.js'ten gelen anlık hızı speed-limit-service.js'ten okunan
 * yol hız limitiyle karşılaştırır. İki farklı uyarı türü vardır:
 *  - Limit DEĞİŞTİĞİNDE bilgilendirme ("Hız sınırı 70 kilometre.")
 *  - Limit AŞILDIĞINDA uyarı ("Hız sınırını aştınız."), histerezisli
 *    (limitin biraz altına dönmeden tekrar seslendirilmez)
 * ---------------------------------------------------------------------------
 */

import { onPosition } from '../core/gps-tracker.js';
import { getSpeedLimitNear } from './speed-limit-service.js';
import { speak } from '../voice/tts.js';
import { logInfo } from '../core/logger.js';

/** @type {number} Aşım uyarısından sonra, limitin bu kadar (km/h) altına dönülünce alarmın sıfırlanması. */
const VIOLATION_RESET_MARGIN_KMH = 5;

/** @type {number|null} */
let lastAnnouncedLimit = null;

/** @type {boolean} Şu an "hız aşıldı" alarmında mıyız (tekrar tekrar seslendirmemek için). */
let violationActive = false;

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * Hız uyarı izleyicisini başlatır.
 */
export function initSpeedWarning() {
  if (unsubscribe) return;
  unsubscribe = onPosition(handlePosition);
  logInfo('speed-warning', 'Hız sınırı uyarı izleyicisi başlatıldı');
}

/**
 * İzleyiciyi durdurur (bellek sızıntısı önleme).
 */
export function disposeSpeedWarning() {
  unsubscribe?.();
  unsubscribe = null;
  lastAnnouncedLimit = null;
  violationActive = false;
}

/**
 * @param {import('../core/gps-tracker.js').LivePosition} position
 */
async function handlePosition(position) {
  const limit = await getSpeedLimitNear(position.latitude, position.longitude);
  if (limit === null) return;

  if (limit !== lastAnnouncedLimit) {
    lastAnnouncedLimit = limit;
    violationActive = false; // yeni yol kesimi, aşım durumu sıfırlanır
    void speak(`Hız sınırı ${limit} kilometre.`);
  }

  const isViolating = position.speedKmh > limit;

  if (isViolating && !violationActive) {
    violationActive = true;
    void speak('Hız sınırını aştınız.');
  } else if (!isViolating && violationActive && position.speedKmh <= limit - VIOLATION_RESET_MARGIN_KMH) {
    violationActive = false;
  }
}
