/**
 * fuel-station-cache.js
 * ---------------------------------------------------------------------------
 * Yakındaki akaryakıt istasyonlarını ve bölgesel fiyatları arka planda tutar.
 * İstasyon arama menzili 25 km'dir. Arşiv/önbellekten dönen istasyonlar her
 * yeni GPS konumunda yeniden mesafelendirilir; 25 km dışındakiler gösterilmez.
 * ---------------------------------------------------------------------------
 */

import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { findNearbyPoi } from './poi-search.js';
import { reverseGeocodeIlIlce } from './reverse-geocode.js';
import { getFuelPrices } from './fuel-price-service.js';
import { Preferences } from '@capacitor/preferences';
import { logInfo, logWarn } from '../core/logger.js';

const STORAGE_KEY = 'sda_fuel_station_cache_v1';
const STORAGE_KEY_REGIONS = 'sda_fuel_visited_regions_v1';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const REFRESH_DISTANCE_KM = 3;
const STATION_SEARCH_RADIUS_KM = 25;
const STATION_SEARCH_RADIUS_M = STATION_SEARCH_RADIUS_KM * 1000;

/**
 * @typedef {Object} FuelStationCache
 * @property {import('./poi-search.js').PoiResult[]} stations
 * @property {import('./fuel-price-service.js').FuelStationPrice[]} prices
 * @property {{il: string, ilce: string}|null} location
 * @property {number} fetchedAt
 * @property {{lat: number, lon: number}|null} fetchedForPosition
 */

/** @type {FuelStationCache} */
let cache = { stations: [], prices: [], location: null, fetchedAt: 0, fetchedForPosition: null };
let visitedRegions = {};
const listeners = new Set();
let refreshInProgress = false;
let queuedRefresh = null;

function regionKey(location) {
  return `${location.il}|${location.ilce}`.toLocaleLowerCase('tr').trim();
}

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
    if (movedKm > REFRESH_DISTANCE_KM) void refresh(position.latitude, position.longitude);
  });

  setInterval(() => {
    const current = getLastPosition();
    if (current) void refresh(current.latitude, current.longitude);
  }, REFRESH_INTERVAL_MS);
}

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
        const current = getLastPosition();
        cache = current
          ? { ...kayitli, stations: normalizeStationsForPosition(kayitli.stations, current.latitude, current.longitude) }
          : kayitli;
        logInfo('fuel-station-cache', `Diskten yüklendi: ${cache.stations.length} istasyon, ${cache.prices?.length ?? 0} fiyat kaydı`);
        notify();
      }
    }
  } catch (error) {
    logWarn('fuel-station-cache', 'Diskteki önbellek okunamadı', error);
  }
}

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

export function getFuelStationCache() {
  const current = getLastPosition();
  if (!current) return { ...cache, stations: [...(cache.stations ?? [])] };
  return {
    ...cache,
    stations: normalizeStationsForPosition(cache.stations ?? [], current.latitude, current.longitude),
  };
}

export function getVisitedRegions() {
  return Object.values(visitedRegions);
}

export function onFuelStationCacheUpdate(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function forceRefreshFuelStationCache() {
  const current = getLastPosition();
  if (current) await refresh(current.latitude, current.longitude, true);
}

function notify() {
  const snapshot = getFuelStationCache();
  for (const listener of listeners) listener(snapshot);
}

async function refresh(lat, lon, forceRefresh = false) {
  if (refreshInProgress) {
    queuedRefresh = {
      lat,
      lon,
      forceRefresh: Boolean(forceRefresh || queuedRefresh?.forceRefresh),
    };
    return;
  }
  refreshInProgress = true;

  try {
    const geocodePromise = reverseGeocodeIlIlce(lat, lon).catch((error) => {
      logWarn('fuel-station-cache', 'Konum çözümlenemedi (il/ilçe)', error);
      return null;
    });

    // Aynı il/ilçe daha önce ziyaret edildiyse ağ beklenmeden göster; fakat
    // istasyonları ESKİ konum mesafeleriyle kullanma.
    void geocodePromise.then((location) => {
      if (!location) return;
      const archived = visitedRegions[regionKey(location)];
      if (!archived) return;
      cache = {
        ...archived,
        stations: normalizeStationsForPosition(archived.stations ?? [], lat, lon),
        fetchedForPosition: { lat, lon },
      };
      logInfo('fuel-station-cache', `Arşiv yeniden mesafelendirildi: ${location.il}/${location.ilce} (${cache.stations.length} istasyon / ${STATION_SEARCH_RADIUS_KM} km)`);
      notify();
    });

    // Kullanıcının istediği gerçek arama menzili: doğrudan 25 km.
    const stationsPromise = findNearbyPoi('fuel', lat, lon, STATION_SEARCH_RADIUS_M)
      .then((stations) => normalizeStationsForPosition(stations, lat, lon));

    const pricesPromise = geocodePromise.then((location) => (
      location ? getFuelPrices(location.il, location.ilce, lon, forceRefresh) : []
    ));

    // Fiyatlar istasyonlardan önce gelebilir. Eski konumdan kalan işaretçileri
    // yeni konum fiyatlarıyla karıştırma; yalnızca aynı 3 km alanındaysa koru.
    void Promise.all([geocodePromise, pricesPromise]).then(([location, prices]) => {
      if (!location) return;
      const previous = cache.fetchedForPosition;
      const sameArea = previous
        ? haversineKm(previous.lat, previous.lon, lat, lon) <= REFRESH_DISTANCE_KM
        : false;
      cache = {
        ...cache,
        stations: sameArea ? normalizeStationsForPosition(cache.stations ?? [], lat, lon) : [],
        location,
        prices,
        fetchedAt: Date.now(),
        fetchedForPosition: { lat, lon },
      };
      notify();
    });

    const [stations, location, prices] = await Promise.all([stationsPromise, geocodePromise, pricesPromise]);

    cache = {
      stations,
      prices,
      location,
      fetchedAt: Date.now(),
      fetchedForPosition: { lat, lon },
    };

    if (location) visitedRegions[regionKey(location)] = { ...cache, stations: [...stations] };

    logInfo('fuel-station-cache', `Önbellek tazelendi: ${stations.length} istasyon (${STATION_SEARCH_RADIUS_KM} km), ${prices.length} fiyat kaydı`);
    notify();
    void diskeKaydet();

    if (stations.length > 0 && prices.length === 0) {
      setTimeout(() => void refresh(lat, lon), 30 * 1000);
    }
  } catch (error) {
    logWarn('fuel-station-cache', 'Önbellek tazeleme başarısız', error);
  } finally {
    refreshInProgress = false;
    const pending = queuedRefresh;
    queuedRefresh = null;
    if (pending) {
      const fetched = cache.fetchedForPosition;
      const stillNeedsRefresh = pending.forceRefresh || !fetched || haversineKm(
        fetched.lat, fetched.lon, pending.lat, pending.lon,
      ) > REFRESH_DISTANCE_KM;
      if (stillNeedsRefresh) void refresh(pending.lat, pending.lon, pending.forceRefresh);
    }
  }
}

function normalizeStationsForPosition(stations, lat, lon) {
  return (Array.isArray(stations) ? stations : [])
    .map((station) => {
      const stationLat = Number(station?.lat);
      const stationLon = Number(station?.lon);
      if (!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) return null;
      const distanceKm = haversineKm(lat, lon, stationLat, stationLon);
      if (distanceKm > STATION_SEARCH_RADIUS_KM) return null;
      return { ...station, lat: stationLat, lon: stationLon, distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
