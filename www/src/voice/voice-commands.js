/**
 * voice-commands.js
 * ---------------------------------------------------------------------------
 * Sesli komut yorumlayıcısı.
 *
 * stt.js'ten gelen tanınmış cümleleri anahtar kelimelere göre eşler ve
 * vehicle-live-data-store.js'teki (dashboard'un zaten okuduğu) güncel
 * değerlerle sesli yanıt üretir. Henüz geliştirilmemiş modüllere (yolculuk,
 * arıza kodları, navigasyon, bakım - Faz 4/5/6/7) ait komutlar dürüstçe
 * "henüz hazır değil" yanıtı verir; sahte veri UYDURULMAZ.
 * ---------------------------------------------------------------------------
 */

import { onTranscript } from './stt.js';
import { speak } from './tts.js';
import { getLivePidValue } from '../core/vehicle-live-data-store.js';
import { getLastPosition } from '../core/gps-tracker.js';
import { getFavoriteLocation } from '../maps/favorites-store.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { findNearbyPoi } from '../maps/poi-search.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getAggregateTripStats } from '../data/trip-repository.js';
import { getNextUpcomingMaintenance } from '../maintenance/maintenance-reminder.js';
import { readDtcCodes } from '../obd/elm327.js';
import { getDtcDescription } from '../diagnostics/dtc-descriptions.js';
import { recordDtcReading } from '../data/dtc-repository.js';
import { launchMusicApp } from '../core/app-launcher.js';
import { logInfo } from '../core/logger.js';

/**
 * @typedef {Object} CommandRule
 * @property {string[]} keywords - Cümlede TÜMÜ geçmesi gereken anahtar kelimeler (OR grubu olarak da kullanılabilir, bkz. matches).
 * @property {(transcript: string) => string} respond - Yanıt metnini üretir.
 */

/**
 * Bir PID değerini konuşma metnine çevirir; değer yoksa/bayatsa dürüstçe
 * "şu an okunamıyor" der.
 * @param {string} pidHex
 * @param {string} label
 * @returns {string}
 */
function describePid(pidHex, label) {
  const entry = getLivePidValue(pidHex);
  if (!entry) {
    return `${label} şu anda okunamıyor.`;
  }
  return `${label} ${Math.round(entry.value)} ${entry.unit}.`;
}

/**
 * @type {string} Uyandırma kelimesi - bir cümle bu kelimeyi İÇERMİYORSA hiç
 * işlenmez (tamamen sessiz kalınır).
 *
 * NEDEN GEREKLİ: Sürekli dinleme modu, arabadaki SIRADAN KONUŞMALARI da
 * yakalayıp "tanınmış cümle" olarak işleyebiliyor (log kayıtlarında
 * "Bunlar hepsi bizim komşularım" gibi alakasız cümlelerin bile
 * tanındığı görüldü). Eşleşmeyen HER cümleye "anlayamadım" demek bu
 * yüzden çok rahatsız edici olurdu - yolcular arası her cümleye asistan
 * araya girerdi. Uyandırma kelimesi bunu çözer: yalnızca bu kelimeyi
 * İÇEREN cümleler "bana söylenmiş" sayılır; geri kalanı tamamen yok sayılır.
 */
const WAKE_WORD = 'asistan';

/** @type {string} Uyandırma kelimesiyle başlayan ama HİÇBİR komuta uymayan cümle için yanıt. */
const NOT_UNDERSTOOD_RESPONSE = 'Anlayamadım, tekrar eder misiniz?';

