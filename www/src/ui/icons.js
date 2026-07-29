/**
 * icons.js
 * ---------------------------------------------------------------------------
 * Simge sistemi - tek soyutlama katmanı.
 *
 * Neden bir dolaylama katmanı: Çağıran kod (nav, düğmeler, listeler) Google
 * Material Symbols'un TAM ligature adını (ör. "local_gas_station") değil,
 * bizim SEMANTİK adımızı kullanır (ör. "fuel"). Bu sayede:
 *  - Yanlış yazılmış bir ligature adı sessizce boş bir kutu gösterir,
 *    esbuild derlemesini KIRMAZ (npm paketi importuna kıyasla çok daha
 *    güvenli - bkz. PLAN.md'deki ai-view.js/listTripsSince dersi).
 *  - İleride simge kütüphanesi değişirse (ör. Material yerine başka bir
 *    fonta geçilirse) yalnızca ICON_MAP güncellenir, çağıran kodun HİÇBİRİ
 *    değişmez (Open/Closed prensibi).
 *
 * Font: Google Material Symbols Outlined (index.html'de CDN ile yüklü).
 * ---------------------------------------------------------------------------
 */

/** @type {Record<string, string>} Semantik ad -> Material Symbols ligature adı. */
const ICON_MAP = {
  // Alt gezinme
  panel: 'speed',
  trip: 'route',
  map: 'map',
  fuel: 'local_gas_station',
  diagnostics: 'build',
  analytics: 'auto_awesome',
  settings: 'settings',

  // Genel aksiyonlar
  edit: 'edit',
  done: 'check',
  add: 'add',
  remove: 'close',
  delete: 'delete',
  'arrow-up': 'arrow_upward',
  'arrow-down': 'arrow_downward',
  search: 'search',
  refresh: 'refresh',

  // Bağlantı / donanım
  bluetooth: 'bluetooth',
  mic: 'mic',
  'mic-off': 'mic_off',
  location: 'my_location',
  navigation: 'navigation',
  'speed-camera': 'photo_camera',

  // Tema
  'theme-light': 'light_mode',
  'theme-dark': 'dark_mode',
  'theme-system': 'contrast',
  palette: 'palette',

  // Araç verisi
  temperature: 'thermostat',
  battery: 'battery_full',
  car: 'directions_car',
  warning: 'warning',
  error: 'error',
  info: 'info',
  bolt: 'bolt',

  // POI kategorileri
  parking: 'local_parking',
  hospital: 'local_hospital',
  service: 'car_repair',
  home: 'home',
  work: 'work',

  // Ses
  'volume-on': 'volume_up',
  'volume-off': 'volume_off',
};

/**
 * Semantik simge adını Material Symbols `<span>` HTML dizesine çevirir.
 * innerHTML şablonlarına doğrudan gömülebilir.
 * @param {string} name - ICON_MAP'te tanımlı semantik ad.
 * @param {Object} [options]
 * @param {number} [options.size=20] - Piksel.
 * @param {string} [options.extraClass=''] - Ek CSS sınıfı.
 * @returns {string}
 */
export function iconMarkup(name, options = {}) {
  const { size = 20, extraClass = '' } = options;
  const ligature = ICON_MAP[name];
  if (!ligature) {
    // Kayıtsız bir ad istenirse sessizce boş span döner - derlemeyi
    // etkilemez, yalnızca o simge görünmez (bkz. dosya başındaki not).
    return '<span class="sda-icon"></span>';
  }
  return `<span class="material-symbols-outlined sda-icon ${extraClass}" style="font-size:${size}px;">${ligature}</span>`;
}
