/**
 * navigation-drive-visibility-fix.js
 * ---------------------------------------------------------------------------
 * navigation-drive view'ının kendi display:flex stilinin HTML hidden
 * özniteliğini ezmesini engeller.
 *
 * navigation-drive-view.js ekranı flex olarak tasarladığı için, hidden
 * attribute tek başına yeterli değildir. Bu küçük koruma yalnızca ilgili
 * view üzerinde çalışır; diğer ekranlara müdahale etmez.
 * ---------------------------------------------------------------------------
 */

function syncNavigationDriveVisibility() {
  const view = document.querySelector('[data-view="navigation-drive"]');
  if (!view) return;

  if (view.hidden) {
    view.style.setProperty('display', 'none', 'important');
  } else {
    view.style.removeProperty('display');
  }
}

function initNavigationDriveVisibilityFix() {
  syncNavigationDriveVisibility();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
        syncNavigationDriveVisibility();
        break;
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavigationDriveVisibilityFix, { once: true });
} else {
  initNavigationDriveVisibilityFix();
}