/** @type {{test: (t: string) => boolean, respond: () => string}[]} */
const COMMAND_RULES = [
  {
    test: (t) => t.includes('motor sıcaklığı') || t.includes('hararet'),
    respond: () => describePid('05', 'Motor sıcaklığı'),
  },
  {
    test: (t) => t.includes('yakıt') && (t.includes('ne kadar') || t.includes('seviye')),
    respond: () => describePid('2F', 'Yakıt seviyesi yüzde'),
  },
  {
    test: (t) => t.includes('akü') && t.includes('voltaj'),
    respond: () => describePid('42', 'Akü voltajı'),
  },
  {
    test: (t) => t.includes('hız') && !t.includes('sınırı'),
    respond: () => describePid('0D', 'Anlık hız'),
  },
  {
    test: (t) => t.includes('motor devri') || t.includes('devir'),
    respond: () => describePid('0C', 'Motor devri'),
  },
  {
    test: (t) => t.includes('ortalama tüketim'),
    respond: () => announceAverageConsumption(),
  },
  {
    test: (t) => t.includes('arıza kod') && (t.includes('oku') || t.includes('göster')),
    respond: () => announceDtcCodes(),
  },
  {
    test: (t) => t.includes('müzik') && (t.includes('aç') || t.includes('çal') || t.includes('başlat')),
    respond: () => announceMusicAppLaunch(),
  },
  {
    test: (t) => t.includes('arıza kod') && t.includes('sil'),
    respond: () => clearDtcCodesViaVoice(),
  },
  {
    test: (t) => t.includes('eve götür') || t.includes('eve git'),
    respond: () => navigateToFavorite('home', 'Ev'),
  },
  {
    test: (t) => t.includes('akaryakıt istasyonu') || (t.includes('en yakın') && t.includes('yakıt')),
    respond: () => announceNearestFuelStation(),
  },
  {
    test: (t) => t.includes('ucuz mazot') || t.includes('ucuz benzin'),
    respond: () => announceCheapestFuel(),
  },
  {
    test: (t) => t.includes('bakım ne zaman') || t.includes('bakım zamanı'),
    respond: () => announceNextMaintenance(),
  },
];

/** @type {(() => void)|null} */
let unsubscribe = null;

/**
 * Sesli komut yorumlayıcısını başlatır: stt.js'in transkript akışına abone olur.
 */
export function initVoiceCommands() {
  if (unsubscribe) return; // zaten başlatılmış
  unsubscribe = onTranscript(handleTranscript);
  logInfo('voice-commands', 'Sesli komut yorumlayıcı başlatıldı');
}

/**
 * Aboneliği kaldırır (bellek sızıntısı önleme).
 */
export function disposeVoiceCommands() {
  unsubscribe?.();
  unsubscribe = null;
}

/**
 * Tek bir tanınmış cümleyi işler: eşleşen ilk kurala göre yanıt üretip seslendirir.
 * @param {string} rawTranscript
 */
function handleTranscript(rawTranscript) {
  const normalized = rawTranscript.toLocaleLowerCase('tr-TR').trim();

  // Uyandırma kelimesi YOKSA tamamen sessiz kalınır - sürücüler arası
  // sıradan sohbetin her cümlesi işlenmesin diye (bkz. WAKE_WORD notu).
  if (!normalized.includes(WAKE_WORD)) return;

  const rule = COMMAND_RULES.find((r) => r.test(normalized));
  if (!rule) {
    logInfo('voice-commands', `Uyandırma kelimesi duyuldu ama komut eşleşmedi: "${normalized}"`);
    void speak(NOT_UNDERSTOOD_RESPONSE);
    return;
  }

  void (async () => {
    const response = await rule.respond();
    logInfo('voice-commands', `Komut eşleşti: "${normalized}" -> "${response}"`);
    void speak(response);
  })();
}

/**
 * "Beni eve/işe götür" komutu için: kayıtlı favori konuma rota özetini seslendirir.
 * Gerçek harita/rota çizimi navigasyon ekranında görünür; bu yalnızca sesli özet.
 * @param {string} favoriteId
 * @param {string} label
 * @returns {Promise<string>}
 */
async function navigateToFavorite(favoriteId, label) {
  const favorite = getFavoriteLocation(favoriteId);
  if (!favorite) {
    return `${label} konumu henüz kayıtlı değil. Navigasyon ekranından ${label.toLowerCase()} konumunuzu kaydedebilirsiniz.`;
  }

  const current = getLastPosition();
  if (!current) {
    return 'Konumunuz henüz alınamadı.';
  }

  const routes = await getDrivingRoute(
    { lat: current.latitude, lon: current.longitude },
    { lat: favorite.lat, lon: favorite.lon },
  );

  if (!routes || routes.length === 0) {
    return 'Rota şu anda hesaplanamıyor, internet bağlantınızı kontrol edin.';
  }

  const route = routes[0];
  return `${label}e ${route.distanceKm.toFixed(0)} kilometre, tahmini ${Math.round(route.durationMinutes)} dakika. Rota navigasyon ekranında.`;
}

/**
 * "En yakın akaryakıt istasyonu" komutu için.
 * @returns {Promise<string>}
 */
