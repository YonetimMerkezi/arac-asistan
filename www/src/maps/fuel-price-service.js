/**
 * fuel-price-service.js
 * ---------------------------------------------------------------------------
 * Sedat'ın kendi Cloudflare Worker'ından (doviz.com kazıyıcı) il/ilçe bazlı
 * akaryakıt fiyatlarını çeker. Konum -> il/ilçe dönüşümü reverse-geocode.js
 * ile yapılır (GPS'ten otomatik).
 *
 * ÖZEL DURUM - İSTANBUL: Worker'ın kaynağı (doviz.com) İstanbul'u tek il
 * olarak değil "İstanbul Avrupa"/"İstanbul Anadolu" diye iki ayrı il gibi
 * ele alıyor. reverse-geocode.js Nominatim'den düz "İstanbul" döndürürse,
 * bu dosya konumun Boğaz'ın hangi yakasında olduğunu boylama bakarak kabaca
 * tahmin edip uygun adı kullanır.
 * ---------------------------------------------------------------------------
 */

import { Preferences } from '@capacitor/preferences';
import { logWarn } from '../core/logger.js';

/** @type {string} Varsayılan Worker adresi (Sedat'ın "Okul AI Asistan" worker'ı). */
const DEFAULT_WORKER_ENDPOINT = 'https://okul-ai-asistan.sedonet23.workers.dev/';

/** @type {string} Kullanıcının Ayarlar'dan özel bir worker adresi girip girmediğini sakladığımız anahtar. */
const STORAGE_KEY = 'sda_fuel_worker_url';

/** @type {number} Fiyat listesini önbellekte tutma süresi (ms) - sık sık yeniden çekmemek için. */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 dakika

/**
 * @typedef {Object} FuelStationPrice
 * @property {string} dagitici - Marka adı (ör. "Opet", "Shell").
 * @property {number|null} benzin - TL/litre.
 * @property {number|null} motorin - TL/litre.
 * @property {number|null} lpg - TL/litre.
 * @property {string|null} tarih
 */

/** @type {{key: string, fetchedAt: number, stations: FuelStationPrice[]}|null} */
let cache = null;

/**
 * Ayarlar'da kayıtlı özel worker adresini döndürür (yoksa null).
 * @returns {Promise<string|null>}
 */
export async function getFuelWorkerUrl() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Kullanıcının kendi worker adresini kalıcı olarak saklar.
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function setFuelWorkerUrl(url) {
  await Preferences.set({ key: STORAGE_KEY, value: url });
  cache = null; // adres değiştiyse eski önbellek geçersiz.
}

/**
 * Kullanılacak worker adresini döndürür - Ayarlar'da özel bir adres
 * kayıtlıysa onu, yoksa varsayılanı kullanır.
 * @returns {Promise<string>}
 */
async function resolveWorkerEndpoint() {
  const custom = await getFuelWorkerUrl();
  return custom || DEFAULT_WORKER_ENDPOINT;
}

/**
 * İstanbul'un boylama göre Avrupa/Anadolu yakası tahminini yapar (kabaca
 * Boğaz hizasındaki 29.05 meridyeni referans alınır).
 * @param {number} lon
 * @returns {string}
 */
function istanbulSideFor(lon) {
  return lon < 29.05 ? 'İstanbul Avrupa' : 'İstanbul Anadolu';
}

/** @type {string} Sedat'ın GitHub Actions'ının periyodik ürettiği, tüm il/ilçe
 * akaryakıt fiyatlarını içeren statik yedek JSON — worker'a hiç ulaşılamazsa
 * (ör. ağ tarafında workers.dev engeli) bu denenir. */
const STATIC_FALLBACK_URL = 'https://raw.githubusercontent.com/YonetimMerkezi/arac-asistan/main/veri/akaryakit-veri.json';

/**
 * doviz.com'un il/ilçe adlarını URL slug'ına çevirme kuralıyla BİREBİR aynı
 * dönüşümü yapar (Türkçe karakterleri sadeleştirir, boşlukları tireye çevirir).
 * Statik yedek JSON'daki anahtarlarla eşleşmesi için gereklidir.
 * @param {string} ad
 * @returns {string}
 */
