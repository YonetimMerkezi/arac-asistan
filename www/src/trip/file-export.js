/**
 * file-export.js
 * ---------------------------------------------------------------------------
 * Bir Blob'u (PDF/Excel raporu) cihaza kaydeder ve native paylaşım sayfasını
 * açar. trip-report-pdf.js ve trip-report-excel.js dosya sistemine hiç
 * dokunmaz - bu tek görev burada toplanmıştır (kod tekrarını önler).
 * ---------------------------------------------------------------------------
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { logError, logInfo } from '../core/logger.js';

/**
 * Bir Blob'u Base64'e çevirir (Filesystem.writeFile Base64 bekler).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = /** @type {string} */ (reader.result);
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Verilen Blob'u belirtilen dosya adıyla kaydeder ve paylaşım sayfasını açar.
 * @param {Blob} blob
 * @param {string} fileName - Uzantı dahil, ör. "yolculuk-42.pdf".
 * @returns {Promise<boolean>} Başarılı olup olmadığı.
 */
export async function saveAndShareReport(blob, fileName) {
  try {
    const base64Data = await blobToBase64(blob);

    const writeResult = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
    });

    await Share.share({
      title: fileName,
      url: writeResult.uri,
    });

    logInfo('file-export', `Rapor kaydedildi ve paylaşıldı: ${fileName}`);
    return true;
  } catch (error) {
    logError('file-export', `Rapor kaydedilemedi: ${fileName}`, error);
    return false;
  }
}
