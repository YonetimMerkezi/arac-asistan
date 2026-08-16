/**
 * gauge.js
 * ---------------------------------------------------------------------------
 * Panel widget'larının temel görsel bileşeni: <sda-gauge>.
 *
 * Desteklenen gösterge tipleri:
 *   - analog-classic : Klasik ibreli analog kadran
 *   - analog-modern  : Modern yaylı analog gösterge
 *   - digital-card   : Dijital kart
 *   - digital-modern : Neon / modern dijital gösterge
 *   - hybrid         : Analog + dijital hibrit gösterge
 *   - compact        : Kompakt yatay gösterge
 *
 * Eski kayıtlarla geriye dönük uyumluluk:
 *   arc     -> analog-modern
 *   needle  -> analog-classic
 *   digital -> digital-card
 *   bar     -> compact
 *
 * Bileşen framework-free Web Component olarak çalışır.
 * ---------------------------------------------------------------------------
 */

const ARC_DEGREES = 270;
const ARC_START_DEGREE = 135;
const NEEDLE_TICK_COUNT = 13;

const LEGACY_STYLE_MAP = Object.freeze({
  arc: 'analog-modern',
  needle: 'analog-classic',
  digital: 'digital-card',
  bar: 'compact',
});

const SUPPORTED_STYLES = Object.freeze([
  'analog-classic',
  'analog-modern',
  'digital-card',
  'digital-modern',
  'hybrid',
  'compact',
]);

function normalizeGaugeStyle(style) {
  if (SUPPORTED_STYLES.includes(style)) return style;
  return LEGACY_STYLE_MAP[style] ?? 'analog-modern';
}

