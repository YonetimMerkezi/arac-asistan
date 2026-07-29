/**
 * navigation-route-panel.js
 * ---------------------------------------------------------------------------
 * Bir favori konuma rota çizme: OSRM'den rota(lar) alma, ana + alternatif
 * çizgileri haritaya çizme, varış saati (ETA) hesaplama, sesli dönüş
 * rehberliğini başlatma ve yaklaşık yakıt maliyetini durum satırına ekleme.
 *
 * navigation-view.js'ten BİLİNÇLİ olarak ayrıldı (kod standardı: dosya
 * başına maks. 500 satır) - o dosya yalnızca haritayı/favorileri/POI'yi
 * yönetir, bu dosya yalnızca "bir yere rota çiz" akışını.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { getLastPosition } from '../core/gps-tracker.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { estimateAverageConsumption, estimateFuelCost } from '../fuel/route-cost-estimator.js';
import { startGuidance } from '../maps/turn-by-turn.js';
import { logWarn } from '../core/logger.js';

/** @type {import('leaflet').Polyline|null} Şu an seçili (ana) rota çizgisi. */
let routeLine = null;

/** @type {import('leaflet').Polyline[]} Seçilmeyen alternatif rota çizgileri. */
let alternateRouteLines = [];

/**
 * Mevcut konumdan verilen favori konuma rota hesaplayıp çizer.
 * @param {import('leaflet').Map} map
 * @param {import('../maps/favorites-store.js').FavoriteLocation} destination
 * @param {HTMLElement} container
 */
export async function drawRouteTo(map, destination, container) {
  const current = getLastPosition();
  const statusEl = container.querySelector('[data-status]');
  if (!current) {
    if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Rota hesaplanıyor...';

  const routes = await getDrivingRoute(
    { lat: current.latitude, lon: current.longitude },
    { lat: destination.lat, lon: destination.lon },
  );

  if (!routes || routes.length === 0) {
    if (statusEl) statusEl.textContent = 'Rota alınamadı (internet bağlantınızı kontrol edin).';
    return;
  }

  selectRoute(map, routes, 0, destination, container);
  void appendRouteFuelCost(statusEl, current, routes[0].distanceKm);
}

/**
 * Verilen rota listesinden birini "seçili" (ana, kalın çizgi) olarak çizer;
 * geri kalanı alternatif (ince, soluk, tıklanabilir) çizgiler olarak
 * gösterilir - bir alternatife dokunmak onu ana rota yapar.
 *
 * DÜRÜSTLÜK NOTU: Bu alternatifler ve süre tahmini OSRM'in kendi rota
 * modelinden gelir - GERÇEK ZAMANLI TRAFİK VERİSİ İÇERMEZ (kullanılan
 * ücretsiz halka açık OSRM sunucusunda böyle bir veri kaynağı yok). Rota
 * çizgileri bu yüzden trafik yoğunluğuna göre RENKLENDİRİLMİYOR - bunu
 * yapabilmek için Mapbox/Google gibi ücretli, API anahtarı gerektiren bir
 * trafik servisine geçmek gerekir.
 * @param {import('leaflet').Map} map
 * @param {import('../maps/route-service.js').RouteResult[]} routes
 * @param {number} selectedIndex
 * @param {import('../maps/favorites-store.js').FavoriteLocation} destination
 * @param {HTMLElement} container
 */
function selectRoute(map, routes, selectedIndex, destination, container) {
  const statusEl = container.querySelector('[data-status]');
  const selected = routes[selectedIndex];

  if (routeLine) map.removeLayer(routeLine);
  alternateRouteLines.forEach((line) => map.removeLayer(line));
  alternateRouteLines = [];

  routes.forEach((route, index) => {
    if (index === selectedIndex) return;
    const line = L.polyline(route.coordinates, { color: '#8B93A1', weight: 4, opacity: 0.6, dashArray: '6 8' })
      .addTo(map)
      .on('click', () => selectRoute(map, routes, index, destination, container));
    alternateRouteLines.push(line);
  });

  routeLine = L.polyline(selected.coordinates, { color: '#4FD8E0', weight: 5 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });

  const eta = new Date(Date.now() + selected.durationMinutes * 60000);
  const etaText = eta.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const altNote = routes.length > 1 ? ` · ${routes.length - 1} alternatif rota (haritada dokun)` : '';

  if (statusEl) {
    statusEl.textContent = `${destination.label}: ${selected.distanceKm.toFixed(1)} km, ~${Math.round(selected.durationMinutes)} dk, varış ~${etaText}${altNote}`;
  }

  startGuidance(selected);
}

/**
 * Rota mesafesine göre yaklaşık yakıt maliyetini hesaplayıp durum satırına
 * ekler - hesaplama bittiğinde eklenir (rota anında görünsün, maliyet
 * hesaplaması ağ isteği gerektirdiği için biraz gecikebilir).
 * @param {HTMLElement|null} statusEl
 * @param {import('../core/gps-tracker.js').LivePosition} current
 * @param {number} distanceKm
 */
async function appendRouteFuelCost(statusEl, current, distanceKm) {
  try {
    const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
    if (!location) return;

    const prices = await getFuelPrices(location.il, location.ilce, current.longitude);
    const withPrice = prices.find((p) => p.benzin !== null);
    if (!withPrice) return;

    const litersPer100Km = await estimateAverageConsumption();
    const { liters, cost } = estimateFuelCost(distanceKm, litersPer100Km, withPrice.benzin);

    if (statusEl) {
      statusEl.textContent += ` · ~${liters.toFixed(1)} L, ~${cost.toFixed(0)} ₺ (yakıt tahmini)`;
    }
  } catch (error) {
    logWarn('navigation-route-panel', 'Rota yakıt maliyeti hesaplanamadı', error);
  }
}
