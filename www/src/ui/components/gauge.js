/**
 * Smart Drive AI - Automotive Gauge Web Component
 * SVG tabanlı otomobil gösterge sistemi.
 *
 * variant:
 * needle | semi-digital | counter-needle | counter-digital |
 * bar | graph | digital | digital-graph
 */

const START = 135;
const SWEEP = 270;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function point(cx, cy, r, deg) {
  const a = deg * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, fraction) {
  const sweep = SWEEP * clamp(fraction, 0, 1);
  const s = point(cx, cy, r, START);
  const e = point(cx, cy, r, START + sweep);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
}
function ticks(cx, cy, r, count = 17, majorEvery = 2) {
  return Array.from({ length: count }, (_, i) => {
    const f = i / (count - 1);
    const a = START + SWEEP * f;
    const outer = point(cx, cy, r + 2, a);
    const inner = point(cx, cy, r - (i % majorEvery === 0 ? 11 : 6), a);
    return `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" class="tick ${i % majorEvery === 0 ? 'major' : ''}"/>`;
  }).join('');
}
function labels(cx, cy, r, min, max, count = 9) {
  return Array.from({ length: count }, (_, i) => {
    const f = i / (count - 1);
    const a = START + SWEEP * f;
    const p = point(cx, cy, r, a);
    const val = min + (max - min) * f;
    const text = Math.abs(val) >= 1000 ? (val / 1000).toFixed(1).replace('.0','') + 'k' : Math.round(val);
    return `<text x="${p.x}" y="${p.y}" class="dial-label" text-anchor="middle" dominant-baseline="middle">${esc(text)}</text>`;
  }).join('');
}

