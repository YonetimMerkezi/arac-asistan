/**
 * gauge.js
 * ---------------------------------------------------------------------------
 * Smart Drive AI - OBD gösterge bileşeni.
 *
 * Tasarımlar:
 *   analog-classic : Klasik otomobil kadranı + ibre + ölçek
 *   analog-modern  : Modern yarım kadran + temiz ibre
 *   digital-card   : Dijital ekran kartı
 *   digital-modern : Dijital + dairesel ilerleme
 *   hybrid         : Kadran + büyük dijital okuma
 *   compact        : Kompakt bar + dijital değer
 *
 * Eski kayıtlar:
 *   arc -> analog-modern
 *   needle -> analog-classic
 *   digital -> digital-card
 *   bar -> compact
 * ---------------------------------------------------------------------------
 */

const ARC_DEGREES = 270;
const ARC_START_DEGREE = 135;
const TICK_COUNT = 21;

const LEGACY_ALIASES = {
  arc: 'analog-modern',
  needle: 'analog-classic',
  digital: 'digital-card',
  bar: 'compact',
};

const VALID_VARIANTS = new Set([
  'analog-classic',
  'analog-modern',
  'digital-card',
  'digital-modern',
  'hybrid',
  'compact',
]);

function normalizeVariant(value) {
  const v = LEGACY_ALIASES[value] ?? value;
  return VALID_VARIANTS.has(v) ? v : 'analog-modern';
}

