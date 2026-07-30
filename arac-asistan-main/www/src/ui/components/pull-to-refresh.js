/**
 * pull-to-refresh.js
 * ---------------------------------------------------------------------------
 * Genel, bağımsız (framework-free) "kaydırarak yenile" jesti.
 *
 * Yalnızca kaydırılabilir konteyner EN ÜSTTEYKEN (scrollTop === 0) aşağı
 * çekme hareketini yakalar - aksi halde normal kaydırmayla (scroll)
 * çakışırdı. Görsel geri bildirim olarak basit bir dönen ok/spinner
 * göstergesi kullanılır; eşik (THRESHOLD_PX) aşılıp bırakılınca verilen
 * `onRefresh` callback'i çağrılır.
 * ---------------------------------------------------------------------------
 */

import { iconMarkup } from '../icons.js';

/** @type {number} Bu kadar (piksel) aşağı çekilince bırakınca yenileme tetiklenir. */
const THRESHOLD_PX = 70;

/** @type {number} Göstergenin görünür olacağı azami çekme mesafesi (piksel) - bunun ötesi dirençli hissettirir. */
const MAX_PULL_PX = 110;

/**
 * Bir konteynere kaydırarak-yenile jesti ekler.
 * @param {HTMLElement} container - Kaydırılabilir (overflow-y) eleman.
 * @param {() => Promise<void>|void} onRefresh - Eşik aşılıp bırakılınca çağrılır.
 * @returns {() => void} Jesti kaldıran (dinleyicileri temizleyen) fonksiyon.
 */
export function attachPullToRefresh(container, onRefresh) {
  const indicator = document.createElement('div');
  indicator.setAttribute('data-pull-indicator', '');
  indicator.style.cssText = `
    position:absolute; top:0; left:50%; transform:translate(-50%, -100%);
    width:32px; height:32px; border-radius:50%;
    background:var(--sda-bg-elevated); display:flex; align-items:center; justify-content:center;
    box-shadow:var(--sda-shadow-elevated); transition:opacity 150ms ease;
    z-index:10; pointer-events:none;
  `;
  indicator.innerHTML = iconMarkup('refresh', { size: 18, extraClass: 'sda-pull-indicator-icon' });

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.prepend(indicator);

  let startY = 0;
  let pulling = false;
  let refreshing = false;

  const onTouchStart = (event) => {
    if (container.scrollTop > 0 || refreshing) return;
    startY = event.touches[0].clientY;
    pulling = true;
  };

  const onTouchMove = (event) => {
    if (!pulling || refreshing) return;
    const deltaY = event.touches[0].clientY - startY;
    if (deltaY <= 0) {
      resetIndicator();
      return;
    }

    const pullDistance = Math.min(deltaY * 0.5, MAX_PULL_PX); // dirençli his için yarı oranda takip eder.
    indicator.style.opacity = String(Math.min(pullDistance / THRESHOLD_PX, 1));
    indicator.style.transform = `translate(-50%, ${pullDistance - 32}px) rotate(${pullDistance * 3}deg)`;
  };

  const onTouchEnd = async () => {
    if (!pulling || refreshing) return;
    pulling = false;

    const opacity = Number(indicator.style.opacity || 0);
    if (opacity >= 1) {
      refreshing = true;
      indicator.style.transform = 'translate(-50%, 38px)';
      indicator.querySelector('span').style.animation = 'sda-spin 700ms linear infinite';

      try {
        await onRefresh();
      } finally {
        refreshing = false;
        resetIndicator();
      }
    } else {
      resetIndicator();
    }
  };

  function resetIndicator() {
    indicator.style.opacity = '0';
    indicator.style.transform = 'translate(-50%, -100%)';
    const spinnerSpan = indicator.querySelector('span');
    if (spinnerSpan) spinnerSpan.style.animation = '';
  }

  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: true });
  container.addEventListener('touchend', onTouchEnd, { passive: true });

  return () => {
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    indicator.remove();
  };
}