function pointOnCircle(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

function buildArcPath(cx, cy, radius, fraction) {
  const sweep = ARC_DEGREES * Math.max(0, Math.min(1, fraction));
  const start = pointOnCircle(cx, cy, radius, ARC_START_DEGREE);
  const end = pointOnCircle(cx, cy, radius, ARC_START_DEGREE + sweep);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function computeCircleGeometry(size) {
  const box = 200;
  const cx = box / 2;
  const cy = box / 2;
  const radius = size === 'lg' ? 72 : 58;
  return { cx, cy, radius, box };
}

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
    if (this.isConnected) this.render();
  }

  render() {
    const value = Number(this.getAttribute('value') ?? 0);
    const min = Number(this.getAttribute('min') ?? 0);
    const max = Number(this.getAttribute('max') ?? 100);
    const label = this.getAttribute('label') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const size = this.getAttribute('size') ?? 'sm';
    const gaugeStyle = normalizeGaugeStyle(this.getAttribute('variant'));
    const dangerAbove = this.getAttribute('danger-above');
    const colorHue = this.getAttribute('color-hue');

    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 100;
    const safeValue = Number.isFinite(value) ? value : safeMin;
    const clamped = Math.max(safeMin, Math.min(safeMax, safeValue));
    const fraction = (clamped - safeMin) / (safeMax - safeMin);
    const isDanger = dangerAbove !== null && safeValue > Number(dangerAbove);

    const accentColor = colorHue !== null
      ? `hsl(${Number(colorHue)} 90% 60%)`
      : 'var(--sda-accent, #FF8A3D)';
    const finalColor = isDanger ? 'var(--sda-danger, #FF5A5F)' : accentColor;
    const displayValue = Number.isFinite(clamped) ? Math.round(clamped) : '--';
    const geo = computeCircleGeometry(size);

    let bodyHtml;
    switch (gaugeStyle) {
      case 'analog-classic':
        bodyHtml = this.renderAnalogClassic(geo, fraction, finalColor, size, displayValue, unit, safeMin, safeMax);
        break;
      case 'analog-modern':
        bodyHtml = this.renderAnalogModern(geo, fraction, finalColor, size, displayValue, unit);
        break;
      case 'digital-card':
        bodyHtml = this.renderDigitalCard(finalColor, size, displayValue, unit, label);
        break;
      case 'digital-modern':
        bodyHtml = this.renderDigitalModern(finalColor, size, displayValue, unit);
        break;
      case 'hybrid':
        bodyHtml = this.renderHybrid(geo, fraction, finalColor, size, displayValue, unit, safeMin, safeMax);
        break;
      case 'compact':
        bodyHtml = this.renderCompact(fraction, finalColor, size, displayValue, unit);
        break;
      default:
        bodyHtml = this.renderAnalogModern(geo, fraction, finalColor, size, displayValue, unit);
    }

    this.shadowRoot.innerHTML = `
      <style>${this.commonStyles()}</style>
      ${bodyHtml}
      ${label && !['digital-card'].includes(gaugeStyle) ? `<span class="label">${label}</span>` : ''}
    `;
  }

  commonStyles() {
    return `
      :host {
        display:inline-flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        min-width:0;
        font-family:var(--sda-font-body, Inter, Roboto, Arial, sans-serif);
        color:var(--sda-text-primary,#EDEFF2);
      }
      .wrap { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; }
      svg { display:block; overflow:visible; }
      .readout {
        position:absolute; inset:0;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        text-align:center; pointer-events:none;
      }
      .val {
        font-family:var(--sda-font-display, Inter, monospace);
        font-variant-numeric:tabular-nums;
        color:var(--sda-text-primary,#EDEFF2);
        line-height:1;
        font-weight:300;
      }
      .unit { font-size:.62em; color:var(--sda-text-muted,#8B93A1); margin-top:4px; }
      .label {
        margin-top:5px;
        font-size:var(--sda-fs-label,.72rem);
        text-transform:uppercase;
        letter-spacing:var(--sda-letter-label,.08em);
        color:var(--sda-text-muted,#8B93A1);
      }
      .track { fill:none; stroke:var(--sda-arc-track,#333943); }
      .tick { stroke:var(--sda-text-faint,#626A78); stroke-linecap:round; }
      .soft-glow { filter:drop-shadow(0 0 5px currentColor); }
      .danger-dot { fill:var(--sda-danger,#FF5A5F); }
      :host([size="lg"]) .val { font-size:var(--sda-fs-gauge-xl,4rem); }
      :host([size="sm"]) .val { font-size:var(--sda-fs-gauge-md,1.6rem); }
    `;
  }

  renderAnalogModern(geo, fraction, color, size, displayValue, unit) {
    const trackPath = buildArcPath(geo.cx, geo.cy, geo.radius, 1);
    const valuePath = buildArcPath(geo.cx, geo.cy, geo.radius, fraction);
    const px = size === 'lg' ? 270 : 122;

    return `
      <div class="wrap">
        <svg viewBox="0 0 200 200" width="${px}" height="${px}">
          <path class="track" d="${trackPath}" stroke-width="12" stroke-linecap="round" opacity=".9" />
          <path d="${valuePath}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" class="soft-glow" />
          <path d="${valuePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" />
        </svg>
        <div class="readout">
          <span class="val">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  renderAnalogClassic(geo, fraction, color, size, displayValue, unit, min, max) {
    const trackPath = buildArcPath(geo.cx, geo.cy, geo.radius, 1);
    const px = size === 'lg' ? 270 : 122;
    const ticks = Array.from({ length: NEEDLE_TICK_COUNT }, (_, i) => {
      const tickFraction = i / (NEEDLE_TICK_COUNT - 1);
      const angle = ARC_START_DEGREE + ARC_DEGREES * tickFraction;
      const outer = pointOnCircle(geo.cx, geo.cy, geo.radius + 8, angle);
      const inner = pointOnCircle(geo.cx, geo.cy, geo.radius - (i % 3 === 0 ? 12 : 7), angle);
      const major = i % 3 === 0;
      return `<line class="tick" x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke-width="${major ? 3 : 1.5}" />`;
    }).join('');

    const needleAngle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(geo.cx, geo.cy, geo.radius - 12, needleAngle);
    const tail = pointOnCircle(geo.cx, geo.cy, 17, needleAngle + 180);

    const startLabel = Number.isFinite(min) ? Math.round(min) : '';
    const endLabel = Number.isFinite(max) ? Math.round(max) : '';

    return `
      <div class="wrap">
        <svg viewBox="0 0 200 200" width="${px}" height="${px}">
          <path d="${trackPath}" fill="none" stroke="var(--sda-arc-track,#2D323B)" stroke-width="9" />
          ${ticks}
          <text x="28" y="162" fill="var(--sda-text-faint,#6D7480)" font-size="8" text-anchor="middle">${startLabel}</text>
          <text x="172" y="162" fill="var(--sda-text-faint,#6D7480)" font-size="8" text-anchor="middle">${endLabel}</text>
          <line x1="${tail.x}" y1="${tail.y}" x2="${tip.x}" y2="${tip.y}" stroke="${color}" stroke-width="4" stroke-linecap="round" class="soft-glow" />
          <circle cx="${geo.cx}" cy="${geo.cy}" r="8" fill="${color}" />
          <circle cx="${geo.cx}" cy="${geo.cy}" r="3" fill="#15181E" />
        </svg>
        <div class="readout" style="top:45%;">
          <span class="val" style="font-size:${size === 'lg' ? '1.55rem' : '1rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  renderDigitalCard(color, size, displayValue, unit, label) {
    const width = size === 'lg' ? 245 : 135;
    return `
      <div class="wrap" style="width:${width}px;">
        <div style="
          width:100%;
          padding:${size === 'lg' ? '28px 14px' : '16px 8px'};
          border-radius:18px;
          background:linear-gradient(145deg,var(--sda-bg-elevated,#242933),var(--sda-bg-surface,#1A1E25));
          border:1px solid color-mix(in srgb, ${color} 65%, #39404C);
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 24px rgba(0,0,0,.22);
          text-align:center;
        ">
          ${label ? `<div style="font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sda-text-muted,#8B93A1);margin-bottom:10px;">${label}</div>` : ''}
          <span class="val" style="display:block;color:${color};font-size:${size === 'lg' ? '4rem' : '1.8rem'};text-shadow:0 0 14px color-mix(in srgb, ${color} 25%, transparent);">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  renderDigitalModern(color, size, displayValue, unit) {
    const px = size === 'lg' ? 255 : 120;
    const r = size === 'lg' ? 84 : 40;
    const circumference = 2 * Math.PI * r;

    return `
      <div class="wrap">
        <svg viewBox="0 0 200 200" width="${px}" height="${px}">
          <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-opacity=".12" stroke-width="12" />
          <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="3"
            stroke-linecap="round" stroke-dasharray="${circumference * .74} ${circumference}"
            transform="rotate(-105 100 100)" class="soft-glow" />
          <circle cx="100" cy="100" r="${r - 10}" fill="none" stroke="rgba(255,255,255,.035)" stroke-width="1" />
        </svg>
        <div class="readout">
          <span style="font-size:.62rem;letter-spacing:.15em;color:${color};text-transform:uppercase;">LIVE</span>
          <span class="val" style="font-size:${size === 'lg' ? '4rem' : '1.65rem'};text-shadow:0 0 16px color-mix(in srgb, ${color} 30%, transparent);">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
    `;
  }

  renderHybrid(geo, fraction, color, size, displayValue, unit, min, max) {
    const trackPath = buildArcPath(geo.cx, geo.cy, geo.radius, 1);
    const valuePath = buildArcPath(geo.cx, geo.cy, geo.radius, fraction);
    const px = size === 'lg' ? 270 : 122;
    const needleAngle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(geo.cx, geo.cy, geo.radius - 13, needleAngle);

    return `
      <div class="wrap">
        <svg viewBox="0 0 200 200" width="${px}" height="${px}">
          <path d="${trackPath}" fill="none" stroke="var(--sda-arc-track,#2D323B)" stroke-width="10" />
          <path d="${valuePath}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" class="soft-glow" />
          <line x1="100" y1="100" x2="${tip.x}" y2="${tip.y}" stroke="${color}" stroke-width="3" stroke-linecap="round" />
          <circle cx="100" cy="100" r="7" fill="${color}" />
          <circle cx="100" cy="100" r="3" fill="#16191F" />
        </svg>
        <div class="readout" style="top:50%;">
          <span class="val" style="font-size:${size === 'lg' ? '3.2rem' : '1.45rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
          <span style="margin-top:7px;padding:4px 9px;border-radius:8px;background:rgba(255,255,255,.045);font-size:.55rem;letter-spacing:.12em;color:var(--sda-text-muted,#8B93A1);">HYBRID</span>
        </div>
      </div>
    `;
  }

  renderCompact(fraction, color, size, displayValue, unit) {
    const width = size === 'lg' ? 270 : 150;
    const height = size === 'lg' ? 28 : 18;
    const fillWidth = Math.max(0, Math.min(1, fraction)) * width;

    return `
      <div class="wrap" style="width:${width}px;align-items:stretch;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span class="val" style="font-size:${size === 'lg' ? '1.7rem' : '1rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="var(--sda-arc-track,#303640)" />
          <rect x="0" y="0" width="${fillWidth}" height="${height}" rx="${height / 2}" fill="${color}" class="soft-glow" />
        </svg>
      </div>
    `;
  }
}

customElements.define('sda-gauge', SdaGauge);
