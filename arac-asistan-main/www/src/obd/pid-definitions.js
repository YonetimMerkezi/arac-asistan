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
  '06': {
    name: 'Kısa Dönem Yakıt Ayarı (Bank 1)',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => ((a - 128) * 100) / 128,
  },
  '07': {
    name: 'Uzun Dönem Yakıt Ayarı (Bank 1)',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => ((a - 128) * 100) / 128,
  },
  '08': {
    name: 'Kısa Dönem Yakıt Ayarı (Bank 2)',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => ((a - 128) * 100) / 128,
  },
  '09': {
    name: 'Uzun Dönem Yakıt Ayarı (Bank 2)',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => ((a - 128) * 100) / 128,
  },
  '0B': {
    name: 'Emme Manifoldu Mutlak Basıncı',
    unit: 'kPa',
    expectedBytes: 1,
    decode: ([a]) => a,
  },
  '0C': {
    name: 'Motor Devri',
    unit: 'RPM',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 4,
  },
  '0E': {
    name: 'Avans Zamanlaması',
    unit: '°',
    expectedBytes: 1,
    decode: ([a]) => a / 2 - 64,
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
  '14': {
    name: 'Oksijen Sensörü 1 (Bank 1) Voltajı',
    unit: 'V',
    expectedBytes: 2,
    decode: ([a]) => a / 200,
  },
  '15': {
    name: 'Oksijen Sensörü 2 (Bank 1) Voltajı',
    unit: 'V',
    expectedBytes: 2,
    decode: ([a]) => a / 200,
  },
  '1F': {
    name: 'Motor Çalıştığından Beri Geçen Süre',
    unit: 's',
    expectedBytes: 2,
    decode: ([a, b]) => a * 256 + b,
  },
  '21': {
    name: 'Arıza Lambası Yanarken Alınan Mesafe',
    unit: 'km',
    expectedBytes: 2,
    decode: ([a, b]) => a * 256 + b,
  },
  '2C': {
    name: 'Komuta Edilen EGR',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '2D': {
    name: 'EGR Hatası',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => ((a - 128) * 100) / 128,
  },
  '2E': {
    name: 'Komuta Edilen Evaporatif Temizleme',
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
  '31': {
    name: 'Arıza Kodları Silindiğinden Beri Alınan Mesafe',
    unit: 'km',
    expectedBytes: 2,
    decode: ([a, b]) => a * 256 + b,
  },
  '33': {
    name: 'Basınç (Emme Manifoldu)',
    unit: 'kPa',
    expectedBytes: 1,
    decode: ([a]) => a,
  },
  '3C': {
    name: 'Katalizör Sıcaklığı (Bank 1, Sensör 1)',
    unit: '°C',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 10 - 40,
  },
  '3D': {
    name: 'Katalizör Sıcaklığı (Bank 2, Sensör 1)',
    unit: '°C',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 10 - 40,
  },
  '42': {
    name: 'Kontrol Modülü Voltajı',
    unit: 'V',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 1000,
  },
  '43': {
    name: 'Mutlak Motor Yükü',
    unit: '%',
    expectedBytes: 2,
    decode: ([a, b]) => ((a * 256 + b) * 100) / 255,
  },
  '44': {
    name: 'Komuta Edilen Hava/Yakıt Eşdeğerlik Oranı',
    unit: 'λ',
    expectedBytes: 2,
    decode: ([a, b]) => ((a * 256 + b) * 2) / 65535,
  },
  '45': {
    name: 'Bağıl Gaz Kelebeği Konumu',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '46': {
    name: 'Dış Ortam Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
  '49': {
    name: 'Gaz Pedalı Konumu D',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '4A': {
    name: 'Gaz Pedalı Konumu E',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '4C': {
    name: 'Komuta Edilen Gaz Kelebeği Aktüatörü',
    unit: '%',
    expectedBytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  '5C': {
    name: 'Motor Yağ Sıcaklığı',
    unit: '°C',
    expectedBytes: 1,
    decode: ([a]) => a - 40,
  },
  '5E': {
    name: 'Motor Yakıt Tüketim Hızı',
    unit: 'L/h',
    expectedBytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 20,
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
