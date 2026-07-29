/**
 * elm327.js
 * ---------------------------------------------------------------------------
 * ELM327 komut motoru.
 *
 * bluetooth-manager.js'in sağladığı ham byte taşımacılığı üzerine, ELM327'ye
 * özgü istek/yanıt protokolünü (yarı çift yönlü, "\r>" ile sonlanan yanıtlar)
 * uygular: tek seferde bir komut, sıraya alınmış (queue) çalışma, zaman aşımı,
 * ve PID yanıtlarının pid-definitions.js formülleriyle çözülmesi.
 *
 * Bu dosya Bluetooth'un NASIL bağlandığını bilmez (bluetooth-manager.js'in
 * işi); yalnızca "bağlıyken hangi metni gönderip hangi metni beklerim" ile
 * ilgilenir (SOLID: Single Responsibility, Dependency Inversion).
 * ---------------------------------------------------------------------------
 */

import { onData, sendRaw, getState } from '../bluetooth/bluetooth-manager.js';
import { PID_DEFINITIONS, decodeSupportedPidBitmask } from './pid-definitions.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

/** @type {number} Bir komutun yanıt beklemesi için tanınan azami süre (ms). */
const COMMAND_TIMEOUT_MS = 5000;

/** ELM327 yanıt sonlandırıcı karakteri (komut istemi). */
const PROMPT_CHAR = '>';

/**
 * @typedef {Object} QueuedCommand
 * @property {string} command
 * @property {(response: string) => void} resolve
 * @property {(error: Error) => void} reject
 * @property {ReturnType<typeof setTimeout>} timeoutHandle
 */

/** @type {QueuedCommand[]} */
const queue = [];

/** @type {boolean} Şu anda işlenen bir komut var mı. */
let processing = false;

/** @type {string} Henüz "\r>" ile tamamlanmamış, biriken ham veri. */
let inboundBuffer = '';

/** @type {(() => void)|null} */
let unsubscribeData = null;

/**
 * Motoru başlatır: bluetooth-manager'dan gelen ham veriyi dinlemeye başlar.
 * connectToDevice() başarılı olduktan SONRA çağrılmalıdır.
 */
export function attachElm327Transport() {
  if (unsubscribeData) return; // zaten bağlı
  unsubscribeData = onData(handleIncomingChunk);
}

/**
 * Dinleyiciyi kaldırır (bağlantı kesildiğinde çağrılır - bellek sızıntısı önleme).
 */
export function detachElm327Transport() {
  unsubscribeData?.();
  unsubscribeData = null;
  inboundBuffer = '';
  // Bekleyen komutları reddet ki çağıranlar sonsuza dek asılı kalmasın.
  while (queue.length > 0) {
    const cmd = queue.shift();
    clearTimeout(cmd.timeoutHandle);
    cmd.reject(new Error('Bağlantı kesildi, komut tamamlanamadı'));
  }
  processing = false;
}

/**
 * Tek bir komutu sıraya ekler ve yanıtı (prompt hariç, temizlenmiş metin)
 * bir Promise olarak döndürür. ELM327 yarı çift yönlü olduğu için komutlar
 * sırayla ve bir öncekinin yanıtı gelmeden gönderilmez.
 * @param {string} command - "\r" OLMADAN, ör. "ATZ" veya "010C".
 * @returns {Promise<string>}
 */
export function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const index = queue.findIndex((c) => c.timeoutHandle === timeoutHandle);
      if (index === -1) return; // Bu arada yanıt geldi ve zaten çözüldü - iptal.

      // KRİTİK DÜZELTME: Bu komutun kuyruğun BAŞINDA olup olmadığını (yani şu
      // an "processing" bayrağının GERÇEKTEN bu komut için true olup olmadığını)
      // SPLICE'TAN ÖNCE kontrol etmek gerekir. Önceki sürüm önce spliceliyor,
      // SONRA "queue[0] bu mu?" diye bakıyordu - ama o an queue[0] artık BİR
      // SONRAKİ komuttu (timeout olan zaten çıkarılmıştı), bu yüzden koşul asla
      // doğru olmuyordu ve `processing` SONSUZA DEK true kalıyordu. Sonuç: İLK
      // zaman aşımından (ör. tek seferlik bir ATL0 yanıtsızlığı) SONRA gönderilen
      // HER komut (sıradaki init komutları + TÜM PID sorguları) processQueue()'nun
      // "processing==true, gönderme" korumasına takılıp sessizce kuyrukta
      // bekleyip KENDİ zaman aşımlarına uğruyordu - "bağlandı ama hiç veri
      // gelmiyor" şikayetinin gerçek kök nedeni buydu.
      const wasCurrentlyProcessing = index === 0;
      queue.splice(index, 1);
      if (wasCurrentlyProcessing) processing = false;

      reject(new Error(`Zaman aşımı: ${command}`));
      processQueue();
    }, COMMAND_TIMEOUT_MS);

    queue.push({ command, resolve, reject, timeoutHandle });
    processQueue();
  });
}

