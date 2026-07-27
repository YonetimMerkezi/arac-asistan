/**
 * logger.js
 * ---------------------------------------------------------------------------
 * Merkezi günlükleme (log) ve hata yönetimi modülü.
 *
 * Amaç: "Hata yönetimi eksiksiz olacak" ilkesi gereği, projedeki her modül
 * hata ve olayları burada tanımlanan tek noktadan raporlar. Bu sayede:
 *  - Bluetooth kopmaları, OBD parse hataları gibi olaylar tutarlı formatta
 *    saklanır,
 *  - İleride (Faz 9) Firebase Crashlytics/Analytics entegrasyonu tek yerden
 *    yapılabilir,
 *  - Bellek sızıntısını önlemek için log kaydı belirli bir boyutta tutulur
 *    (halka tampon / ring buffer).
 *
 * Global değişken kullanılmaz; modül kendi kapalı (closure) durumunu tutar
 * ve dışa yalnızca fonksiyonlar sunar.
 * ---------------------------------------------------------------------------
 */

/** @type {number} Bellekte tutulacak maksimum log kaydı sayısı (sızıntı önleme). */
const MAX_LOG_ENTRIES = 500;

/**
 * @typedef {'debug'|'info'|'warn'|'error'} LogLevel
 *
 * @typedef {Object} LogEntry
 * @property {number} timestamp - Unix ms cinsinden zaman damgası.
 * @property {LogLevel} level - Log seviyesi.
 * @property {string} scope - Kaydı üreten modül adı (ör. 'bluetooth', 'obd').
 * @property {string} message - Okunabilir mesaj.
 * @property {Object|null} meta - Ek bağlam verisi (ör. hata nesnesi, PID kodu).
 */

/** @type {LogEntry[]} Halka tampon olarak davranan log dizisi. */
const buffer = [];

/** @type {Set<(entry: LogEntry) => void>} Canlı log dinleyicileri (ör. debug ekranı). */
const listeners = new Set();

/**
 * Tek bir log kaydı oluşturur, tampona ekler ve dinleyicilere bildirir.
 *
 * @param {LogLevel} level
 * @param {string} scope
 * @param {string} message
 * @param {Object|null} [meta=null]
 * @returns {LogEntry}
 */
function write(level, scope, message, meta = null) {
  /** @type {LogEntry} */
  const entry = {
    timestamp: Date.now(),
    level,
    scope,
    message,
    meta: meta ?? null,
  };

  buffer.push(entry);
  if (buffer.length > MAX_LOG_ENTRIES) {
    // Bellek sızıntısını önlemek için en eski kaydı at.
    buffer.shift();
  }

  // Geliştirme sırasında konsola da yaz.
  const consoleFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  consoleFn(`[SDA][${scope}] ${message}`, meta ?? '');

  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (listenerError) {
      // Bir dinleyicinin hatası diğerlerini veya uygulamayı etkilememeli.
      console.error('[SDA][logger] Dinleyici hata fırlattı', listenerError);
    }
  }

  return entry;
}

/**
 * Bilgi amaçlı log kaydı.
 * @param {string} scope
 * @param {string} message
 * @param {Object} [meta]
 */
export function logInfo(scope, message, meta) {
  write('info', scope, message, meta);
}

/**
 * Hata ayıklama amaçlı, yalnızca geliştirme sırasında anlamlı log kaydı.
 * @param {string} scope
 * @param {string} message
 * @param {Object} [meta]
 */
export function logDebug(scope, message, meta) {
  write('debug', scope, message, meta);
}

/**
 * Uyarı seviyesinde log kaydı (ör. yeniden bağlanma denemesi).
 * @param {string} scope
 * @param {string} message
 * @param {Object} [meta]
 */
export function logWarn(scope, message, meta) {
  write('warn', scope, message, meta);
}

/**
 * Hata seviyesinde log kaydı. `error` bir Error nesnesiyse mesaj ve stack
 * otomatik olarak meta içine eklenir.
 * @param {string} scope
 * @param {string} message
 * @param {Error|Object} [error]
 */
export function logError(scope, message, error) {
  const meta = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : (error ?? null);
  write('error', scope, message, meta);
}

/**
 * Canlı log akışına abone olur (ör. bir hata ayıklama panelinde göstermek için).
 * @param {(entry: LogEntry) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function subscribeToLogs(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Tamponun bir kopyasını döndürür (dışarıdan doğrudan mutasyon önlenir).
 * @param {LogLevel} [levelFilter]
 * @returns {LogEntry[]}
 */
export function getLogs(levelFilter) {
  const snapshot = buffer.slice();
  return levelFilter ? snapshot.filter((e) => e.level === levelFilter) : snapshot;
}

/**
 * Test/oturum sıfırlama amaçlı tampon temizleme.
 */
export function clearLogs() {
  buffer.length = 0;
}
