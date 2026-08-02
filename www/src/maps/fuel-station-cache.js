/**
 * fuel-station-cache.js
 * ---------------------------------------------------------------------------
 * Yakındaki akaryakıt istasyonlarını VE bölgenin güncel fiyat listesini
 * uygulama açılışında bir kez, ardından belirli aralıklarla arka planda
 * çekip BELLEKTE tutar. Harita ve Yakıt ekranları artık her dokunuşta canlı
 * ağ isteği beklemek yerine bu önbellekten ANINDA okur - "istasyonları çok
 * geç buluyor" şikayetinin çözümü budur.
 *
 * ARŞİV: Sadece "son bilinen konum" değil, ZİYARET EDİLEN HER İL/İLÇE ayrı
 * ayrı ve KALICI olarak diske kaydedilir (bkz. visitedRegions/STORAGE_KEY_
 * REGIONS). Daha önce gidilmiş bir bölgeye tekrar girildiğinde (il/ilçe
 * eşleşince), taze bir Overpass/fiyat çekimi beklemeden ARŞİVDEKİ sonuç
 * anında gösterilir; arka planda yine de tazelenir. Bu veri, Preferences
 * altında saklandığı için uygulamanın genel yedekleme sistemine (bkz.
 * data/backup-service.js - TÜM Preferences anahtarlarını otomatik yedekler)
 * otomatik dahildir, ayrıca bir şey yapmaya gerek yoktur.
 *
 * Konum önemli ölçüde değiştiğinde (>3km) veya periyodik aralıkta (15 dk)
 * kendini tazeler.
 * ---------------------------------------------------------------------------
 */

import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { findNearbyPoi } from './poi-search.js';
import { reverseGeocodeIlIlce } from './reverse-geocode.js';
import { getFuelPrices } from './fuel-price-service.js';
import { Preferences } from '@capacitor/preferences';
import { logInfo, logWarn } from '../core/logger.js';

/** @type {string} Diske kaydedilen "en son aktif" önbelleğin anahtarı (geri uyumluluk + hızlı ilk açılış için). */
const STORAGE_KEY = 'sda_fuel_station_cache_v1';

/** @type {string} Ziyaret edilen TÜM bölgelerin kalıcı arşivinin anahtarı. */
const STORAGE_KEY_REGIONS = 'sda_fuel_visited_regions_v1';

/** @type {number} Periyodik tazeleme aralığı (ms). */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 dakika

/** @type {number} Bu mesafeden (km) fazla hareket edilirse süre dolmadan da tazelenir. */
const REFRESH_DISTANCE_KM = 3;

/**
 * @typedef {Object} FuelStationCache
 * @property {import('./poi-search.js').PoiResult[]} stations
 * @property {import('./fuel-price-service.js').FuelStationPrice[]} prices
 * @property {{il: string, ilce: string}|null} location
 * @property {number} fetchedAt - Date.now()
 * @property {{lat: number, lon: number}|null} fetchedForPosition
 */

/** @type {FuelStationCache} */
let cache = { stations: [], prices: [], location: null, fetchedAt: 0, fetchedForPosition: null };

/** @type {Object<string, FuelStationCache>} Ziyaret edilen her il/ilçe için ayrı kayıt (anahtar: bkz. regionKey()). */
let visitedRegions = {};

/** @type {Set<(cache: FuelStationCache) => void>} */
const listeners = new Set();

/** @type {boolean} */
let refreshInProgress = false;

/**
 * Bir il/ilçe çiftini arşiv anahtarına çevirir (büyük/küçük harf ve kenar
 * boşluğu farklarını yok sayar, aynı bölge farklı yazımlarla iki ayrı kayıt
 * oluşturmasın diye).
 * @param {{il: string, ilce: string}} location
 * @returns {string}
 */
function regionKey(location) {
  return `${location.il}|${location.ilce}`.toLocaleLowerCase('tr').trim();
}

/**
 * Önbelleği başlatır: DİSKTEKİ son bilinen sonucu VE ziyaret edilen bölgeler
 * arşivini ANINDA belleğe yükler - böylece uygulama açılır açılmaz, ilk
 * GPS/ağ çekimi bitmeden önce bile Harita/Yakıt ekranları en son bulunan
 * istasyonları/fiyatları gösterebilir. Ardından normal akış devam eder:
 * konum geldiğinde taze bir çekim başlatılır (arka planda, kullanıcı
 * beklemeden) - eğer o bölge arşivde zaten varsa, ÖNCE arşivdeki hâli anında
 * gösterilir, tazeleme sessizce arkadan gelir.
 */
export function initFuelStationCache() {
  void yukleDiskten();

  const last = getLastPosition();
  if (last) void refresh(last.latitude, last.longitude);

  onPosition((position) => {
    if (!cache.fetchedForPosition) {
      void refresh(position.latitude, position.longitude);
      return;
    }
    const movedKm = haversineKm(
      cache.fetchedForPosition.lat, cache.fetchedForPosition.lon,
      position.latitude, position.longitude,
    );
    if (movedKm > REFRESH_DISTANCE_KM) {
      void refresh(position.latitude, position.longitude);
    }
  });

  setInterval(() => {
    const current = getLastPosition();
    if (current) void refresh(current.latitude, current.longitude);
  }, REFRESH_INTERVAL_MS);
}

