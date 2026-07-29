/**
 * bluetooth-manager.js
 * ---------------------------------------------------------------------------
 * Bluetooth bağlantı yaşam döngüsü yönetimi.
 *
 * Sorumlulukları:
 *  - Kayıtlı OBD cihazını hatırlamak (Capacitor Preferences)
 *  - Bağlantı kurmak / kesmek
 *  - Beklenmedik kopmalarda üstel geri çekilmeli (exponential backoff)
 *    otomatik yeniden bağlanma
 *  - Bağlantı kalitesini (son veri alımına göre) raporlamak
 *  - Ham "read" event'lerini üst katmana (obd/elm327.js) iletmek
 *
 * Bu modül ELM327 komutlarını BİLMEZ - yalnızca byte taşımacılığı ve
 * bağlantı durumunu yönetir (SOLID: Single Responsibility).
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { BluetoothClassic } from './native-bridge.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

/** @type {string} Kayıtlı cihaz adresini saklamak için kullanılan anahtar. */
const SAVED_DEVICE_KEY = 'sda_paired_obd_device';

/** @type {number} Yeniden bağlanma denemeleri arası başlangıç gecikmesi (ms). */
const RECONNECT_BASE_DELAY_MS = 2000;

/** @type {number} Üstel geri çekilmenin tavan değeri (ms). */
const RECONNECT_MAX_DELAY_MS = 30000;

/** @type {number} Bu süreden (ms) uzun süre veri gelmezse bağlantı "zayıf" sayılır. */
const WEAK_SIGNAL_THRESHOLD_MS = 4000;

/** @typedef {'disconnected'|'connecting'|'connected'|'reconnecting'} ConnectionStatus */
/** @typedef {'none'|'weak'|'good'} ConnectionQuality */

/**
 * @typedef {Object} BluetoothState
 * @property {ConnectionStatus} status
 * @property {string|null} deviceAddress
 * @property {string|null} deviceName
 * @property {ConnectionQuality} quality
 */

/** @type {BluetoothState} */
let state = { status: 'disconnected', deviceAddress: null, deviceName: null, quality: 'none' };

/** @type {Set<(state: BluetoothState) => void>} */
const stateListeners = new Set();

/** @type {Set<(chunk: string) => void>} */
const dataListeners = new Set();

/** @type {number} Art arda başarısız otomatik yeniden bağlanma denemesi sayacı. */
let reconnectAttempt = 0;

/** @type {ReturnType<typeof setTimeout>|null} */
let reconnectTimer = null;

/** @type {number} Son başarılı veri alımının zaman damgası. */
let lastDataAt = 0;

/** @type {ReturnType<typeof setInterval>|null} */
let qualityInterval = null;

/** @type {{remove: () => void}|null} */
let connectionListenerHandle = null;

/** @type {{remove: () => void}|null} */
let readListenerHandle = null;

/**
 * Modülü başlatır: native event dinleyicilerini bağlar ve kalite
 * izleme döngüsünü başlatır. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function initBluetoothManager() {
  connectionListenerHandle = await BluetoothClassic.addListener(
    'connectionChange',
    handleConnectionChange,
  );
  readListenerHandle = await BluetoothClassic.addListener('read', handleRead);

  qualityInterval = setInterval(updateQuality, 1000);

  logInfo('bluetooth-manager', 'Bluetooth yöneticisi başlatıldı');
}

/**
 * Kaynakları serbest bırakır (ör. uygulama kapanırken). Bellek sızıntısını
 * önlemek için tüm interval/listener referansları temizlenir.
 */
export function disposeBluetoothManager() {
  if (qualityInterval) clearInterval(qualityInterval);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  connectionListenerHandle?.remove();
  readListenerHandle?.remove();
  qualityInterval = null;
  reconnectTimer = null;
}

/**
 * Eşleştirilmiş cihazları listeler (kullanıcının ayarlar ekranında
 * OBD adaptörünü seçebilmesi için).
 * @returns {Promise<import('./native-bridge.js').PairedDevice[]>}
 */
export async function listPairedDevices() {
  try {
    const { devices } = await BluetoothClassic.listPairedDevices();
    return devices;
  } catch (error) {
    logError('bluetooth-manager', 'Eşleştirilmiş cihazlar okunamadı', error);
    return [];
  }
}

/** @type {RegExp} Yaygın ELM327/OBD2 adaptör isim kalıpları (vaka duyarsız) - Ayarlar ekranındaki
 * TÜM eşleştirilmiş cihazları (kulaklık, hoparlör vb.) listelemek yerine yalnızca gerçek OBD
 * adaptörünü otomatik bulup önermek/bağlamak için kullanılır (bkz. findElmDevice/scanAndConnectElm). */
