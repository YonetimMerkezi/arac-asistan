/**
 * weather-service.js
 * ---------------------------------------------------------------------------
 * Open-Meteo (ücretsiz, API anahtarı gerektirmeyen, halka açık) servisinden
 * konuma göre güncel hava durumu bilgisini çeker.
 *
 * Diğer "maps/" servisleri (fuel-price-service.js, route-service.js) ile
 * aynı desen: ücretsiz halka açık bir servis + kısa süreli önbellek (sık
 * sorgu = gereksiz pil/veri tüketimi).
 * ---------------------------------------------------------------------------
 */

import { logWarn } from '../core/logger.js';

/** @type {number} Hava durumu önbelleğini tutma süresi (ms). */
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika

/**
 * @type {Record<number, {label: string, icon: string}>} WMO hava durumu kodu
 * (Open-Meteo'nun döndürdüğü `weathercode`) -> Türkçe açıklama + emoji simge.
 * Emoji kullanılması BİLİNÇLİDİR: "renkli ikonlar" gereksinimi için ekstra
 * bir ikon fontu/paketi eklemeden, her sistemde çalışan renkli bir gösterim sağlar.
 */
const WEATHER_CODE_MAP = {
  0: { label: 'Açık', icon: '☀️' },
  1: { label: 'Az Bulutlu', icon: '🌤️' },
  2: { label: 'Parçalı Bulutlu', icon: '⛅' },
  3: { label: 'Kapalı', icon: '☁️' },
  45: { label: 'Sisli', icon: '🌫️' },
  48: { label: 'Kırağı Sisi', icon: '🌫️' },
  51: { label: 'Hafif Çisenti', icon: '🌦️' },
  53: { label: 'Çisenti', icon: '🌦️' },
  55: { label: 'Yoğun Çisenti', icon: '🌧️' },
  61: { label: 'Hafif Yağmur', icon: '🌧️' },
  63: { label: 'Yağmur', icon: '🌧️' },
  65: { label: 'Şiddetli Yağmur', icon: '🌧️' },
  66: { label: 'Dondurucu Yağmur', icon: '🌧️' },
  67: { label: 'Dondurucu Yağmur', icon: '🌧️' },
  71: { label: 'Hafif Kar', icon: '🌨️' },
  73: { label: 'Kar', icon: '🌨️' },
  75: { label: 'Yoğun Kar', icon: '❄️' },
  77: { label: 'Kar Taneleri', icon: '❄️' },
  80: { label: 'Sağanak', icon: '🌦️' },
  81: { label: 'Sağanak', icon: '🌧️' },
  82: { label: 'Şiddetli Sağanak', icon: '⛈️' },
  85: { label: 'Kar Sağanağı', icon: '🌨️' },
  86: { label: 'Yoğun Kar Sağanağı', icon: '❄️' },
  95: { label: 'Gök Gürültülü Fırtına', icon: '⛈️' },
  96: { label: 'Dolu ile Fırtına', icon: '⛈️' },
  99: { label: 'Şiddetli Dolulu Fırtına', icon: '⛈️' },
};

/** @type {{key: string, fetchedAt: number, data: CurrentWeather}|null} */
let cache = null;

/**
 * @typedef {Object} CurrentWeather
 * @property {number} temperatureC
 * @property {string} label - Türkçe açıklama, ör. "Parçalı Bulutlu".
 * @property {string} icon - Emoji.
 */

/**
 * Verilen konum için güncel hava durumunu getirir (15 dakikalık önbellekle).
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<CurrentWeather|null>}
 */
export async function getCurrentWeather(lat, lon) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    const code = json.current_weather?.weathercode ?? 0;
    const meta = WEATHER_CODE_MAP[code] ?? { label: 'Bilinmiyor', icon: '🌡️' };

    const data = {
      temperatureC: json.current_weather?.temperature ?? null,
      label: meta.label,
      icon: meta.icon,
    };

    cache = { key: cacheKey, fetchedAt: Date.now(), data };
    return data;
  } catch (error) {
    logWarn('weather-service', 'Hava durumu alınamadı', error);
    return cache?.data ?? null;
  }
}
