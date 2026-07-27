/**
 * pid-definitions.js
 * ---------------------------------------------------------------------------
 * Standart OBD-II Mod 01 PID tanımları: isim, birim ve ham byte'ları
 * gerçek değere çeviren formül.
 *
 * Bu dosya SAF VERİDİR - herhangi bir bağlantı veya ELM327 komut mantığı
 * içermez. Yeni bir PID eklemek isteyen biri yalnızca bu dosyayı düzenler;
 * elm327.js hiç değişmez (Open/Closed prensibi).
 *
 * Formüller SAE J1979 standardına dayanır.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} PidDefinition
 * @property {string} name - Türkçe okunabilir ad.
 * @property {string} unit
 * @property {number} expectedBytes - Yanıtta beklenen veri byte sayısı (A, B, ...).
 * @property {(bytes: number[]) => number} decode - Ham byte dizisinden değeri hesaplar.
 */

/** @type {Record<string, PidDefinition>} PID kodu (hex, büyük harf) -> tanım. */
export const PID_DEFINITIONS = {
  '04': {
    name: 'Motor Yükü',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '05': {
    name: 'Motor Soğutma Suyu Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
  '0C': {
    name: 'Motor Devri',
    unit: 'RPM',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 4,
  },
  '0D': {
    name: 'Araç Hızı',
    unit: 'km/h',
    expectedBytes: 1,
    decode: ([a]) => a,
  },
  '0F': {
    name: 'Emme Havası Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
  '10': {
    name: 'Hava Kütle Akışı (MAF)',
    unit: 'g/s',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 100,
  },
  '11': {
    name: 'Gaz Kelebeği Konumu',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '2F': {
    name: 'Yakıt Seviyesi',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '33': {
    name: 'Basınç (Emme Manifoldu)',
    unit: 'kPa',
    expectedBytes: 1,
    decode: ([a]) => a,
  },
  '42': {
    name: 'Kontrol Modülü Voltajı',
    unit: 'V',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 1000,
  },
  '46': {
    name: 'Dış Ortam Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
  '5C': {
    name: 'Motor Yağ Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
};

/**
 * Bir PID grubunun (00, 20, 40...) desteklenen alt PID'lerini gösteren
 * 4 byte'lık bitmask'i çözer. Bit 1 -> destekleniyor.
 * PID'ler standarda göre büyükten küçüğe (MSB ilk) sıralanır.
 * @param {number[]} bytes - 4 byte'lık yanıt.
 * @param {number} groupStart - Bu grubun başlangıç PID numarası (ör. 0x00, 0x20).
 * @returns {string[]} Desteklenen PID kodları (hex, büyük harf, 2 haneli).
 */
export function decodeSupportedPidBitmask(bytes, groupStart) {
  const supported = [];
  let bitIndex = 0;

  for (const byte of bytes) {
    for (let b = 7; b >= 0; b -= 1) {
      const isSupported = ((byte >> b) & 1) === 1;
      if (isSupported) {
        const pidNumber = groupStart + bitIndex + 1;
        supported.push(pidNumber.toString(16).toUpperCase().padStart(2, '0'));
      }
      bitIndex += 1;
    }
  }
  return supported;
}
