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
import { Browser } from '@capacitor/browser';
import { getLastPosition } from '../core/gps-tracker.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { reverseGeocodeIlIlce } from '../maps/reverse-geocode.js';
import { getFuelPrices } from '../maps/fuel-price-service.js';
import { estimateAverageConsumption, estimateFuelCost } from '../fuel/route-cost-estimator.js';
import { startGuidance } from '../maps/turn-by-turn.js';
import { haversineDistanceKm } from '../trip/geo-utils.js';
import { logWarn } from '../core/logger.js';

/** @type {import('leaflet').Polyline|null} Şu an seçili (ana) rota çizgisi. */
let routeLine = null;

/** @type {import('leaflet').Polyline[]} Seçilmeyen alternatif rota çizgileri. */
let alternateRouteLines = [];

/**
 * Verilen (veya mevcut konumdan) noktadan verilen favori/aranan konuma
 * rota hesaplayıp çizer.
 * @param {import('leaflet').Map} map
 * @param {{lat: number, lon: number, label: string}} destination
 * @param {HTMLElement} container
 * @param {{lat: number, lon: number, label: string}|null} [origin] - Belirtilmezse
 *   mevcut GPS konumu kullanılır (önceki davranışla birebir uyumlu).
 */
export async function drawRouteTo(map, destination, container, origin = null) {
  const current = origin ?? getLastPosition();
  const statusEl = container.querySelector('[data-status]');
  const summaryEl = container.querySelector('[data-route-summary]');
  const googleMapsButton = container.querySelector('[data-open-google-maps]');
  if (summaryEl) summaryEl.style.display = 'none';

  // DÜZELTME: Google Haritalar düğmesi ÖNCEDEN yalnızca BİZİM OSRM rotamız
  // BAŞARILI olursa görünürdü - tam da rotamızın hatalı/dolambaçlı çıktığı
  // (kullanıcının Bingöl-Genç örneğinde bildirdiği) durumlarda kullanıcının
  // en çok ihtiyaç duyduğu an buydu. Artık hedef BELLİ OLUR OLMAZ, bizim
  // rotamız başarılı olsun olmasın, hemen görünür ve o hedefe göre çalışır.
  if (googleMapsButton) {
    googleMapsButton.style.display = 'flex';
    googleMapsButton.onclick = () => {
      void openInGoogleMaps(destination.lat, destination.lon, destination.searchQuery);
    };
  }

  if (!current) {
    if (statusEl) statusEl.textContent = 'Konum henüz alınamadı.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Rota hesaplanıyor...';

  const routes = await getDrivingRoute(
    { lat: current.latitude ?? current.lat, lon: current.longitude ?? current.lon },
    { lat: destination.lat, lon: destination.lon },
  );

  if (!routes || routes.length === 0) {
    if (statusEl) statusEl.textContent = 'Rota alınamadı (internet bağlantınızı kontrol edin). Google Haritalar\'ı deneyebilirsiniz.';
    return;
  }

  const bestIndex = pickLeastDetouredRoute(routes, current, destination);
  selectRoute(map, routes, bestIndex, destination, container);
  void appendRouteFuelCost(statusEl, { latitude: current.latitude ?? current.lat, longitude: current.longitude ?? current.lon }, routes[bestIndex].distanceKm);
}

/**
 * OSRM'in "birincil" dediği rota (dizinin ilk elemanı) HER ZAMAN en mantıklısı
 * olmuyor - bazı bölgelerde (özellikle kırsal/dağlık) OSRM'in yol verisi
 * eksik/hatalı olduğunda gereksiz dolambaçlı bir rota "birincil" seçilebiliyor
 * (bkz. Bingöl-Genç örneği - kullanıcı bildirdi). Bu fonksiyon, "kuş uçuşu
 * mesafeye oranla en az sapan" rotayı seçerek bu riski azaltır - `alternatives=true`
 * ile zaten istenen alternatifler arasından gerçek bir seçim yapılmış olur.
 * @param {import('../maps/route-service.js').RouteResult[]} routes
 * @param {{latitude?: number, longitude?: number, lat?: number, lon?: number}} origin
 * @param {{lat: number, lon: number}} destination
 * @returns {number} En iyi rotanın `routes` dizisindeki indeksi.
 */
function pickLeastDetouredRoute(routes, origin, destination) {
  const originLat = origin.latitude ?? origin.lat;
  const originLon = origin.longitude ?? origin.lon;
  const straightLineKm = haversineDistanceKm(originLat, originLon, destination.lat, destination.lon);

  if (straightLineKm < 0.5) return 0; // Çok kısa mesafede oran anlamsız - varsayılana güven.

  let bestIndex = 0;
  let bestRatio = Infinity;

  routes.forEach((route, index) => {
    const ratio = route.distanceKm / straightLineKm;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestIndex = index;
    }
  });

  if (bestIndex !== 0) {
    logWarn('navigation-route-panel', `OSRM'in birincil rotası aşırı dolambaçlıydı (oran: ${bestRatio.toFixed(2)}) - alternatif ${bestIndex} seçildi`);
  }

  return bestIndex;
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
  const summaryEl = container.querySelector('[data-route-summary]');
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

  if (statusEl) statusEl.textContent = '';
  if (summaryEl) {
    summaryEl.style.display = 'block';
    setField(summaryEl, 'route-destination', destination.label);
    setField(summaryEl, 'route-distance', `${selected.distanceKm.toFixed(1)} km`);
    setField(summaryEl, 'route-duration', `${Math.round(selected.durationMinutes)} dk`);
    setField(summaryEl, 'route-eta', etaText);
    setField(summaryEl, 'route-fuel', 'hesaplanıyor...');
    setField(summaryEl, 'route-alternatives', routes.length > 1 ? `${routes.length - 1} tane (haritada dokun)` : 'yok');
  }

  startGuidance(selected);
}

