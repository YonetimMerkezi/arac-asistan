/**
 * gauge.js
 * ---------------------------------------------------------------------------
 * <sda-gauge> - OBD panel göstergesi.
 *
 * Desteklenen yeni tasarımlar:
 *   analog-classic  : klasik otomobil kadranı + ibre
 *   analog-modern   : modern kalın yay + ibre
 *   digital-card    : büyük dijital kart
 *   digital-modern  : neon dijital halka
 *   hybrid          : analog ibre + dijital okuma
 *   compact         : küçük ekran için kompakt gösterge
 *
 * Eski kayıtlarla geriye dönük uyumluluk:
 *   arc     -> analog-modern
 *   needle  -> analog-classic
 *   digital -> digital-card
 *   bar     -> compact
 * ---------------------------------------------------------------------------
 */

const ARC_DEGREES = 270;
const ARC_START_DEGREE = 135;
const NEEDLE_TICK_COUNT = 17;

function pointOnCircle(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

function buildArcPath(cx, cy, radius, fraction) {
  const sweep = ARC_DEGREES * Math.max(0, Math.min(1, fraction));
  if (sweep <= 0.001) return '';
  const start = pointOnCircle(cx, cy, radius, ARC_START_DEGREE);
  const end = pointOnCircle(cx, cy, radius, ARC_START_DEGREE + sweep);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function normalizeVariant(value) {
  const aliases = {
    arc: 'analog-modern',
    needle: 'analog-classic',
    digital: 'digital-card',
    bar: 'compact',
  };
  return aliases[value] ?? value ?? 'analog-modern';
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
    const variant = normalizeVariant(this.getAttribute('variant'));
    const dangerAbove = this.getAttribute('danger-above');
    const colorHue = this.getAttribute('color-hue');

    const clamped = Math.max(min, Math.min(max, value));
    const fraction = max > min ? (clamped - min) / (max - min) : 0;
    const danger = dangerAbove !== null && value > Number(dangerAbove);
    const accent = colorHue !== null
      ? `hsl(${Number(colorHue)} 90% 60%)`
      : 'var(--sda-accent, #FF8A3D)';
    const color = danger ? 'var(--sda-danger, #FF5A5F)' : accent;
    const displayValue = Number.isFinite(clamped) ? this.formatValue(clamped) : '--';

    const renderers = {
      'analog-classic': () => this.renderAnalogClassic(fraction, color, size, displayValue, unit),
      'analog-modern': () => this.renderAnalogModern(fraction, color, size, displayValue, unit),
      'digital-card': () => this.renderDigitalCard(color, size, displayValue, unit),
      'digital-modern': () => this.renderDigitalModern(fraction, color, size, displayValue, unit),
      hybrid: () => this.renderHybrid(fraction, color, size, displayValue, unit),
      compact: () => this.renderCompact(fraction, color, size, displayValue, unit),
    };

    const body = (renderers[variant] ?? renderers['analog-modern'])();

    this.shadowRoot.innerHTML = `
      <style>${this.commonStyles()}</style>
      ${body}
      ${label ? `<span class="label">${label}</span>` : ''}
    `;
  }

  formatValue(value) {
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('tr-TR');
    if (Number.isInteger(value)) return String(value);
    return Number(value.toFixed(1)).toString();
  }

  commonStyles() {
    return `
      :host {
        display:inline-flex;
        flex-direction:column;
        align-items:center;
        width:100%;
        font-family:var(--sda-font-body, Inter, sans-serif);
        color:var(--sda-text-primary,#EDEFF2);
      }
      .wrap { position:relative; width:100%; display:flex; justify-content:center; }
      svg { display:block; width:100%; height:100%; overflow:visible; }
      .readout {
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; text-align:center;
      }
      .val {
        font-family:var(--sda-font-display,'JetBrains Mono',monospace);
        font-variant-numeric:tabular-nums;
        color:var(--sda-text-primary,#EDEFF2);
        line-height:1;
        font-weight:300;
      }
      .unit { color:var(--sda-text-muted,#8B93A1); font-size:.65em; margin-top:5px; }
      .label {
        margin-top:7px; font-size:var(--sda-fs-label,.78rem);
        text-transform:uppercase; letter-spacing:var(--sda-letter-label,.08em);
        color:var(--sda-text-muted,#8B93A1); text-align:center;
      }
      .track { fill:none; stroke:var(--sda-arc-track,#333); stroke-linecap:round; }
      .value-arc { fill:none; stroke-linecap:round; transition:stroke-dasharray .35s ease; }
      .tick { stroke:var(--sda-text-faint,#5A6270); }
      .tick-major { stroke:var(--sda-text-muted,#8B93A1); }
      .needle { stroke-linecap:round; filter:drop-shadow(0 0 4px currentColor); }
      .danger { color:var(--sda-danger,#FF5A5F); }

      .digital-card {
        width:100%; min-height:110px; padding:18px 12px;
        border:1px solid color-mix(in srgb, currentColor 70%, transparent);
        border-radius:var(--sda-radius-md,16px);
        background:linear-gradient(145deg,var(--sda-bg-elevated,#242933),var(--sda-bg-surface,#1C2027));
        display:flex; flex-direction:column; align-items:center; justify-content:center;
      }
      .digital-card .val { font-size:clamp(2rem,7vw,4.8rem); }

      .neon {
        width:min(280px,100%); aspect-ratio:1; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        background:radial-gradient(circle, color-mix(in srgb,currentColor 13%,transparent), transparent 63%);
        border:10px solid color-mix(in srgb,currentColor 15%, transparent);
        border-top-color:currentColor;
        box-shadow:0 0 24px color-mix(in srgb,currentColor 35%, transparent), inset 0 0 28px color-mix(in srgb,currentColor 10%, transparent);
      }
      .neon .val { font-size:clamp(3rem,10vw,5rem); text-shadow:0 0 15px color-mix(in srgb,currentColor 45%, transparent); }

      .compact-box {
        width:100%; min-height:78px; padding:12px 14px;
        border-radius:var(--sda-radius-sm,10px);
        background:var(--sda-bg-elevated,#242933);
        border:1px solid var(--sda-hairline,rgba(255,255,255,.08));
        display:flex; flex-direction:column; align-items:center; justify-content:center;
      }
      .compact-box .val { font-size:clamp(1.35rem,5vw,2rem); }

      @media (max-width:390px) {
        .neon { width:190px; }
      }
    `;
  }

  geometry() {
    return { box: 120, cx: 60, cy: 60, radius: 47 };
  }

  renderAnalogClassic(fraction, color, size, displayValue, unit) {
    const g = this.geometry();
    const ticks = this.renderTicks(g, NEEDLE_TICK_COUNT);
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx, g.cy, g.radius - 8, angle);
    const tail = pointOnCircle(g.cx, g.cy, 10, angle + 180);
    const px = size === 'lg' ? 280 : 120;
    return `
      <div class="wrap" style="max-width:${px}px;aspect-ratio:1;">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="49" fill="none" stroke="rgba(255,255,255,.025)" stroke-width="7"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="3"/>
          ${ticks}
          <line x1="${tail.x}" y1="${tail.y}" x2="${tip.x}" y2="${tip.y}" class="needle" stroke="${color}" stroke-width="3"/>
          <circle cx="60" cy="60" r="6" fill="${color}"/>
        </svg>
        <div class="readout" style="justify-content:flex-end;padding-bottom:17%;">
          <span class="val" style="font-size:${size === 'lg' ? '2rem' : '1.15rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderAnalogModern(fraction, color, size, displayValue, unit) {
    const g = this.geometry();
    const px = size === 'lg' ? 280 : 120;
    const dash = 270 * fraction;
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx,g.cy,g.radius-10,angle);
    return `
      <div class="wrap" style="max-width:${px}px;aspect-ratio:1;">
        <svg viewBox="0 0 120 120">
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="9"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,fraction)}" class="value-arc" stroke="${color}" stroke-width="9"/>
          <circle cx="${tip.x}" cy="${tip.y}" r="3.5" fill="${color}"/>
        </svg>
        <div class="readout">
          <span class="val" style="font-size:${size === 'lg' ? '3.2rem' : '1.7rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderDigitalCard(color, size, displayValue, unit) {
    const px = size === 'lg' ? 280 : 150;
    return `
      <div class="wrap" style="max-width:${px}px;">
        <div class="digital-card" style="color:${color};">
          <span class="val" style="color:${color};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderDigitalModern(fraction, color, size, displayValue, unit) {
    const px = size === 'lg' ? 280 : 150;
    const rotation = -135 + 270 * fraction;
    return `
      <div class="wrap" style="max-width:${px}px;">
        <div class="neon" style="color:${color};">
          <div class="readout">
            <span class="val" style="color:${color};">${displayValue}</span>
            <span class="unit">${unit}</span>
          </div>
        </div>
      </div>`;
  }

  renderHybrid(fraction, color, size, displayValue, unit) {
    const g = this.geometry();
    const angle = ARC_START_DEGREE + ARC_DEGREES * fraction;
    const tip = pointOnCircle(g.cx,g.cy,g.radius-10,angle);
    const px = size === 'lg' ? 280 : 150;
    return `
      <div class="wrap" style="max-width:${px}px;aspect-ratio:1;">
        <svg viewBox="0 0 120 120">
          <path d="${buildArcPath(g.cx,g.cy,g.radius,1)}" class="track" stroke-width="8"/>
          <path d="${buildArcPath(g.cx,g.cy,g.radius,fraction)}" class="value-arc" stroke="${color}" stroke-width="5"/>
          <line x1="60" y1="60" x2="${tip.x}" y2="${tip.y}" class="needle" stroke="${color}" stroke-width="3.5"/>
          <circle cx="60" cy="60" r="6" fill="${color}"/>
        </svg>
        <div class="readout">
          <span class="val" style="font-size:${size === 'lg' ? '2.8rem' : '1.55rem'};">${displayValue}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>`;
  }

  renderCompact(fraction, color, size, displayValue, unit) {
    return `
      <div class="wrap" style="max-width:${size === 'lg' ? '300px' : '170px'};">
        <div class="compact-box" style="color:${color};">
          <span class="val">${displayValue}</span>
          <span class="unit">${unit}</span>
          <div style="width:90%;height:5px;margin-top:9px;border-radius:5px;background:var(--sda-arc-track,#333);overflow:hidden;">
            <div style="height:100%;width:${fraction*100}%;background:${color};border-radius:5px;transition:width .35s ease;"></div>
          </div>
        </div>
      </div>`;
  }

  renderTicks(g, count) {
    return Array.from({ length: count }, (_, i) => {
      const f = i / (count - 1);
      const angle = ARC_START_DEGREE + ARC_DEGREES * f;
      const outer = pointOnCircle(g.cx,g.cy,g.radius+4,angle);
      const inner = pointOnCircle(g.cx,g.cy,g.radius-(i%2===0 ? 7 : 4),angle);
      return `<line class="${i%2===0 ? 'tick-major' : 'tick'}" x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke-width="${i%2===0 ? 2 : 1.3}"/>`;
    }).join('');
  }
}

customElements.define('sda-gauge', SdaGauge);
