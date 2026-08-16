/**
 * navigation-location.js
 * GPS konum servisi. Android WebView + tarayıcı ile uyumludur.
 */

let watchId = null;
let lastPosition = null;
const listeners = new Set();

function emit(position, error = null) {
  listeners.forEach((fn) => {
    try { fn(position, error); } catch {}
  });
}

export function onLocationChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLastLocation() {
  return lastPosition;
}

export function startLocationTracking(options = {}) {
  if (!navigator.geolocation) {
    emit(null, new Error('Bu cihazda GPS konum servisi kullanılamıyor.'));
    return false;
  }

  stopLocationTracking();

  const settings = {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 12000,
    ...options,
  };

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      lastPosition = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
        heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        timestamp: position.timestamp,
      };
      emit(lastPosition, null);
    },
    (error) => emit(null, error),
    settings,
  );

  return true;
}

export function stopLocationTracking() {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

export function centerOnCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS desteklenmiyor.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
          heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          timestamp: position.timestamp,
        };
        lastPosition = location;
        emit(location, null);
        resolve(location);
      },
      reject,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
  });
}