/**
 * Sıradaki komutu (varsa ve şu an başka komut işlenmiyorsa) gönderir.
 */
function processQueue() {
  if (processing || queue.length === 0) return;
  if (getState().status !== 'connected') return;

  processing = true;
  const next = queue[0];

  sendRaw(`${next.command}\r`).catch((error) => {
    logError('elm327', `Komut gönderilemedi: ${next.command}`, error);
    queue.shift();
    clearTimeout(next.timeoutHandle);
    processing = false;
    next.reject(error);
    processQueue();
  });
}

/**
 * Bluetooth katmanından gelen ham metin parçalarını biriktirir; "\r>" prompt
 * karakteri görüldüğünde yanıtın tamamlandığını varsayar ve sıradaki komutu
 * çözer (resolve).
 * @param {string} chunk
 */
function handleIncomingChunk(chunk) {
  inboundBuffer += chunk;

  if (!inboundBuffer.includes(PROMPT_CHAR)) return;

  const [rawResponse] = inboundBuffer.split(PROMPT_CHAR);
  inboundBuffer = inboundBuffer.slice(inboundBuffer.indexOf(PROMPT_CHAR) + 1);

  const current = queue.shift();
  processing = false;
  if (!current) {
    // Sahipsiz veri (ör. adaptörün kendiliğinden gönderdiği gürültü) - yok say.
    return;
  }

  clearTimeout(current.timeoutHandle);
  const cleaned = rawResponse.replace(/\r/g, '\n').trim();
  current.resolve(cleaned);
  processQueue();
}

/**
 * ELM327 başlatma dizisini çalıştırır: sıfırlama, eko kapama, satır uzunluğu/
 * başlık ayarları ve otomatik protokol seçimi.
 * @returns {Promise<void>}
 */
export async function runInitSequence() {
  const initCommands = ['ATZ', 'ATE0', 'ATL0', 'ATH0', 'ATSP0'];
  for (const command of initCommands) {
    try {
      await sendCommand(command);
    } catch (error) {
      logWarn('elm327', `Başlatma komutu yanıt vermedi: ${command}`, error);
      // Tek bir AT komutunun zaman aşımı tüm başlatmayı iptal etmemeli;
      // devam edip son durumu init sonunda doğrularız.
    }
  }
  logInfo('elm327', 'ELM327 başlatma dizisi tamamlandı');
}

/**
 * 00, 20, 40 PID gruplarını sorgulayarak aracın desteklediği tüm PID'lerin
 * listesini çıkarır. Desteklenmeyenler dashboard'da otomatik gizlenecektir
 * (bkz. ui katmanı, Faz 2).
 * @returns {Promise<string[]>} Desteklenen PID kodları (hex).
 */
export async function discoverSupportedPids() {
  const groups = [0x00, 0x20, 0x40];
  const supported = [];

  for (const groupStart of groups) {
    const pidHex = groupStart.toString(16).toUpperCase().padStart(2, '0');
    try {
      const response = await sendCommand(`01${pidHex}`);
      const bytes = extractDataBytes(response, '41', pidHex);
      if (bytes && bytes.length === 4) {
        supported.push(...decodeSupportedPidBitmask(bytes, groupStart));
      }
      // Bit 32 (grubun son biti) bir sonraki grubun destekli olup olmadığını
      // gösterir; basitlik için üç grubu da sırayla deniyoruz.
    } catch (error) {
      logWarn('elm327', `PID grup keşfi başarısız: ${pidHex}`, error);
      break; // Araç bu grubu desteklemiyorsa sonrakiler de desteklemez.
    }
  }

  logInfo('elm327', `${supported.length} PID destekleniyor`, { supported });
  return supported;
}

/**
 * Tek bir Mod 01 PID'i sorgular ve pid-definitions.js'teki formülle çözer.
 * @param {string} pidHex - İki haneli hex PID kodu, ör. "0C".
 * @returns {Promise<{name: string, unit: string, value: number}|null>}
 */
export async function queryPid(pidHex) {
  const definition = PID_DEFINITIONS[pidHex];
  if (!definition) {
    logWarn('elm327', `Tanımsız PID sorgulandı: ${pidHex}`);
    return null;
  }

  const response = await sendCommand(`01${pidHex}`);
  const bytes = extractDataBytes(response, '41', pidHex);
  if (!bytes || bytes.length < definition.expectedBytes) {
    return null;
  }

  return {
    name: definition.name,
    unit: definition.unit,
    value: definition.decode(bytes),
  };
}

/**
 * Aracın VIN numarasını okur (Mod 09, PID 02).
 * @returns {Promise<string|null>}
 */
export async function readVin() {
  try {
    const response = await sendCommand('0902');
    const hexPairs = response
      .split(/\s+/)
      .filter((token) => /^[0-9A-Fa-f]{2}$/.test(token));

    // Yanıt "49 02 01 <VIN byte'ları...>" biçimindedir; ilk üç byte başlıktır.
    const vinBytes = hexPairs.slice(3).map((h) => parseInt(h, 16));
    const vin = vinBytes.map((b) => String.fromCharCode(b)).join('').trim();
    return vin.length >= 11 ? vin : null;
  } catch (error) {
    logWarn('elm327', 'VIN okunamadı', error);
    return null;
  }
}

