/**
 * trip-report-pdf.js
 * ---------------------------------------------------------------------------
 * Tek bir yolculuğun PDF raporunu üretir (jsPDF + jspdf-autotable).
 *
 * Yalnızca RAPOR ÜRETİMİ ile ilgilenir; veri çekme trip-repository.js'in,
 * dosyayı kaydetme/paylaşma ise çağıran UI kodunun sorumluluğundadır
 * (bu dosya bir Blob/ArrayBuffer döndürür, dosya sistemine dokunmaz).
 * ---------------------------------------------------------------------------
 */

import { jsPDF } from 'jspdf';
// KRİTİK DÜZELTME: `import autoTable from 'jspdf-autotable'` (varsayılan
// import) + `autoTable(doc, {...})` (fonksiyonel API) esbuild ile paketlenince
// "TypeError: ...default is not a function" ile çöküyordu - bu paketin CJS
// dışa aktarımı ile esbuild'in ESM yorumlaması arasında bilinen bir uyumsuzluk.
// Bunun yerine YAN ETKİLİ import (jsPDF.prototype'ı YAMALAR) + `doc.autoTable(...)`
// metod çağrısı kullanılıyor - bu desen dışa aktarım şekline bağlı olmadığı
// için bundler farklılıklarına karşı çok daha dayanıklı.
import 'jspdf-autotable';

/**
 * Bir yolculuk için PDF raporu oluşturur.
 * @param {import('../data/trip-repository.js').Trip} trip
 * @returns {Blob} PDF dosyası (Blob olarak; kaydetme işini çağıran taraf yapar).
 */
export function generateTripPdfReport(trip) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('Smart Drive AI - Yolculuk Raporu', 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Oluşturulma: ${new Date().toLocaleString('tr-TR')}`, 14, 25);

  doc.autoTable({
    startY: 32,
    head: [['Alan', 'Değer']],
    body: [
      ['Başlangıç', formatDate(trip.start_time)],
      ['Bitiş', trip.end_time ? formatDate(trip.end_time) : 'Devam ediyor'],
      ['Süre', formatDuration(trip.duration_s)],
      ['Mesafe', `${trip.distance_km.toFixed(2)} km`],
      ['Ortalama Hız', `${trip.avg_speed_kmh.toFixed(1)} km/h`],
      ['Maksimum Hız', `${trip.max_speed_kmh.toFixed(1)} km/h`],
      ['Tahmini Yakıt Tüketimi', `${trip.fuel_used_l.toFixed(2)} litre`],
      ['Yakıt Maliyeti', trip.fuel_cost ? `${trip.fuel_cost.toFixed(2)} ₺` : 'Girilmedi'],
    ],
    theme: 'striped',
    headStyles: { fillColor: [255, 138, 61] },
  });

  return doc.output('blob');
}

/**
 * @param {number} unixMs
 * @returns {string}
 */
function formatDate(unixMs) {
  return new Date(unixMs).toLocaleString('tr-TR');
}

/**
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours} sa ${minutes} dk`;
}
