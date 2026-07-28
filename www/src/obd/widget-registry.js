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
 */

/** @type {WidgetDefinition[]} Kayıtlı TÜM widget'lar - kullanıcı bunların bir alt kümesini/sırasını seçer. */
export const WIDGET_REGISTRY = [
  { pid: '0D', label: 'Hız', unit: 'km/h', min: 0, max: 240, unitKind: 'speed', defaultColorHue: 28 },
  { pid: '0C', label: 'Motor Devri', unit: 'RPM', min: 0, max: 8000, dangerAbove: 6500, defaultColorHue: 28 },
  { pid: '05', label: 'Hararet', unit: '°C', min: 0, max: 130, dangerAbove: 105, unitKind: 'temp', defaultColorHue: 4 },
  { pid: '42', label: 'Akü Voltajı', unit: 'V', min: 8, max: 16, dangerAbove: 15, defaultColorHue: 48 },
  { pid: '2F', label: 'Yakıt Seviyesi', unit: '%', min: 0, max: 100, defaultColorHue: 142 },
  { pid: '04', label: 'Motor Yükü', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '11', label: 'Gaz Kelebeği', unit: '%', min: 0, max: 100, defaultColorHue: 28 },
  { pid: '0F', label: 'Emme Havası', unit: '°C', min: -20, max: 80, unitKind: 'temp', defaultColorHue: 199 },
  { pid: '46', label: 'Dış Sıcaklık', unit: '°C', min: -30, max: 55, unitKind: 'temp', defaultColorHue: 199 },
  { pid: '10', label: 'Hava Kütle Akışı', unit: 'g/s', min: 0, max: 400, defaultColorHue: 199 },
  { pid: '33', label: 'Emme Manifoldu Basıncı', unit: 'kPa', min: 0, max: 255, defaultColorHue: 291 },
  { pid: '5C', label: 'Motor Yağ Sıcaklığı', unit: '°C', min: 0, max: 150, dangerAbove: 120, unitKind: 'temp', defaultColorHue: 4 },
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
