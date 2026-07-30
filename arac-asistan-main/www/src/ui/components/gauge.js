/**
 * gauge.js
 * ---------------------------------------------------------------------------
 * Panel widget'larının TEMEL görsel bileşeni: `<sda-gauge>`.
 *
 * DÖRT farklı gösterge tipi destekler ("style" özniteliği) - Torque benzeri
 * OBD uygulamalarındaki "Gösterge tipi seçiniz" seçeneklerine karşılık gelir:
 *   - "arc"    (varsayılan) - imza yay (arc) tasarımı, ilk sürümden beri var
 *   - "needle" - ibreli analog kadran (tik işaretleri + dönen ibre)
 *   - "digital" - büyük sayı, sade dijital gösterge
 *   - "bar"    - yatay dolgu çubuğu
 *
 * Hangi widget'ın hangi stille gösterileceği kullanıcı tercihidir (bkz.
 * core/dashboard-config-store.js'teki `gaugeStyle` alanı) - bu bileşen
 * yalnızca kendisine SÖYLENEN stili çizer, seçim mantığı içermez (Single
 * Responsibility). Hem büyük ana göstergede (size="lg") hem küçük kartlarda
 * (size="sm") aynı bileşen kullanılır.
 *
 * Bağımsız, çerçevesiz (framework-free) bir Web Component olarak yazıldı;
 * herhangi bir view dosyası <sda-gauge> etiketiyle kullanabilir.
 * ---------------------------------------------------------------------------
 */

/** @type {number} Yay/kadran stillerinin kapladığı toplam açı (derece). Üstte 90° boşluk bırakır. */
const ARC_DEGREES = 270;

/** @type {number} Yayın/kadranın başlangıç açısı (derece, 0 = saat 3 yönü, saat yönünde artar). */
const ARC_START_DEGREE = 135;

/** @type {number} "needle" stilinde çizilecek tik işareti sayısı (0 ve max dahil). */
const NEEDLE_TICK_COUNT = 9;

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
 *   variant - "arc" | "needle" | "digital" | "bar", varsayılan "arc"
 *     (İSİM NOTU: "style" DEĞİL "variant" kullanılır - "style" adı, HTML'in
 *     yerleşik satır-içi CSS `style` özniteliğiyle çakışır.)
 *   danger-above - bu değerin üzerinde vurgu tehlike rengine döner (opsiyonel)
 *   color-hue - 0-360, bu widget'a özel vurgu rengi (opsiyonel; verilmezse
 *     temanın genel --sda-accent'i kullanılır - "her widget'ın rengi ayrı
 *     ayrı özelleştirilebilmeli" gereksinimi için)
 */
export class SdaGauge extends HTMLElement {
  static get observedAttributes() {
    return ['value', 'min', 'max', 'label', 'unit', 'size', 'variant', 'danger-above', 'color-hue'];
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
    const gaugeStyle = this.getAttribute('variant') ?? 'arc';
    const dangerAbove = this.getAttribute('danger-above');
    const colorHue = this.getAttribute('color-hue');

    const clamped = Math.max(min, Math.min(max, value));
    const fraction = max > min ? (clamped - min) / (max - min) : 0;
    const isDanger = dangerAbove !== null && value > Number(dangerAbove);
    // Widget'a özel renk verildiyse temanın genel --sda-accent yerine bu
    // ton kullanılır (temayla aynı doygunluk/parlaklık formülüyle).
    const accentColor = colorHue !== null
      ? `hsl(${Number(colorHue)} 90% 60%)`
      : 'var(--sda-accent, #FF8A3D)';
    const finalColor = isDanger ? 'var(--sda-danger, #FF5A5F)' : accentColor;
    const displayValue = Number.isFinite(clamped) ? Math.round(clamped) : '--';

    const bodyHtml = {
      arc: () => this.renderArcBody(computeCircleGeometry(size), fraction, finalColor, size, displayValue, unit),
      needle: () => this.renderNeedleBody(computeCircleGeometry(size), fraction, finalColor, size, displayValue, unit),
      bar: () => this.renderBarBody(fraction, finalColor, size, displayValue, unit),
      digital: () => this.renderDigitalBody(finalColor, size, displayValue, unit),
    }[gaugeStyle]?.() ?? this.renderArcBody(computeCircleGeometry(size), fraction, finalColor, size, displayValue, unit);

    this.shadowRoot.innerHTML = `
      <style>${this.commonStyles()}</style>
      ${bodyHtml}
      ${label ? `<span class="label">${label}</span>` : ''}
    `;
  }

  /**
   * Tüm stillerde ortak kabuk (etiket tipografisi, host yerleşimi vb).
   * @returns {string}
   */
  commonStyles() {
    return `
      :host {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        font-family: var(--sda-font-body, sans-serif);
      }
      .wrap { position: relative; }
      svg { display: block; }
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
    `;
  }