/**
 * Hedefe Google Haritalar'da (yüklüyse uygulama, değilse tarayıcı) yol
 * tarifini açar - Google'ın herkese açık evrensel bağlantı biçimini
 * kullanır, API ANAHTARI GEREKTİRMEZ, ÜCRETSİZDİR. Bu, kendi ücretsiz OSRM
 * rota motorumuzun bazı kırsal bölgelerde ürettiği hatalı/dolambaçlı
 * rotalara karşı GERÇEK bir alternatif sunar - Google'ın çok daha
 * eksiksiz yol verisiyle gezinme yapılır.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<void>}
 */
/**
 * Hedefe Google Haritalar'da (yüklüyse uygulama, değilse tarayıcı) yol
 * tarifini açar - Google'ın herkese açık evrensel bağlantı biçimini
 * kullanır, API ANAHTARI GEREKTİRMEZ, ÜCRETSİZDİR.
 *
 * İSİM TERCİH EDİLİR (koordinat değil): Kullanıcı "Genç" gibi bir yer adı
 * yazıp aratmışsa, Google Haritalar'a o İSMİ gönderiyoruz - Google KENDİ
 * coğrafi kodlamasını yapıyor. Bu, bizim Nominatim/OSRM zincirimizin
 * ürettiği yaklaşık koordinatlara güvenmek yerine, Google'ın çok daha
 * eksiksiz yer veritabanını kullanmasını sağlar - "yazdığım isme göre
 * geçsin" isteğinin karşılığı budur. İsim yoksa (ör. haritaya dokunarak
 * seçilen bir nokta) koordinata düşülür.
 * @param {number} lat
 * @param {number} lon
 * @param {string} [searchQuery] - Kullanıcının GERÇEKTEN aradığı/yazdığı yer adı
 *   (yalnızca adres aramasından gelir - "Ev"/"İş" gibi favori etiketleri
 *   BURAYA GEÇİRİLMEMELİDİR, Google'a anlamsız bir isim gönderilmiş olur).
 * @returns {Promise<void>}
 */
export async function openInGoogleMaps(lat, lon, searchQuery) {
  const destination = searchQuery ? encodeURIComponent(searchQuery) : `${lat},${lon}`;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  await Browser.open({ url });
}

/**
 * Google Haritalar'ı, HERHANGİ bir hedef aramadan/rotasız, mevcut konuma
 * ortalanmış şekilde doğrudan açar - kullanıcı "hiçbir rota oluşturmadan
 * doğrudan Google Haritalar'a geçip orada arayayım" isteğinin karşılığı.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<void>}
 */
export async function openGoogleMapsGeneral(lat, lon) {
  const url = `https://www.google.com/maps/@${lat},${lon},15z`;
  await Browser.open({ url });
}

/**
 * @param {HTMLElement} summaryEl
 * @param {string} field
 * @param {string} value
 */
function setField(summaryEl, field, value) {
  const el = summaryEl.querySelector(`[data-${field}]`);
  if (el) el.textContent = value;
}

/**
 * Rota mesafesine göre yaklaşık yakıt maliyetini hesaplayıp rota özeti
 * kartındaki "Tahmini Yakıt" alanına yazar - hesaplama bittiğinde doldurulur
 * (rota anında görünsün, maliyet hesaplaması ağ isteği gerektirdiği için
 * biraz gecikebilir).
 * @param {HTMLElement|null} statusEl
 * @param {import('../core/gps-tracker.js').LivePosition} current
 * @param {number} distanceKm
 */
async function appendRouteFuelCost(statusEl, current, distanceKm) {
  const summaryEl = statusEl?.parentElement?.querySelector('[data-route-summary]');

  try {
    const location = await reverseGeocodeIlIlce(current.latitude, current.longitude);
    if (!location) {
      if (summaryEl) setField(summaryEl, 'route-fuel', 'bilinmiyor');
      return;
    }

    const prices = await getFuelPrices(location.il, location.ilce, current.longitude);
    const withPrice = prices.find((p) => p.benzin !== null);
    if (!withPrice) {
      if (summaryEl) setField(summaryEl, 'route-fuel', 'bilinmiyor');
      return;
    }

    const litersPer100Km = await estimateAverageConsumption();
    const { liters, cost } = estimateFuelCost(distanceKm, litersPer100Km, withPrice.benzin);

    if (summaryEl) setField(summaryEl, 'route-fuel', `~${liters.toFixed(1)} L (~${cost.toFixed(0)} ₺)`);
  } catch (error) {
    logWarn('navigation-route-panel', 'Rota yakıt maliyeti hesaplanamadı', error);
    if (summaryEl) setField(summaryEl, 'route-fuel', 'hesaplanamadı');
  }
}
