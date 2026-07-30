/**
 * settings-backup-panel.js
 * ---------------------------------------------------------------------------
 * Ayarlar ekranındaki "Tüm Verileri Yedekle / Geri Yükle" bölümü.
 * ---------------------------------------------------------------------------
 */

import { exportAllData, importAllData } from '../data/backup-service.js';
import { logError } from '../core/logger.js';

/**
 * @param {HTMLElement} container
 */
export function bindBackupPanel(container) {
  const exportButton = container.querySelector('[data-backup-export]');
  const importButton = container.querySelector('[data-backup-import]');
  const fileInput = container.querySelector('[data-backup-file-input]');
  const statusEl = container.querySelector('[data-backup-status]');

  exportButton?.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Yedek hazırlanıyor...';
    try {
      const fileName = await exportAllData();
      if (statusEl) statusEl.textContent = `Yedek hazır: ${fileName}`;
    } catch (error) {
      logError('settings-backup-panel', 'Yedekleme başarısız', error);
      if (statusEl) statusEl.textContent = 'Yedekleme başarısız oldu.';
    }
  });

  importButton?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const confirmed = confirm('Bu, mevcut TÜM verilerinizin (yolculuklar, yakıt kayıtları, ayarlar) üzerine yazacak. Devam edilsin mi?');
    if (!confirmed) {
      fileInput.value = '';
      return;
    }

    if (statusEl) statusEl.textContent = 'Geri yükleniyor...';
    try {
      const text = await file.text();
      await importAllData(text);
      if (statusEl) statusEl.textContent = 'Geri yükleme tamamlandı. Uygulamayı yeniden başlatın.';
    } catch (error) {
      logError('settings-backup-panel', 'Geri yükleme başarısız', error);
      if (statusEl) statusEl.textContent = 'Geri yükleme başarısız oldu - dosya bozuk olabilir.';
    } finally {
      fileInput.value = '';
    }
  });
}
