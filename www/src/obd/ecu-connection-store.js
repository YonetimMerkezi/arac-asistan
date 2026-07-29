/**
 * ecu-connection-store.js
 * ---------------------------------------------------------------------------
 * ECU (araç) bağlantı durumunu, Bluetooth/ELM327 TAŞIMA katmanından AYRI
 * olarak izler - tıpkı Car Scanner Pro'nun "ELM Bağlantısı" / "ECU Bağlantısı"
 * ayrımı gibi.
 *
 * NEDEN AYRI: Bluetooth soketi açık ("ELM Bağlantısı: Bağlandı") olması,
 * ARACIN GERÇEKTEN yanıt verdiği anlamına gelmez - ELM327 çipine ulaşmak
 * (transport) ile ECU'nun PID sorularına yanıt vermesi (handshake) iki
 * ayrı aşamadır. Önceki tasarımda bu tek bir "Bağlandı" göstergesi
 * ARKASINDA saklıydı - kullanıcı ne olduğunu ayırt edemiyordu.
 * ---------------------------------------------------------------------------
 */

import { logInfo } from '../core/logger.js';

/** @typedef {'idle'|'handshaking'|'connected'|'failed'} EcuStatus */

/**
 * @typedef {Object} EcuConnectionState
 * @property {EcuStatus} status
 * @property {string|null} hint - Kullanıcıya gösterilecek kısa ipucu (ör. "Kontak açık mı?").
 */

/** @type {EcuConnectionState} */
let state = { status: 'idle', hint: null };

/** @type {Set<(state: EcuConnectionState) => void>} */
const listeners = new Set();

/**
 * @returns {EcuConnectionState}
 */
export function getEcuStatus() {
  return { ...state };
}

/**
 * @param {(state: EcuConnectionState) => void} callback
 * @returns {() => void}
 */
export function onEcuStatusChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * @param {EcuStatus} status
 * @param {string|null} [hint]
 */
export function setEcuStatus(status, hint = null) {
  state = { status, hint };
  logInfo('ecu-connection-store', `ECU durumu: ${status}${hint ? ` (${hint})` : ''}`);
  for (const listener of listeners) listener(state);
}