function slugYap(ad) {
  return ad
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/i̇/g, 'i')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** @type {{data: Object, fetchedAt: number}|null} Statik yedek JSON'un bellek içi önbelleği (tekrar tekrar indirmemek için). */
let statikYedekOnbellek = null;

/**
 * Statik yedek JSON'u indirir (10 dakikada bir en fazla) ve ham veriyi döndürür.
 * @returns {Promise<Object>}
 */
async function statikYedekVeriyiYukle() {
  if (!statikYedekOnbellek || Date.now() - statikYedekOnbellek.fetchedAt > CACHE_TTL_MS) {
    const response = await fetch(STATIC_FALLBACK_URL + '?t=' + Date.now());
    if (!response.ok) throw new Error(`Yedek JSON hatası: ${response.status}`);
    const data = await response.json();
    statikYedekOnbellek = { data, fetchedAt: Date.now() };
  }
  return statikYedekOnbellek.data;
}

/**
 * Statik yedek JSON'u indirir (10 dakikada bir en fazla) ve verilen il/ilçe
 * için istasyon listesini döndürür.
 * @param {string} il
 * @param {string} ilce
 * @returns {Promise<FuelStationPrice[]>}
 */
async function statikYedektenGetir(il, ilce) {
  const data = await statikYedekVeriyiYukle();

  const ilSlug = slugYap(il);
  const ilceSlug = slugYap(ilce);
  const ilKaydi = data.iller?.[ilSlug];
  const ilceKaydi = ilKaydi?.ilceler?.[ilceSlug];
  if (!ilceKaydi) throw new Error(`Yedekte bulunamadı: ${ilSlug}/${ilceSlug}`);

  return (ilceKaydi.istasyonlar ?? []).map((s) => ({
    dagitici: s.dagitici,
    benzin: s.benzin,
    motorin: s.motorin,
    lpg: s.lpg,
    tarih: s.tarih ?? null,
  }));
}

/**
 * Bir ilin TÜM ilçelerindeki fiyat kayıtlarını, dağıtıcı adına göre
 * tekilleştirerek (aynı dağıtıcı birden fazla ilçede varsa ilk bulunan
 * kaydı kullanarak) birleştirir. Belirli bir ilçenin fiyat listesinde
 * olmayan bir marka (ör. o ilçede raporlanan bir Opet yoksa ama ilin başka
 * bir ilçesinde varsa), "Marka Ata" listesinde yine de seçilebilsin diye
 * kullanılır - SADECE statik yedek JSON'dan (worker'ın tek-ilçe sorgusu bu
 * genişletilmiş görünümü sağlayamaz, ilin TÜM ilçe verisi yalnızca bizim
 * periyodik ürettiğimiz JSON'da bir arada bulunuyor).
 * @param {string} il
 * @returns {Promise<FuelStationPrice[]>}
 */
export async function getProvinceFuelPrices(il) {
  const data = await statikYedekVeriyiYukle();
  const ilSlug = slugYap(il);
  const ilKaydi = data.iller?.[ilSlug];
  if (!ilKaydi) return [];

  const birlesikMap = new Map();
  for (const ilceKaydi of Object.values(ilKaydi.ilceler ?? {})) {
    for (const s of ilceKaydi.istasyonlar ?? []) {
      if (!s.dagitici || birlesikMap.has(s.dagitici)) continue;
      birlesikMap.set(s.dagitici, {
        dagitici: s.dagitici,
        benzin: s.benzin,
        motorin: s.motorin,
        lpg: s.lpg,
        tarih: s.tarih ?? null,
      });
    }
  }
  return Array.from(birlesikMap.values());
}

/**
 * Verilen il/ilçe için akaryakıt fiyat listesini getirir (10 dakikalık önbellekle).
 * @param {string} il
 * @param {string} ilce
 * @param {number} [currentLon] - "İstanbul" düz adı gelirse yaka tahmini için gerekir.
 * @returns {Promise<FuelStationPrice[]>}
 */