export class SdaGauge extends HTMLElement {
  static get observedAttributes() {
    return ['value','min','max','label','unit','size','variant','danger-above','color-hue','history'];
  }
  constructor() { super(); this.attachShadow({mode:'open'}); this.history = []; }
  connectedCallback() { this.render(); }
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected) return;
    if (name === 'value' && newValue !== oldValue) {
      const n = Number(newValue);
      if (Number.isFinite(n)) {
        this.history.push(n);
        if (this.history.length > 30) this.history.shift();
      }
    }
    this.render();
  }

  render() {
    const raw = this.getAttribute('value');
    const hasValue = raw !== null && raw !== '' && Number.isFinite(Number(raw));
    const value = hasValue ? Number(raw) : null;
    const min = Number(this.getAttribute('min') ?? 0);
    const max = Number(this.getAttribute('max') ?? 100);
    const label = this.getAttribute('label') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const size = this.getAttribute('size') ?? 'sm';
    const variant = this.getAttribute('variant') ?? 'needle';
    const hue = Number(this.getAttribute('color-hue') ?? 28);
    const danger = this.getAttribute('danger-above');
    const accent = `hsl(${Number.isFinite(hue) ? hue : 28} 92% 58%)`;
    const dangerColor = danger !== null && value !== null && value > Number(danger) ? '#ff4545' : accent;
    const fraction = value === null ? 0 : (max > min ? clamp((value-min)/(max-min),0,1) : 0);
    const display = value === null ? '--' : this.format(value);
    const cls = size === 'lg' ? 'lg' : 'sm';
    const body = this.renderVariant(variant, fraction, dangerColor, display, unit, min, max, value, cls);

    this.shadowRoot.innerHTML = `<style>${this.styles()}</style><div class="gauge ${cls} ${variant}">${body}<div class="label">${esc(label)}</div></div>`;
  }

  format(v) {
    if (Math.abs(v) >= 1000 && Number.isInteger(v)) return v.toLocaleString('tr-TR');
    if (Math.abs(v) < 10 && !Number.isInteger(v)) return v.toFixed(1);
    return Math.round(v).toLocaleString('tr-TR');
  }

  renderVariant(v, fraction, color, display, unit, min, max, value, size) {
    const S = size === 'lg' ? 300 : 164;
    const cx = 150, cy = 150, r = 112;
    const track = arcPath(cx,cy,r,1);
    const fill = arcPath(cx,cy,r,fraction);
    const needleA = START + SWEEP * fraction;
    const tip = point(cx,cy,r-13,needleA);
    const tail = point(cx,cy,35,needleA+180);
    const t = ticks(cx,cy,r);
    const l = labels(cx,cy,87,min,max);
    const title = esc(this.getAttribute('label') ?? '');
    const safeColor = color;

    if (v === 'digital') return `<div class="digital-shell"><div class="digital-title">${title}</div><div class="digital-value" style="color:${safeColor}">${display}</div><div class="digital-unit">${esc(unit)}</div><div class="digital-led"></div></div>`;
    if (v === 'bar') return `<div class="bar-shell"><div class="bar-top"><span>${title}</span><strong style="color:${safeColor}">${display}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${fraction*100}%;background:${safeColor}"></div><div class="bar-glow" style="left:${fraction*100}%;background:${safeColor}"></div></div><div class="bar-unit">${esc(unit)}</div></div>`;
    if (v === 'graph' || v === 'digital-graph') return this.graphBody(v, safeColor, display, unit, min, max, S);

    const digital = v === 'semi-digital' || v === 'counter-digital';
    const counter = v === 'counter-digital' || v === 'counter-needle';
    const valueBlock = digital ? `<div class="center-readout"><span>${display}</span><small>${esc(unit)}</small></div>` : `<div class="lower-readout"><strong>${display}</strong><small>${esc(unit)}</small></div>`;
    const counterBlock = counter ? `<div class="counter"><span>MAX ${value === null ? '--' : this.format(max)}</span><span>MIN ${value === null ? '--' : this.format(min)}</span></div>` : '';

    return `<div class="dial-shell"><svg viewBox="0 0 300 300" width="${S}" height="${S}" aria-hidden="true">
      <defs><radialGradient id="face"><stop offset="0" stop-color="#252930"/><stop offset="0.72" stop-color="#111318"/><stop offset="1" stop-color="#07080a"/></radialGradient><linearGradient id="metal"><stop stop-color="#747b84"/><stop offset=".25" stop-color="#1d2127"/><stop offset=".55" stop-color="#9ca2aa"/><stop offset="1" stop-color="#171a1f"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <circle cx="150" cy="150" r="128" fill="url(#metal)"/><circle cx="150" cy="150" r="121" fill="#08090b"/><circle cx="150" cy="150" r="113" fill="url(#face)" stroke="#333840" stroke-width="1"/>
      <path d="${track}" class="track"/><path d="${fill}" class="value-arc" style="stroke:${safeColor}" filter="url(#glow)"/>
      ${t}${l}
      <text x="150" y="70" class="dial-title">${title}</text>
      ${v === 'needle' || v === 'counter-needle' || v === 'semi-digital' || v === 'counter-digital' ? `<line x1="${tail.x}" y1="${tail.y}" x2="${tip.x}" y2="${tip.y}" class="needle" style="stroke:${safeColor}"/><circle cx="150" cy="150" r="12" class="hub"/><circle cx="150" cy="150" r="5" style="fill:${safeColor}"/>` : ''}
      <text x="150" y="205" class="unit-text">${esc(unit)}</text>
    </svg>${valueBlock}${counterBlock}<div class="glass"></div></div>`;
  }

  graphBody(v, color, display, unit, min, max, S) {
    const hist = this.history.length ? this.history : [Number(display) || 0];
    const pts = hist.map((n,i) => {
      const x = 12 + i * (276 / Math.max(1, hist.length-1));
      const y = 106 - clamp((n-min)/Math.max(1,max-min),0,1)*82;
      return `${x},${y}`;
    }).join(' ');
    return `<div class="graph-shell"><div class="graph-head"><span>${esc(this.getAttribute('label')||'')}</span><strong style="color:${color}">${display}</strong></div><svg viewBox="0 0 300 125"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="M12 106 L${pts.replace(/ /g,' L')} L288 106 Z" fill="url(#area)"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="graph-unit">${esc(unit)}</div>${v === 'digital-graph' ? `<div class="graph-digital">${display}<small>${esc(unit)}</small></div>` : ''}</div>`;
  }

  styles() { return `
    :host{display:block;color:#eef0f3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;contain:content}
    *{box-sizing:border-box}.gauge{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px}.gauge.lg{width:100%;}.gauge.sm{width:100%}
    .dial-shell{position:relative;width:100%;max-width:300px;aspect-ratio:1/1;filter:drop-shadow(0 12px 18px rgba(0,0,0,.45))}.sm .dial-shell{max-width:170px}
    svg{display:block;width:100%;height:100%}.track{fill:none;stroke:#2b2f36;stroke-width:7;stroke-linecap:round}.value-arc{fill:none;stroke-width:6;stroke-linecap:round}.tick{stroke:#626a75;stroke-width:2}.tick.major{stroke:#b0b5bc;stroke-width:3}.dial-label{fill:#c4c8cd;font-size:9px;font-weight:700}.dial-title{fill:#8e959f;font-size:11px;letter-spacing:2px;font-weight:700}.unit-text{fill:#777f89;font-size:10px;letter-spacing:1px}.needle{stroke-width:4;stroke-linecap:round;filter:url(#glow);transition:transform .12s linear}.hub{fill:#262b31;stroke:#8c9299;stroke-width:2}.glass{position:absolute;inset:5%;border-radius:50%;background:linear-gradient(145deg,rgba(255,255,255,.10),transparent 28%,transparent 65%,rgba(255,255,255,.025));pointer-events:none}.lower-readout{position:absolute;left:0;right:0;bottom:16%;text-align:center;text-shadow:0 2px 8px #000}.lower-readout strong{display:block;font-size:28px;line-height:1;font-variant-numeric:tabular-nums}.lower-readout small,.center-readout small{display:block;color:#8d949e;font-size:11px}.center-readout{position:absolute;left:0;right:0;top:46%;text-align:center;text-shadow:0 2px 8px #000}.center-readout span{font-size:28px;font-variant-numeric:tabular-nums}.counter{position:absolute;left:16%;right:16%;bottom:11%;display:flex;justify-content:space-between;color:#777f89;font-size:8px;letter-spacing:.5px}.label{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9aa1aa;font-weight:600;text-align:center;max-width:95%;}.lg .label{font-size:15px}.digital-shell,.bar-shell,.graph-shell{width:100%;max-width:260px;background:linear-gradient(145deg,#262b32,#101216);border:1px solid #3a4048;border-radius:18px;box-shadow:inset 0 1px rgba(255,255,255,.05),0 10px 20px rgba(0,0,0,.35);padding:18px}.sm .digital-shell,.sm .bar-shell,.sm .graph-shell{max-width:160px;padding:12px;border-radius:13px}.digital-title,.bar-top span,.graph-head span{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#7f8791}.digital-value{font-size:52px;line-height:1;font-variant-numeric:tabular-nums;font-weight:500;text-align:center;margin:12px 0 5px;text-shadow:0 0 14px currentColor}.sm .digital-value{font-size:29px}.digital-unit,.bar-unit,.graph-unit{color:#7f8791;text-align:center;font-size:10px}.digital-led{width:7px;height:7px;border-radius:50%;background:#3cff7a;box-shadow:0 0 9px #3cff7a;margin:10px auto 0}.bar-top,.graph-head{display:flex;justify-content:space-between;align-items:end;gap:8px}.bar-top strong,.graph-head strong{font-size:22px;font-variant-numeric:tabular-nums}.sm .bar-top strong,.sm .graph-head strong{font-size:15px}.bar-track{height:18px;background:#0b0d10;border-radius:20px;border:1px solid #30353c;overflow:visible;margin:18px 0 6px;position:relative}.bar-fill{height:100%;border-radius:20px;box-shadow:0 0 12px currentColor;transition:width .12s linear}.bar-glow{position:absolute;top:50%;width:8px;height:28px;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 14px currentColor}.graph-shell svg{width:100%;height:auto;margin-top:8px;background:repeating-linear-gradient(0deg,#121519 0 1px,transparent 1px 25px),repeating-linear-gradient(90deg,#121519 0 1px,transparent 1px 30px)}.graph-digital{text-align:center;font-size:27px;margin-top:-30px;position:relative;font-variant-numeric:tabular-nums}.graph-digital small{display:block;font-size:9px;color:#7f8791}.graph-unit{text-align:right}
  `; }
}

customElements.define('sda-gauge', SdaGauge);