/**
 * Diskte kayıtlı son bilinen önbelleği VE ziyaret edilen bölgeler arşivini
 * okuyup belleğe yükler ve dinleyicilere haber verir (varsa). Hiç kayıt
 * yoksa (ilk kurulum) sessizce hiçbir şey yapmaz.
 */
async function yukleDiskten() {
  try {
    const [{ value: sonAktif }, { value: bolgeler }] = await Promise.all([
      Preferences.get({ key: STORAGE_KEY }),
      Preferences.get({ key: STORAGE_KEY_REGIONS }),
    ]);

    if (bolgeler) {
      const parsed = JSON.parse(bolgeler);
      if (parsed && typeof parsed === 'object') visitedRegions = parsed;
    }

    if (sonAktif) {
      const kayitli = JSON.parse(sonAktif);
      if (kayitli && Array.isArray(kayitli.stations)) {
        cache = kayitli;
        logInfo('fuel-station-cache', `Diskten yüklendi: ${cache.stations.length} istasyon, ${cache.prices.length} fiyat kaydı (arşivde ${Object.keys(visitedRegions).length} bölge)`);
        for (const listener of listeners) listener(getFuelStationCache());
      }
    }
  } catch (error) {
    logWarn('fuel-station-cache', 'Diskteki önbellek okunamadı', error);
  }
}

/**
 * Güncel önbelleği VE güncel bölge arşivini diske yazar (bir sonraki
 * açılışta/ziyarette anında gösterebilmek için). Yazma başarısız olursa
 * (ör. depolama dolu) sessizce yutulur - bellekteki hâli zaten kullanılmaya
 * devam eder.
 */
async function diskeKaydet() {
  try {
    await Promise.all([
      Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(cache) }),
      Preferences.set({ key: STORAGE_KEY_REGIONS, value: JSON.stringify(visitedRegions) }),
    ]);
  } catch (error) {
    logWarn('fuel-station-cache', 'Önbellek diske yazılamadı', error);
  }
}

/**
 * @returns {FuelStationCache}
 */
export function getFuelStationCache() {
  return { ...cache };
}

/**
 * Şimdiye kadar ziyaret edilip arşivlenmiş TÜM bölgelerin listesini döndürür
 * (ör. ileride bir "Ziyaret Ettiğim Yerler" ekranı yapılmak istenirse).
 * @returns {FuelStationCache[]}
 */
export function getVisitedRegions() {
  return Object.values(visitedRegions);
}

/**
 * Önbellek her tazelendiğinde çağrılacak dinleyici ekler.
 * @param {(cache: FuelStationCache) => void} callback
 * @returns {() => void}
 */
export function onFuelStationCacheUpdate(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Önbelleği hemen (bekleme aralığını yoksayarak) tazelemeye zorlar - ör.
 * kullanıcı Harita ekranında elle "yenile" isterse kullanılabilir.
 * @returns {Promise<void>}
 */
export async function forceRefreshFuelStationCache() {
  const current = getLastPosition();
  if (current) await refresh(current.latitude, current.longitude);
}

/**
 * @param {number} lat
 * @param {number} lon
 */
async function refresh(lat, lon) {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    // ÖNCE konumun il/ilçesini çöz - bölge arşivinde bu yer daha önce
    // ziyaret edilmişse, tam POI/fiyat taraması bitmeden ARŞİVDEKİ sonucu
    // anında gösterebilmek için (kullanıcı beklemesin diye).
    const location = await reverseGeocodeIlIlce(lat, lon);

    if (location) {
      const key = regionKey(location);
      const arsivKaydi = visitedRegions[key];
      if (arsivKaydi) {
        cache = { ...arsivKaydi, fetchedForPosition: { lat, lon } };
        logInfo('fuel-station-cache', `Arşivden anında gösterildi: ${location.il}/${location.ilce}`);
        for (const listener of listeners) listener(getFuelStationCache());
      }
    }

    let stations = await findNearbyPoi('fuel', lat, lon, 7000);
    if (stations.length === 0) {
      stations = await findNearbyPoi('fuel', lat, lon, 20000);
    }

    const prices = location ? await getFuelPrices(location.il, location.ilce, lon) : [];

    cache = {
      stations,
      prices,
      location,
      fetchedAt: Date.now(),
      fetchedForPosition: { lat, lon },
    };

    if (location) {
      visitedRegions[regionKey(location)] = { ...cache };
    }

    logInfo('fuel-station-cache', `Önbellek tazelendi: ${stations.length} istasyon, ${prices.length} fiyat kaydı`);
    for (const listener of listeners) listener(getFuelStationCache());
    void diskeKaydet();

    // İstasyonlar bulundu ama fiyat verisi boş geldiyse (ör. geçici bir ağ
    // aksaklığı), 15 dakika beklemeden kısa süre sonra bir kez daha dene.
    if (stations.length > 0 && prices.length === 0) {
      setTimeout(() => void refresh(lat, lon), 30 * 1000);
    }
  } catch (error) {
    logWarn('fuel-station-cache', 'Önbellek tazeleme başarısız', error);
  } finally {
    refreshInProgress = false;
  }
}

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
