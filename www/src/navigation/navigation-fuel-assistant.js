/**
 * Smart Drive AI - navigasyon + yakıt asistanı
 *
 * OBD tüketim verisini mevcut uygulamadan event üzerinden alır.
 * Ortalama tüketim yoksa güvenli şekilde sonuç üretmez.
 */
let latest = {
  consumptionL100: null,
  fuelLiters: null,
  fuelPercent: null,
};

const listeners = new Set();

function emit() {
  listeners.forEach(fn => { try { fn({ ...latest }); } catch {} });
}

export function updateFuelData(data = {}) {
  latest = {
    ...latest,
    consumptionL100: Number.isFinite(Number(data.consumptionL100))
      ? Number(data.consumptionL100) : latest.consumptionL100,
    fuelLiters: Number.isFinite(Number(data.fuelLiters))
      ? Number(data.fuelLiters) : latest.fuelLiters,
    fuelPercent: Number.isFinite(Number(data.fuelPercent))
      ? Number(data.fuelPercent) : latest.fuelPercent,
  };
  emit();
}

export function onFuelData(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function estimateFuelForRoute(distanceMeters, tankCapacityLiters = null) {
  const km = Math.max(0, Number(distanceMeters || 0)) / 1000;
  const consumption = latest.consumptionL100;

  if (!Number.isFinite(consumption) || consumption <= 0 || km <= 0) {
    return { available: false, reason: 'Tüketim verisi yeterli değil.' };
  }

  const requiredLiters = km * consumption / 100;
  const currentLiters = Number.isFinite(latest.fuelLiters)
    ? latest.fuelLiters
    : Number.isFinite(latest.fuelPercent) && Number.isFinite(tankCapacityLiters)
      ? latest.fuelPercent / 100 * tankCapacityLiters
      : null;

  const result = {
    available: true,
    requiredLiters,
    currentLiters,
    remainingAfterRoute: currentLiters == null ? null : currentLiters - requiredLiters,
    sufficient: currentLiters == null ? null : currentLiters >= requiredLiters,
  };

  return result;
}
