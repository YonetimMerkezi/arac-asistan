/**
 * view-router.js
 * ---------------------------------------------------------------------------
 * Uygulama içi basit görünüm (view) yönlendiricisi.
 *
 * Bu proje bir SPA çatısı (React/Vue vb.) kullanmıyor; ekranlar arasında
 * `.sda-view` elemanlarının `hidden` özelliğini değiştirerek geçiş yapan
 * hafif bir yönlendirici yeterlidir. Her yeni modül (Faz 2+) kendi
 * `data-view="..."` bölümünü ve alt gezinme düğmesini ekleyerek bu
 * yönlendiriciye kayıt olur; view-router.js'in kendisi değişmez.
 * ---------------------------------------------------------------------------
 */

import { logInfo, logWarn } from './logger.js';
import { attachPullToRefresh } from '../ui/components/pull-to-refresh.js';
import { getRefreshHandler } from './refresh-registry.js';

/** @type {string} Alt gezinme düğmelerinde kullanılan veri özniteliği. */
const NAV_BUTTON_SELECTOR = '[data-nav-target]';

/** @type {string} Görünüm konteynerlerinde kullanılan veri özniteliği. */
const VIEW_SELECTOR = '[data-view]';

/** @type {Set<(viewName: string) => void>} */
const listeners = new Set();

/** @type {string|null} */
let activeView = null;

/**
 * Yönlendiriciyi başlatır: mevcut nav düğmelerine tıklama dinleyicisi ekler.
 * @param {string} initialView - Açılışta gösterilecek görünümün adı.
 */
export function initViewRouter(initialView) {
  const navButtons = document.querySelectorAll(NAV_BUTTON_SELECTOR);

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-nav-target');
      if (target) {
        navigateTo(target);
      }
    });
  });

  // Her ekrana "kaydırarak yenile" jesti eklenir. Handler'ı ŞİMDİ değil,
  // TETİKLENDİĞİ ANDA arar (getRefreshHandler çağrısı callback İÇİNDE) -
  // çünkü ekranların kendi init fonksiyonları (ör. initDashboardView())
  // henüz çalışmamış olabilir, bu yüzden henüz handler kayıtlı olmayabilir.
  document.querySelectorAll(VIEW_SELECTOR).forEach((view) => {
    const viewName = view.getAttribute('data-view');
    if (!viewName) return;
    attachPullToRefresh(view, () => getRefreshHandler(viewName)());
  });

  navigateTo(initialView);
}

/**
 * Belirtilen görünüme geçer; ilgili nav düğmesini `aria-current` ile işaretler.
 * @param {string} viewName
 */
export function navigateTo(viewName) {
  const target = document.querySelector(`${VIEW_SELECTOR}[data-view="${viewName}"]`);

  if (!target) {
    logWarn('view-router', `Görünüm bulunamadı: ${viewName}`);
    return;
  }

  document.querySelectorAll(VIEW_SELECTOR).forEach((view) => {
    view.hidden = view !== target;
  });

  document.querySelectorAll(NAV_BUTTON_SELECTOR).forEach((button) => {
    const isActive = button.getAttribute('data-nav-target') === viewName;
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  activeView = viewName;
  logInfo('view-router', `Görünüm değişti: ${viewName}`);

  for (const listener of listeners) {
    listener(viewName);
  }
}

/**
 * Şu anda aktif olan görünümün adını döndürür.
 * @returns {string|null}
 */
export function getActiveView() {
  return activeView;
}

/**
 * Görünüm değişikliklerine abone olur.
 * @param {(viewName: string) => void} callback
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export function onViewChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
