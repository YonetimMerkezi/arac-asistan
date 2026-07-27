/**
 * voice-alerts.js
 * ---------------------------------------------------------------------------
 * Eşik tabanlı sesli uyarılar (motor hararet yaptı, akü şarjı düşük,
 * yakıt azaldı vb.).
 *
 * vehicle-live-data-store.js'teki canlı PID akışını dinler. Her eşik için
 * "alarmda mı değil mi" durumu ayrıca tutulur (histerezis) - böylece değer
 * eşiğin hemen üstünde/altında salınırken aynı uyarı saniyede defalarca
 * tekrar etmez; yalnızca güvenli aralığa dönüp tekrar eşiği geçince yeniden
 * seslendirilir.
 * ---------------------------------------------------------------------------
 */

import { onLiveDataChange } from '../core/vehicle-live-data-store.js';
import { speak } from './tts.js';
import { logInfo } from '../core/logger.js';

/**
 * @typedef {Object} ThresholdAlert
 * @property {string} pid
 * @property {(value: number) => boolean} isCritical
 * @property {(value: number) => boolean} isRecovered - Alarmı sıfırlayan histerezis koşulu.
 * @property {string} message
 */

/** @type {ThresholdAlert[]} */
const ALERTS = [
  {
    pid: '05',
    isCritical: (v) => v >= 108,
    isRecovered: (v) => v < 102, // 6 derece histerezis
    message: 'Dikkat, motor hararet yaptı.',
  },
  {
    pid: '42',
    isCritical: (v) => v < 11.8,
    isRecovered: (v) => v >= 12.2,
    message: 'Akü şarjı düşük.',
  },
  {
    pid: '2F',
    isCritical: (v) => v <= 12,
    isRecovered: (v) => v > 18,
    message: 'Yakıt seviyeniz azaldı.',
  },
];

/** @type {Map<string, boolean>} PID -> şu an alarmda mı (tekrar seslendirmeyi önlemek için). */
const alarmState = new Map();

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * Eşik izleyicisini başlatır.
 */
export function initVoiceAlerts() {
  if (unsubscribe) return;
  unsubscribe = onLiveDataChange(handleLiveData);
  logInfo('voice-alerts', 'Eşik tabanlı sesli uyarı izleyicisi başlatıldı');
}

/**
 * İzleyiciyi durdurur (bellek sızıntısı önleme).
 */
export function disposeVoiceAlerts() {
  unsubscribe?.();
  unsubscribe = null;
  alarmState.clear();
}

/**
 * Her canlı veri güncellemesinde ilgili eşikleri kontrol eder.
 * @param {string} pid
 * @param {{value: number}} entry
 */
function handleLiveData(pid, entry) {
  const alert = ALERTS.find((a) => a.pid === pid);
  if (!alert) return;

  const currentlyAlarmed = alarmState.get(pid) ?? false;

  if (!currentlyAlarmed && alert.isCritical(entry.value)) {
    alarmState.set(pid, true);
    void speak(alert.message);
  } else if (currentlyAlarmed && alert.isRecovered(entry.value)) {
    alarmState.set(pid, false);
  }
}
