/**
 * dtc-report-pdf.js
 * ---------------------------------------------------------------------------
 * Bir arıza kodu okumasının PDF raporunu üretir. trip-report-pdf.js ile
 * aynı desen (jsPDF + autotable, dosya sistemine dokunmaz).
 * ---------------------------------------------------------------------------
 */

import { jsPDF } from 'jspdf';
// bkz. trip/trip-report-pdf.js'teki aynı düzeltmenin notu.
import 'jspdf-autotable';
import { getDtcDescription } from './dtc-descriptions.js';

/**
 * @param {string[]} codes
 * @param {number} readAt - Unix ms.
 * @returns {Blob}
 */
export function generateDtcPdfReport(codes, readAt) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('Smart Drive AI - Arıza Kodu Raporu', 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Okuma zamanı: ${new Date(readAt).toLocaleString('tr-TR')}`, 14, 25);

  if (codes.length === 0) {
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Bu okumada arıza kodu bulunmadı.', 14, 38);
    return doc.output('blob');
  }

  doc.autoTable({
    startY: 32,
    head: [['Kod', 'Başlık', 'Açıklama', 'Kontrol Önerisi']],
    body: codes.map((code) => {
      const desc = getDtcDescription(code);
      return [code, desc.title, desc.detail, desc.checkSuggestion];
    }),
    theme: 'striped',
    headStyles: { fillColor: [255, 90, 95] },
    styles: { fontSize: 9 },
  });

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'Not: Onarım maliyeti tahmini içermez - maliyet araca ve bölgeye göre değişir.',
    14,
    doc.lastAutoTable.finalY + 8,
  );

  return doc.output('blob');
}
