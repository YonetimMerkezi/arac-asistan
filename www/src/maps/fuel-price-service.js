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
  } catch (error) {
    logWarn('fuel-price-service', `Yakıt fiyatları alınamadı: ${normalizedIl}/${ilce}`, error);
    return cache?.stations ?? []; // ağ hatasında varsa eski önbelleği döndür, yoksa boş liste
  }
}

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
  const needle = brandOrName.toLocaleLowerCase('tr');

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
