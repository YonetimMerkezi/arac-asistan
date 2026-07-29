/**
 * modal.js
 * ---------------------------------------------------------------------------
 * Hafif, bağımsız (framework-free) modal/alt-sayfa (bottom sheet) yardımcısı.
 *
 * Şu ana kadar uygulamada tekil bir modal deseni yoktu - her ekran kendi
 * geçici çözümünü yazmak zorunda kalırdı. Bu dosya TEK ortak katman olur:
 * harita istasyon modalı, gösterge tipi seçici gibi tüm "üste açılan panel"
 * ihtiyaçları bunu kullanır (Open/Closed - yeni bir modal ihtiyacı bu
 * dosyayı değiştirmez, yalnızca openModal() çağırır).
 * ---------------------------------------------------------------------------
 */

/** @type {HTMLElement|null} Şu an açık olan modal köküdür (aynı anda tek modal). */
let activeOverlay = null;

/** @type {HTMLElement|null} Açık modalın gövde (sheet) elemanı - kapanış olayını burada yayınlarız. */
let activeSheet = null;

/**
 * Bir modal/alt-sayfa açar. Halihazırda açık bir modal varsa önce onu kapatır.
 * @param {Object} options
 * @param {string} options.title - Üstte gösterilecek başlık.
 * @param {string} options.bodyHtml - İçerik HTML'i (innerHTML olarak yazılır).
 * @param {(body: HTMLElement, helpers: {root: HTMLElement, close: () => void}) => void} [options.onMount] -
 *   İçerik DOM'a eklendikten hemen sonra ÇAĞRILDIĞI SIRADA (openModal() henüz
 *   DÖNMEDEN, senkron olarak) çalışır. Bu YÜZDEN modal kökü/kapama fonksiyonu
 *   `helpers` parametresiyle DOĞRUDAN verilir - `const { root } = openModal(...)`
 *   şeklinde DIŞARIDAKİ dönüş değerini onMount İÇİNDE kullanmaya ÇALIŞMAK
 *   "Cannot access ... before initialization" hatasına yol açar (const/let
 *   henüz atanmadan aynı senkron çağrı içinde okunmuş olur - bkz. bu dosyanın
 *   düzeltme geçmişi, diagnostics-log-view.js'te tam olarak bu hataya
 *   düşülmüştü).
 * @returns {{close: () => void, root: HTMLElement}}
 */
export function openModal({ title, bodyHtml, onMount }) {
  closeModal();

  const overlay = document.createElement('div');
  overlay.setAttribute('data-sda-modal-overlay', '');
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9997;
    background:rgba(0,0,0,0.55);
    display:flex; align-items:flex-end; justify-content:center;
  `;

  const sheet = document.createElement('div');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.style.cssText = `
    width:100%; max-width:520px; max-height:82vh; overflow-y:auto;
    background:var(--sda-bg-surface); border-radius:var(--sda-radius-lg) var(--sda-radius-lg) 0 0;
    padding:var(--sda-space-4); padding-bottom:calc(var(--sda-space-6) + env(safe-area-inset-bottom, 0px));
    box-shadow:var(--sda-shadow-elevated);
  `;

  sheet.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--sda-space-3);">
      <h3 style="margin:0; font-size:1rem; color:var(--sda-text-primary);">${title}</h3>
      <button type="button" data-modal-close class="sda-btn sda-btn--ghost" aria-label="Kapat" style="padding:4px 8px; font-size:1.1rem;">✕</button>
    </div>
    <div data-modal-body>${bodyHtml}</div>
  `;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  activeSheet = sheet;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  sheet.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);

  const bodyRoot = sheet.querySelector('[data-modal-body]');
  // NOT: onMount, openModal DÖNMEDEN önce (senkron) çağrılır - bu yüzden
  // root/close burada AÇIKÇA parametre olarak verilir, aşağıdaki `return`
  // değerine güvenilmez (bkz. yukarıdaki JSDoc uyarısı).
  if (onMount && bodyRoot) onMount(bodyRoot, { root: sheet, close: closeModal });

  return { close: closeModal, root: sheet };
}

/**
 * Açık modalı (varsa) kapatır. Zaten kapalıysa sessizce hiçbir şey yapmaz.
 * Kapanmadan hemen önce gövde (sheet) elemanında `sda-modal-closed` özel
 * olayını yayınlar - modal içeriği bir abonelik (ör. canlı günlük akışı)
 * başlattıysa bu olayı dinleyip temizlik yapabilir (bellek sızıntısı önleme).
 */
export function closeModal() {
  if (activeSheet) {
    activeSheet.dispatchEvent(new CustomEvent('sda-modal-closed'));
  }
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
    activeSheet = null;
  }
}
