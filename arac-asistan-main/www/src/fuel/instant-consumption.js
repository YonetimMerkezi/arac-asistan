/**
 * instant-consumption.js
 * ---------------------------------------------------------------------------
 * MAF (hava kütle akışı, PID 10) tabanlı ANLIK yakıt tüketimi hesabı.
 *
 * trip-recorder.js zaten aynı stokiyometrik hava/yakıt oranı yöntemiyle
 * YOLCULUK TOPLAMI yakıt tüketimini hesaplıyordu - bu dosya AYNI formülü
 * (kod tekrarını önlemek için) paylaşılan bir yere taşır ve dashboard'daki
 * "Anlık Tüketim" widget'ının (bkz. obd/widget-registry.js CALC_L100)
 * saniye saniye değişen L/100km değerini üretir.
 *
 * DÜRÜSTLÜK NOTU: Standart OBD Mod 01'de doğrudan "anlık tüketim" PID'i
 * YOKTUR - bu, MAF ve hız üzerinden TAHMİN edilir (Torque ve benzeri
 * uygulamaların kullandığı yaygın yaklaşım). Araç dururken (hız 0) L/100km
 * tanımsızdır - bu durumda saatlik tüketim (L/h) döndürülür.
 * ---------------------------------------------------------------------------
 */

/** @type {number} Benzin için varsayılan stokiyometrik hava/yakıt oranı (kütlece). */
const STOICHIOMETRIC_AFR = 14.7;

/** @type {number} Benzin yoğunluğu (g/L), yakıt tipi bilinmiyorsa varsayılan. */
const FUEL_DENSITY_G_PER_L = 750;

/**
 * MAF değerinden (g/s) saatlik yakıt tüketimini (L/h) hesaplar.
 * @param {number} mafGramsPerSecond
 * @returns {number}
 */
export function estimateLitersPerHour(mafGramsPerSecond) {
  return (mafGramsPerSecond * 3600) / (STOICHIOMETRIC_AFR * FUEL_DENSITY_G_PER_L);
}

/**
 * Saatlik tüketimi (L/h) ve o andaki hızı (km/h) kullanarak 100 km başına
 * tüketimi hesaplar. Hız çok düşükken (rölanti/duruş) sonuç anlamsız
 * (sonsuza yaklaşan) büyüklüklere ulaşacağından, bu durumda `null` döner -
 * çağıran taraf (dashboard-view.js) bunu "L/h" birimiyle göstermeye
 * geçebilir.
 * @param {number} litersPerHour
 * @param {number} speedKmh
 * @param {number} [minSpeedKmh=5] - Bu hızın altında L/100km hesabı güvenilmez sayılır.
 * @returns {number|null}
 */
export function estimateLitersPer100Km(litersPerHour, speedKmh, minSpeedKmh = 5) {
  if (speedKmh < minSpeedKmh) return null;
  return (litersPerHour / speedKmh) * 100;
}
