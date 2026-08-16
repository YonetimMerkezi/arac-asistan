/**
 * widget-registry.js
 * ---------------------------------------------------------------------------
 * Panel'de gösterilebilecek TÜM veri widget'larının kaydı.
 *
 * obd/pid-definitions.js her PID'in nasıl ÇÖZÜLECEĞİNİ (formül) tanımlar;
 * bu dosya her PID'in Panel'de nasıl GÖSTERİLECEĞİNİ (gösterge aralığı,
 * tehlike eşiği, birim türü) tanımlar - iki kaygı ayrı tutulur.
 *
 * GENİŞLETİLEBİLİRLİK ("farklı araç verileri çekilebilmeli"): Yeni bir
 * PID'i Panel'de widget olarak sunmak için tek yapılması gereken, önce
 * pid-definitions.js'e formülünü, sonra buraya görüntüleme meta verisini
 * eklemektir - dashboard-view.js hiç değişmez (Open/Closed prensibi).
 * Kullanıcı, Panel'deki "Düzenle" modundan bu kayıttaki HERHANGİ bir
 * widget'ı ekleyip çıkarabilir, sıralayabilir, rengini değiştirebilir.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} WidgetDefinition
 * @property {string} pid - Hex PID kodu (obd/pid-definitions.js ile eşleşir).
 * @property {string} label
 * @property {string} unit
 * @property {number} min
 * @property {number} max
 * @property {number} [dangerAbove]
 * @property {'speed'|'temp'} [unitKind] - Ayarlar'daki birim tercihine göre dönüştürülür.
 * @property {number} defaultColorHue - Kullanıcı özel renk seçmediyse kullanılan ton (0-360).
 * @property {string[]} [requiresPids] - Bu widget TEK bir ham PID değil, birden fazla
 *   PID'den TÜRETİLMİŞ (hesaplanmış) bir değerse (ör. "Anlık Tüketim" - MAF + hız),
 *   bağımlı olduğu ham PID kodlarını listeler. dashboard-view.js hem görünürlük
 *   kontrolünde (araç bu PID'leri desteklemiyorsa kart gizlenir) hem poll
 *   döngüsünde (pid.js'e tek sorgu yerine özel hesaplama akışına yönlendirmek
 *   için) bunu kullanır.
 */

