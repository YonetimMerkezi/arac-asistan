/**
 * back-button.js
 * ---------------------------------------------------------------------------
 * Android'in fiziksel/gezinme "geri" tuşu için UYGULAMA GENELİNDE tutarlı
 * bir davranış zinciri kurar.
 *
 * ÖNCEKİ DURUM: Hiçbir geri tuşu dinleyicisi yoktu - Capacitor'ın
 * varsayılan davranışı (kayıtlı dinleyici yoksa) uygulanıyordu, bu da
 * genelde "neredeysen oradan direkt uygulamadan çık" gibi tutarsız bir
 * deneyime yol açıyordu (ör. tam ekran haritadayken geri tuşu tam ekrandan
 * çıkarmıyor, direkt uygulamayı kapatıyordu).
 *
 * ÖNCELİK SIRASI (üstteki önce denenir):
 *  1. Açık bir modal/alt-sayfa varsa -> onu kapat.
 *  2. Navigasyon tam ekran modundaysa -> tam ekrandan çık.
 *  3. Ana ekranda (Panel) değilsek -> Panel'e dön.
 *  4. Zaten Panel'deyiz, başka açık bir şey yok -> uygulamadan çık
 *     (Android'in dinleyici hiç kayıtlı olmasaydı yapacağı varsayılan
 *     davranışın AYNISI - sürpriz yaratmaz).
 * ---------------------------------------------------------------------------
 */

import { App } from '@capacitor/app';
import { isModalOpen, closeModal } from '../ui/components/modal.js';
import { isNavFullscreen, setNavFullscreen } from './nav-fullscreen-state.js';
import { getActiveView, navigateTo } from './view-router.js';
import { logInfo } from './logger.js';

/** @type {string} Geri tuşu zincirinin "ana ekran" saydığı görünüm. */
const HOME_VIEW = 'dashboard';

/**
 * Geri tuşu dinleyicisini kaydeder. Uygulama açılışında bir kez çağrılmalıdır.
 */
export function initBackButtonHandler() {
  App.addListener('backButton', () => {
    if (isModalOpen()) {
      logInfo('back-button', 'Açık modal kapatılıyor');
      closeModal();
      return;
    }

    if (isNavFullscreen()) {
      logInfo('back-button', 'Tam ekran navigasyondan çıkılıyor');
      setNavFullscreen(false);
      return;
    }

    if (getActiveView() !== HOME_VIEW) {
      logInfo('back-button', `${HOME_VIEW} ekranına dönülüyor`);
      navigateTo(HOME_VIEW);
      return;
    }

    logInfo('back-button', 'Ana ekrandayız, başka açık bir şey yok - uygulamadan çıkılıyor');
    App.exitApp();
  });
}
