/**
 * gauge.js
 * ---------------------------------------------------------------------------
 * İmza tasarım öğesi: yay (arc) biçimli gösterge.
 *
 * theme.css'te tanımlanan --sda-arc-track ve accent renklerini kullanarak,
 * 0-270 derecelik bir SVG yayı üzerinde değeri gösterir. Hem büyük ana
 * göstergede (hız) hem küçük kartlarda (yakıt, sıcaklık, voltaj) AYNI
 * bileşen tekrar kullanılır - bu tekrar, tasarımın imzasıdır.
 *
 * Bağımsız, çerçevesiz (framework-free) bir Web Component olarak yazıldı;
 * herhangi bir view dosyası <sda-gauge> etiketiyle kullanabilir.
 * ---------------------------------------------------------------------------
 */

/** @type {number} Yayın kapladığı toplam açı (derece). Üstte 90° boşluk bırakır. */
const ARC_DEGREES = 270;

/** @type {number} Yayın başlangıç açısı (derece, 0 = saat 3 yönü, saat yönünde artar). */
const ARC_START_DEGREE = 135;

/**
 * Bir SVG dairesi üzerinde, verilen açıdaki (derece) noktayı hesaplar.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} angleDeg
 * @returns {{x: number, y: number}}
 */
function pointOnCircle(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

/**
 * SVG `<path>` için yay (arc) tanımı üretir.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} fraction - 0..1 arası, yayın ne kadarının çizileceği.
 * @returns {string} SVG path `d` özniteliği.
 */
function buildArcPath(cx, cy, radius, fraction) {
  const sweep = ARC_DEGREES * Math.max(0, Math.min(1, fraction));
  const start = pointOnCircle(cx, cy, radius, ARC_START_DEGREE);
  const end = pointOnCircle(cx, cy, radius, ARC_START_DEGREE + sweep);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

/**
 * `<sda-gauge>` Web Component'i.
 *
 * Öznitelikler:
 *   value  - güncel değer (sayı)
 *   min    - minimum değer (varsayılan 0)
 *   max    - maksimum değer (varsayılan 100)
 *   label  - etiket metni (ör. "Hız")
 *   unit   - birim metni (ör. "km/h")
 *   size   - "lg" (ana gösterge) veya "sm" (kart içi), varsayılan "sm"
 *   danger-above - bu değerin üzerinde yay tehlike rengine döner (opsiyonel)
 */
export class SdaGauge extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'min', 'max', 'label', 'unit', 'size', 'danger-above'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    // Bileşen henüz DOM'a eklenmediyse (constructor sırasında öznitelik
    // set edilirse) render() henüz shadow root'a erişemez - koruma:
    if (this.isConnected) this.render();
  }

  /**
   * Bileşenin tamamını yeniden çizer. Sıklıkla (ör. saniyede birkaç kez
   * OBD verisiyle) çağrılacağı için render maliyeti kasıtlı olarak düşük
   * tutuldu: tek bir innerHTML ataması, ek DOM diff'i yok.
   */
  render() {
    const value = Number(this.getAttribute('value') ?? 0);
    const min = Number(this.getAttribute('min') ?? 0);
    const max = Number(this.getAttribute('max') ?? 100);
    const label = this.getAttribute('label') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const size = this.getAttribute('size') ?? 'sm';
    const dangerAbove = this.getAttribute('danger-above');

    const clamped = Math.max(min, Math.min(max, value));
    const fraction = max > min ? (clamped - min) / (max - min) : 0;
    const isDanger = dangerAbove !== null && value > Number(dangerAbove);

    const viewBoxSize = 120;
    const cx = viewBoxSize / 2;
    const cy = viewBoxSize / 2;
    const radius = viewBoxSize / 2 - 12;

    const trackPath = buildArcPath(cx, cy, radius, 1);
    const valuePath = buildArcPath(cx, cy, radius, fraction);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          font-family: var(--sda-font-body, sans-serif);
        }
        .wrap { position: relative; }
        svg { display: block; }
        .track { fill: none; stroke: var(--sda-arc-track, #333); stroke-width: 8; stroke-linecap: round; }
        .value { fill: none; stroke: var(--sda-accent, #FF8A3D); stroke-width: 8; stroke-linecap: round;
                 transition: d 160ms linear; }
        .value.danger { stroke: var(--sda-danger, #FF5A5F); }
        .readout {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; text-align: center;
        }
        .readout .val {
          font-family: var(--sda-font-display, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--sda-text-primary, #EDEFF2);
          line-height: 1;
        }
        .readout .unit { font-size: 0.65em; color: var(--sda-text-muted, #8B93A1); margin-top: 2px; }
        .label {
          margin-top: 4px; font-size: var(--sda-fs-label, 0.75rem);
          text-transform: uppercase; letter-spacing: var(--sda-letter-label, 0.08em);
          color: var(--sda-text-muted, #8B93A1);
        }
        :host([size="lg"]) .readout .val { font-size: var(--sda-fs-gauge-xl, 4rem); }
        :host([size="sm"]) .readout .val { font-size: var(--sda-fs-gauge-md, 1.6rem); }
      </style>
      <div class="wrap">
        <svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size === 'lg' ? 260 : 108}" height="${size === 'lg' ? 260 : 108}">
          <path class="track" d="${trackPath}" />
          <path class="value${isDanger ? ' danger' : ''}" d="${valuePath}" />
        </svg>
        <div class="readout">
          <span class="val">${Number.isFinite(clamped) ? Math.round(clamped) : '--'}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
      ${label ? `<span class="label">${label}</span>` : ''}
    `;
  }
}

customElements.define('sda-gauge', SdaGauge);