/** @type {WidgetDefinition[]} Kayıtlı TÜM widget'lar - kullanıcı bunların bir alt kümesini/sırasını seçer. */
export const WIDGET_REGISTRY = [
  { pid: '0D', label: 'Hız', unit: 'km/h', min: 0, max: 240, unitKind: 'speed', defaultColorHue: 28 },
  { pid: '0C', label: 'Motor Devri', unit: 'RPM', min: 0, max: 8000, dangerAbove: 6500, defaultColorHue: 28 },
  { pid: '05', label: 'Hararet', unit: '°C', min: 0, max: 140, dangerAbove: 105, unitKind: 'temp', defaultColorHue: 4 },
  { pid: '42', label: 'Akü Voltajı', unit: 'V', min: 8, max: 16, dangerAbove: 15, defaultColorHue: 48 },
  { pid: '2F', label: 'Yakıt Seviyesi', unit: '%', min: 0, max: 100, defaultColorHue: 142 },
  { pid: '04', label: 'Motor Yükü', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '11', label: 'Gaz Kelebeği', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '0F', label: 'Emme Havası', unit: '°C', min: -20, max: 80, unitKind: 'temp', defaultColorHue: 199 },
  { pid: '46', label: 'Dış Sıcaklık', unit: '°C', min: -30, max: 60, unitKind: 'temp', defaultColorHue: 199 },
  { pid: '10', label: 'Hava Kütle Akışı', unit: 'g/s', min: 0, max: 400, defaultColorHue: 199 },
  { pid: '33', label: 'Emme Manifoldu Basıncı', unit: 'kPa', min: 0, max: 255, defaultColorHue: 291 },
  { pid: '5C', label: 'Motor Yağ Sıcaklığı', unit: '°C', min: 0, max: 160, dangerAbove: 120, unitKind: 'temp', defaultColorHue: 4 },
  { pid: '06', label: 'Kısa Dönem Yakıt Ayarı (Bank 1)', unit: '%', min: -100, max: 100, defaultColorHue: 335 },
  { pid: '07', label: 'Uzun Dönem Yakıt Ayarı (Bank 1)', unit: '%', min: -100, max: 100, defaultColorHue: 335 },
  { pid: '08', label: 'Kısa Dönem Yakıt Ayarı (Bank 2)', unit: '%', min: -100, max: 100, defaultColorHue: 291 },
  { pid: '09', label: 'Uzun Dönem Yakıt Ayarı (Bank 2)', unit: '%', min: -100, max: 100, defaultColorHue: 291 },
  { pid: '0E', label: 'Avans Zamanlaması', unit: '°', min: -64, max: 64, defaultColorHue: 48 },
  { pid: 'CALC_L100', label: 'Anlık Tüketim', unit: 'L/100km', min: 0, max: 30, defaultColorHue: 142, requiresPids: ['10', '0D'] },

  // DÜZENLEME (2026-07-30): "Tüm Sensörler" ekranında (Arıza Merkezi) görünen
  // ama Panel'e EKLENEMEYEN PID'ler vardı - kullanıcı "bunlardan panele
  // eklemek istediklerim olabilir" dedi. pid-definitions.js'te formülü olan
  // HER PID artık burada da widget olarak seçilebilir - aradaki boşluk kapandı.
  { pid: '0B', label: 'Emme Manifoldu Mutlak Basıncı', unit: 'kPa', min: 0, max: 255, defaultColorHue: 291 },
  { pid: '14', label: 'O2 Sensörü 1 (Bank 1) Voltajı', unit: 'V', min: 0, max: 1.275, defaultColorHue: 335 },
  { pid: '15', label: 'O2 Sensörü 2 (Bank 1) Voltajı', unit: 'V', min: 0, max: 1.275, defaultColorHue: 335 },
  { pid: '1F', label: 'Motor Çalışma Süresi', unit: 's', min: 0, max: 18000, defaultColorHue: 199 },
  { pid: '21', label: 'Arıza Lambası Mesafesi', unit: 'km', min: 0, max: 65535, defaultColorHue: 4 },
  { pid: '2C', label: 'Komuta Edilen EGR', unit: '%', min: 0, max: 100, defaultColorHue: 291 },
  { pid: '2D', label: 'EGR Hatası', unit: '%', min: -100, max: 100, defaultColorHue: 291 },
  { pid: '2E', label: 'Evaporatif Temizleme', unit: '%', min: 0, max: 100, defaultColorHue: 291 },
  { pid: '31', label: 'Kod Silindiğinden Beri Mesafe', unit: 'km', min: 0, max: 65535, defaultColorHue: 199 },
  { pid: '3C', label: 'Katalizör Sıcaklığı (B1S1)', unit: '°C', min: -40, max: 900, unitKind: 'temp', defaultColorHue: 4 },
  { pid: '3D', label: 'Katalizör Sıcaklığı (B2S1)', unit: '°C', min: -40, max: 900, unitKind: 'temp', defaultColorHue: 4 },
  { pid: '43', label: 'Mutlak Motor Yükü', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '44', label: 'Hava/Yakıt Oranı (λ)', unit: 'λ', min: 0, max: 2, defaultColorHue: 335 },
  { pid: '45', label: 'Bağıl Gaz Kelebeği', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '49', label: 'Gaz Pedalı Konumu D', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '4A', label: 'Gaz Pedalı Konumu E', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '4C', label: 'Gaz Kelebeği Aktüatörü', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '5E', label: 'Yakıt Tüketim Hızı', unit: 'L/h', min: 0, max: 100, defaultColorHue: 142 },
];

/** @type {string[]} Kullanıcı hiç özelleştirme yapmadıysa gösterilecek varsayılan widget sırası. */
export const DEFAULT_WIDGET_ORDER = ['0D', '0C', '05', '42', '2F'];

/**
 * @param {string} pid
 * @returns {WidgetDefinition|null}
 */
export function getWidgetDefinition(pid) {
  return WIDGET_REGISTRY.find((w) => w.pid === pid) ?? null;
}