  /**
   * "arc" stili: imza yay tasarımı (ilk sürümden beri değişmedi).
   * @param {{cx:number, cy:number, radius:number, box:number}} geo
   * @param {number} fraction
   * @param {string} color
   * @param {string} size
   * @param {number|string} displayValue
   * @param {string} unit
   * @returns {string}
   */
  renderArcBody(geo, fraction, color, size, displayValue, unit) {
    const trackPath = buildArcPath(geo.cx, geo.cy, geo.radius, 1);
    const valuePath = buildArcPath(geo.cx, geo.cy, geo.radius, fraction);
    const px = size === 'lg' ? 260 : 108;

    return `
      <div class="wrap">
        <svg viewBox="0 0 ${geo.box} ${geo.box}" width="${px}" height="${px}">
          <path d="${trackPath}" fill="none" stroke="var(--sda-arc-track, #333)" stroke-width="8" stroke-linecap="round" />
          <path d="${valuePath}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" />
        </svg>
        <div class="readout">
          <span class="val">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  /**
   * "needle" stili: tik işaretli analog kadran + dönen ibre + altında küçük
   * sayısal okuma - klasik gösterge paneli ibresi görünümü.
   * @param {{cx:number, cy:number, radius:number, box:number}} geo
   * @param {number} fraction
   * @param {string} color
   * @param {string} size
   * @param {number|string} displayValue
   * @param {string} unit
   * @returns {string}
   */
  renderNeedleBody(geo, fraction, color, size, displayValue, unit) {
    const trackPath = buildArcPath(geo.cx, geo.cy, geo.radius, 1);
    const px = size === 'lg' ? 260 : 108;

    const ticks = Array.from({ length: NEEDLE_TICK_COUNT }, (_, i) => {
      const tickFraction = i / (NEEDLE_TICK_COUNT - 1);
      const angle = ARC_START_DEGREE + ARC_DEGREES * tickFraction;
      const outer = pointOnCircle(geo.cx, geo.cy, geo.radius + 2, angle);
      const inner = pointOnCircle(geo.cx, geo.cy, geo.radius - 8, angle);
      return `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke="var(--sda-text-faint, #5A6270)" stroke-width="2" />`;
    }).join('');

    const needleAngle = ARC_START_DEGREE + ARC_DEGREES * Math.max(0, Math.min(1, fraction));
    const needleTip = pointOnCircle(geo.cx, geo.cy, geo.radius - 14, needleAngle);
    const needleTail = pointOnCircle(geo.cx, geo.cy, geo.radius * 0.25, needleAngle + 180);

    return `
      <div class="wrap">
        <svg viewBox="0 0 ${geo.box} ${geo.box}" width="${px}" height="${px}">
          <path d="${trackPath}" fill="none" stroke="var(--sda-arc-track, #333)" stroke-width="3" />
          ${ticks}
          <line x1="${needleTail.x}" y1="${needleTail.y}" x2="${needleTip.x}" y2="${needleTip.y}"
                stroke="${color}" stroke-width="3" stroke-linecap="round" />
          <circle cx="${geo.cx}" cy="${geo.cy}" r="5" fill="${color}" />
        </svg>
        <div class="readout" style="top:auto; bottom:${size === 'lg' ? '18%' : '14%'}; inset:auto 0 ${size === 'lg' ? '18%' : '14%'} 0; height:auto;">
          <span class="val" style="font-size:${size === 'lg' ? '1.6rem' : '0.95rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  /**
   * "bar" stili: yatay dolgu çubuğu, üzerinde sayısal okuma.
   * @param {number} fraction
   * @param {string} color
   * @param {string} size
   * @param {number|string} displayValue
   * @param {string} unit
   * @returns {string}
   */
  renderBarBody(fraction, color, size, displayValue, unit) {
    const width = size === 'lg' ? 260 : 140;
    const height = size === 'lg' ? 34 : 22;
    const fillWidth = Math.max(0, Math.min(1, fraction)) * width;

    return `
      <div class="wrap" style="width:${width}px;">
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--sda-arc-track, #333)" />
          <rect x="0" y="0" width="${fillWidth}" height="${height}" rx="${height / 2}" fill="${color}" />
        </svg>
        <div style="display:flex; align-items:baseline; justify-content:center; gap:4px; margin-top:4px;">
          <span class="val" style="font-size:${size === 'lg' ? '1.8rem' : '1rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  /**
   * "digital" stili: yalnızca büyük sayı - sade dijital gösterge kartı.
   * @param {string} color
   * @param {string} size
   * @param {number|string} displayValue
   * @param {string} unit
   * @returns {string}
   */
  renderDigitalBody(color, size, displayValue, unit) {
    const width = size === 'lg' ? 220 : 120;

    return `
      <div class="wrap" style="
        width:${width}px; padding:${size === 'lg' ? '20px 8px' : '10px 6px'};
        background:var(--sda-bg-elevated, #242933); border-radius:var(--sda-radius-sm, 10px);
        border:1px solid ${color}; text-align:center;
      ">
        <span class="val" style="color:${color}; font-size:${size === 'lg' ? 'var(--sda-fs-gauge-xl, 4rem)' : '1.7rem'}; display:block;">${displayValue}</span>
        <span class="unit">${unit}</span>
      </div>
    `;
  }
}

/**
 * "arc"/"needle" stilleri için ortak SVG geometrisini hesaplar.
 * @param {string} size
 * @returns {{cx:number, cy:number, radius:number, box:number}}
 */
function computeCircleGeometry(size) {
  const box = 120;
  const cx = box / 2;
  const cy = box / 2;
  const radius = box / 2 - 12;
  return { cx, cy, radius, box };
}

customElements.define('sda-gauge', SdaGauge);