async function announceNearestFuelStation() {
  const current = getLastPosition();
  if (!current) {
    return 'Konumunuz henüz alınamadı.';
  }

  const results = await findNearbyPoi('fuel', current.latitude, current.longitude);
  if (results.length === 0) {
    return 'Yakında akaryakıt istasyonu bulunamadı.';
  }

  const nearest = results[0];
  return `En yakın akaryakıt istasyonu ${nearest.distanceKm.toFixed(1)} kilometre uzaklıkta.`;
}

/**
 * "Ortalama tüketim" komutu için: tüm tamamlanmış yolculukların toplam
 * mesafe/yakıt oranından hesaplar.
 * @returns {Promise<string>}
 */
async function announceAverageConsumption() {
  const { totalDistanceKm, totalFuelL } = await getAggregateTripStats();
  if (totalDistanceKm < 1) {
    return 'Henüz yeterli yolculuk verisi yok.';
  }

  const litersPer100Km = (totalFuelL / totalDistanceKm) * 100;
  return `Ortalama tüketiminiz 100 kilometrede ${litersPer100Km.toFixed(1)} litre.`;
}

/**
 * "Ucuz mazot/benzin" komutu için: bulunduğu il/ilçedeki TÜM dağıtıcıların
 * fiyatlarından en ucuz benzini bulup seslendirir.
 * @returns {Promise<string>}
 */
async function announceCheapestFuel() {
  const current = getLastPosition();
  if (!current) {
    return 'Konumunuz henüz alınamadı.';
  }

  const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
  if (!location) {
    return 'Bulunduğunuz il/ilçe belirlenemedi.';
  }

  const prices = await getFuelPrices(location.il, location.ilce, current.longitude);
  const withPrice = prices.filter((p) => p.benzin !== null);
  if (withPrice.length === 0) {
    return `${location.il} için yakıt fiyatı bulunamadı.`;
  }

  const cheapest = withPrice.reduce((min, s) => (s.benzin < min.benzin ? s : min));
  return `En ucuz benzin ${cheapest.dagitici}'de, litresi ${cheapest.benzin} lira.`;
}

/**
 * "Bakım ne zaman" komutu için.
 * @returns {Promise<string>}
 */
async function announceNextMaintenance() {
  const next = await getNextUpcomingMaintenance();
  if (!next) {
    return 'Tanımlı bir bakım kaydı bulunamadı.';
  }

  if (next.kmRemaining <= 0) {
    return `${next.item.label} bakımının süresi geçti.`;
  }

  return `${next.item.label} bakımına yaklaşık ${Math.round(next.kmRemaining)} kilometre kaldı.`;
}

/**
 * "Arıza kodlarını oku" komutu için: kodları okur, geçmişe kaydeder, sesli özetler.
 * @returns {Promise<string>}
 */
async function announceDtcCodes() {
  const codes = await readDtcCodes();
  await recordDtcReading(codes);

  if (codes.length === 0) {
    return 'Kayıtlı arıza kodu bulunamadı.';
  }

  const summary = codes.map((code) => getDtcDescription(code).title).join(', ');
  return `${codes.length} arıza kodu bulundu: ${summary}. Detaylar Arıza Merkezi ekranında.`;
}

/**
 * "Arıza kodlarını sil" komutu için: GÜVENLİK NEDENİYLE kodları doğrudan
 * silmez - bu geri alınamaz bir işlemdir ve sürüş sırasında yanlışlıkla
 * tetiklenmemesi için Arıza Merkezi ekranındaki onay diyaloğuna yönlendirir.
 * @returns {Promise<string>}
 */
async function clearDtcCodesViaVoice() {
  return 'Arıza kodlarını silmek için Arıza Merkezi ekranından onaylamanız gerekiyor, güvenlik amacıyla bu işlem sesli komutla yapılamıyor.';
}

/**
 * "Müzik aç" komutu: yüklü ilk müzik uygulamasını (bkz. core/app-launcher.js)
 * açar. Hiçbiri yüklü değilse dürüstçe belirtir - sahte başarı iddia edilmez.
 * @returns {Promise<string>}
 */
async function announceMusicAppLaunch() {
  const result = await launchMusicApp();
  return result.ok ? `${result.label} açılıyor.` : 'Yüklü bir müzik uygulaması bulunamadı.';
}