const ELM_NAME_PATTERN = /obd|elm327|elm|v-?link|viecar|vgate|icar|konnwei|obdlink|obdii|obd2/i;

/**
 * Eşleştirilmiş cihazlar arasından ELM327/OBD2 adaptörüne benzeyen ilk cihazı bulur.
 * @param {import('./native-bridge.js').PairedDevice[]} devices
 * @returns {import('./native-bridge.js').PairedDevice|null}
 */
export function findElmDevice(devices) {
  return devices.find((d) => d.name && ELM_NAME_PATTERN.test(d.name)) ?? null;
}

/**
 * Car Scanner benzeri "tek dokunuşla bağlan" akışı: kullanıcıya HİÇBİR eşleştirilmiş
 * cihaz listesi göstermeden, eşleştirilmiş cihazlar arasında ELM327/OBD2 adaptörünü
 * kendisi bulup doğrudan bağlanır. Kullanıcının Bluetooth eşleştirme listesindeki
 * alakasız cihazlarla (kulaklık vb.) uğraşmasını tamamen ortadan kaldırır.
 *
 * NOT: Android'de eşleştirme (pairing) işleminin kendisi hâlâ sistem Bluetooth
 * ayarlarından yapılmalıdır - bu fonksiyon yalnızca ZATEN eşleştirilmiş cihazlar
 * arasından ELM adaptörünü seçip bağlanmayı otomatikleştirir (Capacitor'ın Bluetooth
 * Classic API'si eşleştirilmemiş cihazları taramaya izin vermez).
 * @returns {Promise<{ok: true, device: import('./native-bridge.js').PairedDevice} | {ok: false, reason: 'not_found'|'connect_failed'}>}
 */
export async function scanAndConnectElm() {
  const devices = await listPairedDevices();
  const match = findElmDevice(devices);

  if (!match) {
    logWarn('bluetooth-manager', 'Eşleştirilmiş cihazlar arasında ELM327/OBD2 adaptörü bulunamadı');
    return { ok: false, reason: 'not_found' };
  }

  const connected = await connectToDevice(match.address, match.name);
  return connected ? { ok: true, device: match } : { ok: false, reason: 'connect_failed' };
}

/**
 * Bir cihaza bağlanır ve gelecekteki otomatik bağlanma için kaydeder.
 * @param {string} address
 * @param {string} [name]
 * @returns {Promise<boolean>} Bağlantı başarılı oldu mu.
 */
export async function connectToDevice(address, name) {
  setState({ status: 'connecting', deviceAddress: address, deviceName: name ?? state.deviceName });

  try {
    await BluetoothClassic.connect({ address });
    await Preferences.set({ key: SAVED_DEVICE_KEY, value: JSON.stringify({ address, name }) });
    reconnectAttempt = 0;
    lastDataAt = Date.now();
    setState({ status: 'connected', deviceAddress: address, deviceName: name ?? state.deviceName, quality: 'good' });
    logInfo('bluetooth-manager', `Bağlandı: ${address}`);
    return true;
  } catch (error) {
    logError('bluetooth-manager', `Bağlantı başarısız: ${address}`, error);
    setState({ status: 'disconnected', quality: 'none' });
    return false;
  }
}

/**
 * Kayıtlı cihaza (varsa) otomatik bağlanmayı dener. Uygulama açılışında
 * veya araç çalıştırıldığında çağrılır.
 * @returns {Promise<boolean>}
 */
export async function tryAutoConnect() {
  try {
    const { value } = await Preferences.get({ key: SAVED_DEVICE_KEY });
    if (!value) {
      logInfo('bluetooth-manager', 'Kayıtlı OBD cihazı yok, otomatik bağlanma atlandı');
      return false;
    }
    const saved = JSON.parse(value);
    return await connectToDevice(saved.address, saved.name);
  } catch (error) {
    logError('bluetooth-manager', 'Otomatik bağlanma sırasında hata', error);
    return false;
  }
}

/**
 * Bağlantıyı kullanıcı isteğiyle keser; bu durumda otomatik yeniden
 * bağlanma TETİKLENMEZ (kullanıcı bilinçli olarak kesti).
 * @returns {Promise<void>}
 */
export async function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    await BluetoothClassic.disconnect();
  } catch (error) {
    logWarn('bluetooth-manager', 'Bağlantı kesilirken hata (yok sayılabilir)', error);
  }
  setState({ status: 'disconnected', quality: 'none' });
}

/**
 * ELM327'ye ham bir komut dizesi gönderir.
 * @param {string} command - Sonundaki "\r" dahil edilmelidir (bkz. obd/elm327.js).
 * @returns {Promise<void>}
 */
export async function sendRaw(command) {
  if (state.status !== 'connected') {
    throw new Error('Bluetooth bağlı değilken veri gönderilemez');
  }
  await BluetoothClassic.write({ data: command });
}