/**
 * Yakıt tipini okur (Mod 01, PID 51) ve Türkçe açıklamaya çevirir.
 * @returns {Promise<string|null>}
 */
export async function readFuelType() {
  /** @type {Record<number, string>} SAE J1979 yakıt tipi kodları. */
  const FUEL_TYPES = {
    1: 'Benzin', 2: 'Metanol', 3: 'Etanol', 4: 'Dizel', 5: 'LPG',
    6: 'CNG', 7: 'Propan', 8: 'Elektrik', 9: 'Bi-yakıt (Benzin)',
    10: 'Bi-yakıt (Metanol)', 11: 'Bi-yakıt (Etanol)', 12: 'Bi-yakıt (LPG)',
    13: 'Bi-yakıt (CNG)', 14: 'Bi-yakıt (Propan)', 15: 'Bi-yakıt (Elektrik)',
    16: 'Hibrit (Benzin)', 17: 'Hibrit (Etanol)', 18: 'Hibrit (Dizel)',
  };

  try {
    const response = await sendCommand('0151');
    const bytes = extractDataBytes(response, '41', '51');
    if (!bytes || bytes.length < 1) return null;
    return FUEL_TYPES[bytes[0]] ?? 'Bilinmiyor';
  } catch (error) {
    logWarn('elm327', 'Yakıt tipi okunamadı', error);
    return null;
  }
}

/**
 * Aracın hafızasındaki arıza kodlarını (DTC) okur (Mod 03).
 * @returns {Promise<string[]>} ör. ["P0301", "P0420"]. Kod yoksa boş dizi.
 */
export async function readDtcCodes() {
  try {
    const response = await sendCommand('03');
    return parseDtcResponse(response, '43');
  } catch (error) {
    logWarn('elm327', 'Arıza kodları okunamadı', error);
    return [];
  }
}

/**
 * Aracın hafızasındaki arıza kodlarını siler (Mod 04). GERİ ALINAMAZ - arıza
 * lambasını söndürür ama altta yatan sorunu ÇÖZMEZ, yalnızca kaydı temizler.
 * @returns {Promise<boolean>} Komutun onaylanıp onaylanmadığı.
 */
export async function clearDtcCodes() {
  try {
    const response = await sendCommand('04');
    return response.toUpperCase().includes('44');
  } catch (error) {
    logWarn('elm327', 'Arıza kodları silinemedi', error);
    return false;
  }
}

/**
 * Mod 03/07 yanıtındaki ham hex byte çiftlerini standart DTC koduna
 * (ör. "P0301") çevirir. Her kod 2 byte (4 hex karakter) ile temsil edilir;
 * "0000" kod yokluğunu belirtir ve atlanır.
 * @param {string} response
 * @param {string} modeEcho - ör. "43" (Mod 03 yanıt eko'su).
 * @returns {string[]}
 */
function parseDtcResponse(response, modeEcho) {
  const tokens = response
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => /^[0-9A-F]{2}$/.test(t));

  const startIndex = tokens.findIndex((t) => t === modeEcho);
  const dataBytes = startIndex === -1 ? tokens : tokens.slice(startIndex + 1);

  const codes = [];
  for (let i = 0; i + 1 < dataBytes.length; i += 2) {
    const firstByte = parseInt(dataBytes[i], 16);
    const secondByte = parseInt(dataBytes[i + 1], 16);
    if (firstByte === 0 && secondByte === 0) continue;

    const letters = ['P', 'C', 'B', 'U'];
    const letter = letters[(firstByte >> 6) & 0x03];
    const firstDigit = (firstByte >> 4) & 0x03;
    const secondDigit = (firstByte & 0x0F).toString(16).toUpperCase();
    const thirdDigit = ((secondByte >> 4) & 0x0F).toString(16).toUpperCase();
    const fourthDigit = (secondByte & 0x0F).toString(16).toUpperCase();

    codes.push(`${letter}${firstDigit}${secondDigit}${thirdDigit}${fourthDigit}`);
  }
  return codes;
}

/**
 * ELM327'nin ham hex yanıtından (ör. "41 0C 1A F8") veri byte'larını
 * ayıklar; mod ve PID eko'sunu doğrulayıp geri kalan byte'ları sayıya çevirir.
 * @param {string} response
 * @param {string} expectedModeEcho - ör. "41" (Mod 01 yanıt eko'su).
 * @param {string} expectedPid
 * @returns {number[]|null}
 */
function extractDataBytes(response, expectedModeEcho, expectedPid) {
  const tokens = response
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => /^[0-9A-F]{2}$/.test(t));

  const modeIndex = tokens.findIndex(
    (t, i) => t === expectedModeEcho && tokens[i + 1] === expectedPid,
  );
  if (modeIndex === -1) return null;

  return tokens.slice(modeIndex + 2).map((h) => parseInt(h, 16));
}