function pointOnCircle(cx, cy, radius, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function buildArcPath(cx, cy, radius, fraction) {
  const safe = Math.max(0, Math.min(1, fraction));
  const sweep = ARC_DEGREES * safe;
  if (sweep <= 0.001) return '';
  const start = pointOnCircle(cx, cy, radius, ARC_START_DEGREE);
  const end = pointOnCircle(cx, cy, radius, ARC_START_DEGREE + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
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
    const size = this.getAttribute('size') === 'lg' ? 'lg' : 'sm';
    const variant = normalizeVariant(this.getAttribute('variant'));
    const dangerAbove = this.getAttribute('danger-above');
    const hue = this.getAttribute('color-hue');

    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 100;
    const safeValue = Number.isFinite(value) ? value : safeMin;
    const clamped = Math.max(safeMin, Math.min(safeMax, safeValue));
    const fraction = (clamped - safeMin) / (safeMax - safeMin);
    const danger = dangerAbove !== null && Number.isFinite(Number(dangerAbove)) && safeValue > Number(dangerAbove);

    const accent = hue !== null && Number.isFinite(Number(hue))
      ? `hsl(${Number(hue)} 92% 60%)`
      : 'var(--sda-accent, #FF8A3D)';
    const color = danger ? 'var(--sda-danger, #FF5A5F)' : accent;
    const displayValue = this.formatValue(clamped);

    const renderers = {
      'analog-classic': () => this.renderAnalogClassic(fraction, color, size, displayValue, unit, safeMin, safeMax),
      'analog-modern': () => this.renderAnalogModern(fraction, color, size, displayValue, unit, safeMin, safeMax),
      'digital-card': () => this.renderDigitalCard(color, size, displayValue, unit),
      'digital-modern': () => this.renderDigitalModern(fraction, color, size, displayValue, unit),
      hybrid: () => this.renderHybrid(fraction, color, size, displayValue, unit, safeMin, safeMax),
      compact: () => this.renderCompact(fraction, color, size, displayValue, unit),
    };

    this.shadowRoot.innerHTML = `
      <style>${this.commonStyles()}</style>
      <div class="gauge-root" data-variant="${variant}">
        ${renderers[variant]()}
        ${label ? `<div class="label">${this.escapeHtml(label)}</div>` : ''}
      </div>
    `;
  }

  formatValue(value) {
    if (!Number.isFinite(value)) return '--';
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('tr-TR');
    if (Number.isInteger(value)) return String(value);
    return Number(value.toFixed(1)).toString();
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  commonStyles() {
    return `
      :host {
        display:block;
        width:100%;
        min-width:0;
        font-family:var(--sda-font-body, Inter, sans-serif);
        color:var(--sda-text-primary,#EDEFF2);
      }
      .gauge-root {
        width:100%;
        display:flex;
        flex-direction:column;
        align-items:center;
        box-sizing:border-box;
      }
      .wrap {
        position:relative;
        width:min(100%, 300px);
        flex:none;
      }
      svg { display:block; width:100%; height:auto; overflow:visible; }
      .readout {
        position:absolute;
        inset:0;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        text-align:center;
        pointer-events:none;
      }
      .val {
        font-family:var(--sda-font-display,'JetBrains Mono',monospace);
        font-variant-numeric:tabular-nums;
        color:var(--sda-text-primary,#EDEFF2);
        line-height:.95;
        font-weight:400;
        white-space:nowrap;
      }
      .unit {
        color:var(--sda-text-muted,#8B93A1);
        font-size:.72em;
        line-height:1.1;
        margin-top:7px;
        white-space:nowrap;
      }
      .label {
        width:100%;
        box-sizing:border-box;
        margin-top:10px;
        padding:0 8px;
        text-align:center;
        font-size:var(--sda-fs-label,.78rem);
        line-height:1.25;
        text-transform:uppercase;
        letter-spacing:var(--sda-letter-label,.08em);
        color:var(--sda-text-muted,#8B93A1);
        white-space:normal;
        overflow-wrap:anywhere;
      }
      .track { fill:none; stroke:var(--sda-arc-track,#2F3540); stroke-linecap:round; }
      .value-arc { fill:none; stroke-linecap:round; }
      .tick { stroke:var(--sda-text-faint,#59616F); }
      .tick-major { stroke:var(--sda-text-primary,#B7BDC6); }
      .needle { stroke-linecap:round; }
      .scale-text { fill:var(--sda-text-muted,#9299A6); font-size:5px; font-family:Inter,sans-serif; }
      .digital-card, .compact-box {
        box-sizing:border-box;
        width:100%;
        border-radius:18px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
      }
      .digital-card {
        min-height:145px;
        padding:24px 16px;
        background:linear-gradient(145deg,var(--sda-bg-elevated,#242933),var(--sda-bg-surface,#171A20));
        border:1px solid color-mix(in srgb,currentColor 65%,transparent);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 10px 30px rgba(0,0,0,.16);
      }
      .digital-card .val { font-size:clamp(2.8rem,9vw,5.2rem); }
      .digital-modern-box {
        position:relative;
        width:100%;
        aspect-ratio:1;
        border-radius:50%;
        display:flex;
        align-items:center;
        justify-content:center;
        background:radial-gradient(circle at 50% 45%, color-mix(in srgb,currentColor 10%,transparent), transparent 58%);
        box-shadow:inset 0 0 30px rgba(255,255,255,.025);
      }
      .digital-modern-box .readout { inset:12%; }
      .digital-modern-box .val { font-size:clamp(2.6rem,9vw,4.8rem); }
      .compact-box {
        min-height:112px;
        padding:18px 16px;
        background:var(--sda-bg-elevated,#242933);
        border:1px solid var(--sda-hairline,rgba(255,255,255,.08));
      }
      .compact-box .val { font-size:clamp(1.8rem,6vw,2.8rem); }
      .bar-track { width:88%; height:8px; margin-top:14px; border-radius:99px; background:var(--sda-arc-track,#2F3540); overflow:hidden; }
      .bar-fill { height:100%; border-radius:99px; }
      .small-info { fill:var(--sda-text-muted,#8B93A1); font-size:4px; font-family:Inter,sans-serif; }
      .center-dot { filter:drop-shadow(0 0 4px currentColor); }
      :host([size="sm"]) .wrap { max-width:190px; }
      :host([size="lg"]) .wrap { max-width:330px; }
      :host([size="sm"]) .label { font-size:.72rem; margin-top:8px; }
      :host([size="lg"]) .label { font-size:.9rem; margin-top:12px; }
    `;
  }

  geometry() {
    return { box: 160, cx: 80, cy: 80, radius: 61 };
  }

  renderTicks(g, count = TICK_COUNT, min = 0, max = 100) {
    return Array.from({ length: count }, (_, i) => {
      const f = i / (count - 1);
      const angle = ARC_START_DEGREE + ARC_DEGREES * f;
      const major = i % 2 === 0;
      const outer = pointOnCircle(g.cx, g.cy, g.radius + (major ? 5 : 3), angle);
      const inner = pointOnCircle(g.cx, g.cy, g.radius - (major ? 9 : 5), angle);
      const value = min + (max - min) * f;
      return `
        <line class="${major ? 'tick-major' : 'tick'}" x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke-width="${major ? 2.5 : 1.4}"/>
        ${major ? `<text class="scale-text" x="${pointOnCircle(g.cx,g.cy,g.radius-18,angle).x}" y="${pointOnCircle(g.cx,g.cy,g.radius-18,angle).y + 1.5}" text-anchor="middle">${this.formatScale(value)}</text>` : ''}
      `;
    }).join('');
  }

  formatScale(value) {
    if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(1)));
  }

  renderAnalogClassic(fraction, color, size, displayValue, unit, min, max) {
    const g = this.geometry();
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx, g.cy, g.radius - 8, angle);
    const tail = pointOnCircle(g.cx, g.cy, 13, angle + 180);
    return `
      <div class="wrap">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="68" fill="none" stroke="rgba(255,255,255,.035)" stroke-width="8"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="4"/>
          ${this.renderTicks(g, TICK_COUNT, min, max)}
          <line x1="${tail.x}" y1="${tail.y}" x2="${tip.x}" y2="${tip.y}" class="needle" stroke="${color}" stroke-width="4"/>
          <circle cx="80" cy="80" r="8" fill="${color}" class="center-dot"/>
          <circle cx="80" cy="80" r="3" fill="#11151A"/>
        </svg>
        <div class="readout" style="justify-content:flex-end;padding-bottom:12%;">
          <span class="val" style="font-size:${size === 'lg' ? '2.4rem' : '1.45rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderAnalogModern(fraction, color, size, displayValue, unit, min, max) {
    const g = this.geometry();
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx, g.cy, g.radius - 10, angle);
    return `
      <div class="wrap">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="10"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,fraction)}" class="value-arc" stroke="${color}" stroke-width="10"/>
          ${this.renderTicks(g, 11, min, max)}
          <line x1="80" y1="80" x2="${tip.x}" y2="${tip.y}" class="needle" stroke="${color}" stroke-width="4"/>
          <circle cx="80" cy="80" r="8" fill="${color}" class="center-dot"/>
          <circle cx="80" cy="80" r="3" fill="#11151A"/>
        </svg>
        <div class="readout" style="justify-content:flex-end;padding-bottom:13%;">
          <span class="val" style="font-size:${size === 'lg' ? '2.7rem' : '1.55rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderDigitalCard(color, size, displayValue, unit) {
    return `
      <div class="wrap">
        <div class="digital-card" style="color:${color};">
          <div style="font-size:.72rem;letter-spacing:.14em;color:var(--sda-text-muted,#8B93A1);margin-bottom:10px;">LIVE DATA</div>
          <span class="val" style="color:${color};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderDigitalModern(fraction, color, size, displayValue, unit) {
    const r = 61;
    const circumference = 2 * Math.PI * r;
    const dash = circumference * fraction;
    return `
      <div class="wrap">
        <div class="digital-modern-box" style="color:${color};">
          <svg viewBox="0 0 160 160" aria-hidden="true" style="position:absolute;inset:0;">
            <circle cx="80" cy="80" r="61" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="8"/>
            <circle cx="80" cy="80" r="61" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${dash} ${circumference-dash}" transform="rotate(-90 80 80)"/>
          </svg>
          <div class="readout">
            <span style="font-size:.7rem;letter-spacing:.12em;color:var(--sda-text-muted,#8B93A1);">DIGITAL</span>
            <span class="val" style="color:${color};margin-top:7px;">${displayValue}</span>
            <span class="unit">${unit}</span>
          </div>
        </div>
      </div>`;
  }

  renderHybrid(fraction, color, size, displayValue, unit, min, max) {
    const g = this.geometry();
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx,g.cy,g.radius-8,angle);
    return `
      <div class="wrap">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="5"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,fraction)}" class="value-arc" stroke="${color}" stroke-width="5"/>
          ${this.renderTicks(g, 9, min, max)}
          <line x1="80" y1="80" x2="${tip.x}" y2="${tip.y}" class="needle" stroke="${color}" stroke-width="3"/>
          <circle cx="80" cy="80" r="7" fill="${color}"/>
        </svg>
        <div class="readout" style="justify-content:center;">
          <span style="font-size:.68rem;letter-spacing:.13em;color:var(--sda-text-muted,#8B93A1);">HYBRID</span>
          <span class="val" style="font-size:${size === 'lg' ? '2.6rem' : '1.5rem'};margin-top:6px;">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderCompact(fraction, color, size, displayValue, unit) {
    return `
      <div class="wrap">
        <div class="compact-box" style="color:${color};">
          <div style="width:100%;display:flex;align-items:baseline;justify-content:center;gap:7px;">
            <span class="val">${displayValue}</span>
            <span class="unit" style="margin-top:0;">${unit}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${fraction*100}%;background:${color};"></div>
          </div>
        </div>
      </div>`;
  }
}

customElements.define('sda-gauge', SdaGauge);