export async function getFuelPrices(il, ilce, currentLon) {
  const normalizedIl = il.toLowerCase().startsWith('i̇stanbul') || il.toLowerCase() === 'istanbul'
    ? istanbulSideFor(currentLon ?? 29.0) // boylam yoksa Avrupa yakasını varsayar
    : il;

  const cacheKey = `${normalizedIl}|${ilce}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.stations;
  }

  // 1. KADEME: Cloudflare Worker (birincil, en güncel kaynak).
  try {
    const endpoint = await resolveWorkerEndpoint();
    const url = `${endpoint}?il=${encodeURIComponent(normalizedIl)}&ilce=${encodeURIComponent(ilce)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.error) throw new Error(data.message ?? 'Bilinmeyen hata');

    const stations = (data.istasyonlar ?? []).map((s) => ({
      dagitici: s.dagitici,
      benzin: parseTurkishDecimal(s.benzin),
      motorin: parseTurkishDecimal(s.motorin),
      lpg: parseTurkishDecimal(s.lpg),
      tarih: s.tarih ?? null,
    }));

    cache = { key: cacheKey, fetchedAt: Date.now(), stations };
    return stations;
  } catch (workerHata) {
    logWarn('fuel-price-service', `Worker'dan alınamadı, statik yedek deneniyor: ${normalizedIl}/${ilce}`, workerHata);

    // 2. KADEME: Worker'a hiç ulaşılamazsa, GitHub Actions'ın periyodik
    // ürettiği statik yedek JSON'u dene (tüm il/ilçe verisini içerir).
    try {
      const stations = await statikYedektenGetir(normalizedIl, ilce);
      cache = { key: cacheKey, fetchedAt: Date.now(), stations };
      return stations;
    } catch (yedekHata) {
      logWarn('fuel-price-service', `Yakıt fiyatları alınamadı: ${normalizedIl}/${ilce}`, yedekHata);
      // 3. KADEME: İkisi de başarısızsa, cihazdaki son bilinen değere düş.
      return cache?.stations ?? [];
    }
  }
}

/**
 * @type {Record<string, string>} Marka takma adları - iki veri kaynağı
 * (OSM ve worker'ın fiyat listesi) aynı işletmeyi farklı adla anabiliyor.
 * ÖZEL DURUM: BP Türkiye 2025'te Petrol Ofisi'ne devroldu; istasyon tabela
 * dönüşümü Kasım 2026'ya kadar sürüyor - bu yüzden OSM'de hâlâ "BP" yazan
 * çoğu istasyon artık fiyat listesinde "Petrol Ofisi" olarak görünüyor.
 */
const BRAND_ALIASES = {
  bp: 'petrol ofisi',
};

/**
 * Bir istasyon/marka adına (OSM POI adı veya kullanıcı girdisi) en yakın
 * eşleşen fiyat kaydını bulur - basit, büyük/küçük harf duyarsız alt dize
 * eşleşmesi (iki veri kaynağı farklı yazım kullanabiliyor, ör. "Petrol
 * Ofisi" / "PO", bu yüzden tam eşleşme aranmaz).
 * @param {FuelStationPrice[]} stations
 * @param {string} brandOrName
 * @returns {FuelStationPrice|null}
 */
export function matchStationByName(stations, brandOrName) {
  if (!brandOrName) return null;
  let needle = brandOrName.toLocaleLowerCase('tr');
  needle = BRAND_ALIASES[needle] ?? needle;

  return stations.find((s) => {
    const hay = s.dagitici.toLocaleLowerCase('tr');
    return needle.includes(hay) || hay.includes(needle);
  }) ?? null;
}

/**
 * Türkçe ondalık ayırıcılı (virgüllü) bir fiyat metnini sayıya çevirir.
 * @param {string|null} value
 * @returns {number|null}
 */
function parseTurkishDecimal(value) {
  if (!value) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