/**
 * Gelen ham veri parçalarına abone olur (obd/elm327.js bu API'yi kullanır).
 * @param {(chunk: string) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function onData(callback) {
  dataListeners.add(callback);
  return () => dataListeners.delete(callback);
}

/**
 * Bağlantı durumu değişikliklerine abone olur (UI için).
 * @param {(state: BluetoothState) => void} callback
 * @returns {() => void}
 */
export function onStateChange(callback) {
  stateListeners.add(callback);
  return () => stateListeners.delete(callback);
}

/**
 * Güncel bağlantı durumunun salt-okunur kopyasını döndürür.
 * @returns {BluetoothState}
 */
export function getState() {
  return { ...state };
}

/**
 * Native taraftan gelen bağlantı durumu değişikliğini işler. Beklenmedik
 * bir kopma (kullanıcı kesmediği halde connected:false) tespit edilirse
 * otomatik yeniden bağlanma dizisini başlatır.
 * @param {import('./native-bridge.js').ConnectionChangeEvent} event
 */
function handleConnectionChange(event) {
  if (event.connected) {
    reconnectAttempt = 0;
    lastDataAt = Date.now();
    setState({ status: 'connected', quality: 'good' });
    return;
  }

  const wasConnected = state.status === 'connected' || state.status === 'reconnecting';
  setState({ status: 'disconnected', quality: 'none' });

  if (wasConnected && state.deviceAddress) {
    scheduleReconnect();
  }
}

/**
 * Native taraftan gelen ham veri parçasını işler: son alım zamanını
 * günceller ve tüm abonelere iletir.
 * @param {import('./native-bridge.js').ReadEvent} event
 */
function handleRead(event) {
  lastDataAt = Date.now();
  for (const listener of dataListeners) {
    try {
      listener(event.data);
    } catch (error) {
      logError('bluetooth-manager', 'Veri dinleyicisi hata fırlattı', error);
    }
  }
}

/**
 * Üstel geri çekilmeli otomatik yeniden bağlanma zincirini planlar.
 *
 * DÜZELTME (kritik hata): Önceki sürümde MAX_RECONNECT_ATTEMPTS (8) denemeden
 * sonra yeniden bağlanma TAMAMEN durduruluyordu. Araç sürülürken (motor RF
 * gürültüsü, titreşimle OBD portundaki gevşeklik) kopma/yeniden bağlanma
 * birkaç dakika içinde bu sınırı rahatlıkla aşabiliyordu - kullanıcı yolun
 * ortasında telefona bakmadığı için "8 deneme tükendi, artık denemiyorum"
 * durumunu fark edemiyor, sürüşün geri kalanında sessizce bağlantısız
 * kalıyordu (sesli asistanın "bağlandı" demesi de bu yüzden yalnızca İLK
 * birkaç yeniden bağlanmada duyuluyordu). Artık üst sınır YOK - gecikme
 * 30 saniyede sabitlenip uygulama açık olduğu sürece SONSUZA KADAR denenir;
 * bu, araç içi kullanım için doğru davranıştır (pes etmek, tekrar denemekten
 * her zaman daha kötüdür).
 */
function scheduleReconnect() {
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
    RECONNECT_MAX_DELAY_MS,
  );
  reconnectAttempt += 1;
  setState({ status: 'reconnecting' });
  logWarn('bluetooth-manager', `Yeniden bağlanma denenecek (#${reconnectAttempt}), ${delay}ms sonra`);

  reconnectTimer = setTimeout(async () => {
    if (!state.deviceAddress) return;
    const ok = await connectToDevice(state.deviceAddress, state.deviceName ?? undefined);
    if (!ok) {
      scheduleReconnect();
    }
  }, delay);
}

/**
 * Son veri alımına göre bağlantı kalitesini günceller. connected
 * durumundayken uzun süre veri gelmemesi "zayıf sinyal" olarak raporlanır
 * (ör. adaptör araç kontağı kapanınca uykuya geçtiğinde).
 */
function updateQuality() {
  if (state.status !== 'connected') return;

  const elapsed = Date.now() - lastDataAt;
  const nextQuality = elapsed > WEAK_SIGNAL_THRESHOLD_MS ? 'weak' : 'good';

  if (nextQuality !== state.quality) {
    setState({ quality: nextQuality });
  }
}

/**
 * Durumu kısmi olarak günceller ve dinleyicilere bildirir.
 * @param {Partial<BluetoothState>} partial
 */
function setState(partial) {
  state = { ...state, ...partial };
  for (const listener of stateListeners) {
    try {
      listener(getState());
    } catch (error) {
      logError('bluetooth-manager', 'Durum dinleyicisi hata fırlattı', error);
    }
  }
}
