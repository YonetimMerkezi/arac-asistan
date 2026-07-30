/**
 * trip-report-excel.js
 * ---------------------------------------------------------------------------
 * Tek bir yolculuğun Excel raporunu üretir (SheetJS/xlsx).
 *
 * İki sayfa üretir: "Özet" (yolculuk istatistikleri) ve "GPS İzi"
 * (her nokta). trip-report-pdf.js gibi yalnızca üretimle ilgilenir,
 * dosya kaydetme çağıran tarafa bırakılır.
 * ---------------------------------------------------------------------------
 */

import * as XLSX from 'xlsx';

/**
 * Bir yolculuk için Excel raporu oluşturur.
 * @param {import('../data/trip-repository.js').Trip} trip
 * @param {import('../data/trip-repository.js').TripPoint[]} points
 * @returns {Blob}
 */
export function generateTripExcelReport(trip, points) {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Alan', 'Değer'],
    ['Başlangıç', formatDate(trip.start_time)],
    ['Bitiş', trip.end_time ? formatDate(trip.end_time) : 'Devam ediyor'],
    ['Süre (saniye)', trip.duration_s],
    ['Mesafe (km)', trip.distance_km],
    ['Ortalama Hız (km/h)', trip.avg_speed_kmh],
    ['Maksimum Hız (km/h)', trip.max_speed_kmh],
    ['Tahmini Yakıt Tüketimi (L)', trip.fuel_used_l],
    ['Yakıt Maliyeti (₺)', trip.fuel_cost ?? ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Özet');

  const pointsSheet = XLSX.utils.json_to_sheet(
    points.map((p) => ({
      Zaman: formatDate(p.recorded_at),
      Enlem: p.latitude,
      Boylam: p.longitude,
      'Hız (km/h)': p.speed_kmh ?? '',
    })),
  );
  XLSX.utils.book_append_sheet(workbook, pointsSheet, 'GPS İzi');

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * @param {number} unixMs
 * @returns {string}
 */
function formatDate(unixMs) {
  return new Date(unixMs).toLocaleString('tr-TR');
}
