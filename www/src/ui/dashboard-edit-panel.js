/**
 * Smart Drive AI - Dashboard Edit Panel
 * Gösterge seçimi: otomobil kokpit tarzı SVG göstergeler.
 */
import '../ui/components/gauge.js';
import { iconMarkup } from './icons.js';
import { openModal } from './components/modal.js';
import { WIDGET_REGISTRY } from '../obd/widget-registry.js';
import { getDashboardConfig, setDashboardWidgets, setWidgetColor, setWidgetStyle } from '../core/dashboard-config-store.js';

const COLOR_PRESETS = [28, 4, 48, 142, 199, 291, 335, 0];
const GAUGE_STYLE_OPTIONS = [
  { value:'needle', label:'Kadran (İbreli)', sub:'Klasik otomobil göstergesi' },
  { value:'semi-digital', label:'Kadran (Yarı dijital)', sub:'İbre + büyük dijital değer' },
  { value:'counter-needle', label:'Sayaçlı Kadran (İbreli)', sub:'İbre + min/max bilgisi' },
  { value:'counter-digital', label:'Sayaçlı Kadran (Yarı dijital)', sub:'Dijital + min/max' },
  { value:'bar', label:'Bar Göstergesi', sub:'Hızlı seviye takibi' },
  { value:'graph', label:'Grafik', sub:'Son ölçümlerin akışı' },
  { value:'digital', label:'Dijital Gösterge', sub:'Büyük dijital rakam' },
  { value:'digital-graph', label:'Digital Display + Graph', sub:'Dijital değer + grafik' },
];
let contentGetter = null;

export function renderEditModePanel(content, getContent) {
  contentGetter = getContent;
  const config = getDashboardConfig();
  const selected = config.widgets.map(w=>w.pid);
  content.innerHTML = `
    <div style="background:linear-gradient(145deg,#1b1f25,#101216);border:1px solid #30353d;border-radius:16px;padding:14px;color:#dce1e6;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#ff963f;letter-spacing:1px;text-transform:uppercase">Gösterge merkezi</div>
      <div style="font-size:12px;color:#89919b;margin-top:4px">Göstergeleri seç, sırala, renk ve otomobil tipi kadranını belirle.</div>
    </div>
    <div data-widget-list></div>`;
  const list=content.querySelector('[data-widget-list]');
  const ordered=[...config.widgets.map(w=>WIDGET_REGISTRY.find(r=>r.pid===w.pid)).filter(Boolean),...WIDGET_REGISTRY.filter(r=>!selected.includes(r.pid))];
  list.innerHTML=ordered.map(def=>{
    const inst=config.widgets.find(w=>w.pid===def.pid); const on=!!inst; const hue=inst?.colorHue??def.defaultColorHue; const idx=config.widgets.findIndex(w=>w.pid===def.pid);
    return `<div class="sda-card sda-widget-card" style="margin-bottom:8px;background:linear-gradient(145deg,#1d2128,#12151a)!important;border:1px solid #30353d!important;color:#eef0f3!important">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="display:flex;align-items:center;gap:9px;font-weight:650"><input type="checkbox" data-widget-toggle="${def.pid}" ${on?'checked':''}><span>${def.label}</span></label>
        ${on?`<div style="display:flex;gap:4px"><button type="button" data-move-up="${def.pid}" ${idx===0?'disabled':''}>${iconMarkup('arrow-up',{size:16})}</button><button type="button" data-move-down="${def.pid}" ${idx===config.widgets.length-1?'disabled':''}>${iconMarkup('arrow-down',{size:16})}</button></div>`:''}
      </div>
      ${on?`<div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px"><div style="display:flex;gap:5px;flex-wrap:wrap">${COLOR_PRESETS.map(h=>`<button type="button" data-set-color="${def.pid}" data-hue="${h}" aria-label="Renk" style="width:22px;height:22px;border-radius:50%;border:1px solid #555;background:hsl(${h} 90% 60%);outline:${h===hue?'2px solid #fff':'none'}"></button>`).join('')}</div><button type="button" data-open-style-picker="${def.pid}" style="background:#262b32;border:1px solid #454b54;color:#f0f2f4;border-radius:10px;padding:8px 10px;font-size:11px">${iconMarkup('palette',{size:15})} ${gaugeStyleLabel(inst.gaugeStyle)}</button></div>`:''}
    </div>`;
  }).join('');
  bind(list);
}

function bind(list){
  list.querySelectorAll('[data-widget-toggle]').forEach(el=>el.addEventListener('change',async()=>{const pid=el.dataset.widgetToggle,c=getDashboardConfig();await setDashboardWidgets(el.checked?[...c.widgets,{pid,colorHue:null,gaugeStyle:'needle'}]:c.widgets.filter(w=>w.pid!==pid));refreshEditModePanel();}));
  list.querySelectorAll('[data-move-up]').forEach(b=>b.addEventListener('click',async()=>{await moveWidget(b.dataset.moveUp,-1);refreshEditModePanel();}));
  list.querySelectorAll('[data-move-down]').forEach(b=>b.addEventListener('click',async()=>{await moveWidget(b.dataset.moveDown,1);refreshEditModePanel();}));
  list.querySelectorAll('[data-set-color]').forEach(b=>b.addEventListener('click',async()=>{await setWidgetColor(b.dataset.setColor,Number(b.dataset.hue));refreshEditModePanel();}));
  list.querySelectorAll('[data-open-style-picker]').forEach(b=>b.addEventListener('click',()=>{const pid=b.dataset.openStylePicker,c=getDashboardConfig(),i=c.widgets.find(w=>w.pid===pid);openGaugeStylePicker(pid,i?.gaugeStyle??'needle',async style=>{await setWidgetStyle(pid,style);refreshEditModePanel();});}));
}
function refreshEditModePanel(){const c=contentGetter?.();if(c)renderEditModePanel(c,contentGetter);}
function gaugeStyleLabel(style){return GAUGE_STYLE_OPTIONS.find(o=>o.value===(style??'needle'))?.label??'Kadran (İbreli)';}

function openGaugeStylePicker(pid,currentStyle,onSelect){
  const bodyHtml='<div data-style-list style="display:flex;flex-direction:column;gap:7px"></div>';
  const modal=openModal({title:'Gösterge tipi seçiniz',bodyHtml,onMount:body=>{
    const list=body.querySelector('[data-style-list]'); if(!list)return;
    list.innerHTML=GAUGE_STYLE_OPTIONS.map((o,i)=>`<button type="button" data-style-option="${o.value}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid ${o.value===currentStyle?'#ff963f':'#343a42'};background:linear-gradient(145deg,#252a30,#15181c);color:#f0f2f4;border-radius:14px;padding:9px;min-height:76px">
      <span style="width:64px;height:64px;flex:0 0 64px;display:flex;align-items:center;justify-content:center;background:#090b0e;border-radius:12px;overflow:hidden;border:1px solid #3b4148"><sda-gauge value="${55+i*5}" min="0" max="100" size="sm" variant="${o.value}" color-hue="28" label="RPM" unit="rpm"></sda-gauge></span>
      <span><strong style="display:block;font-size:14px">${o.label}</strong><small style="display:block;color:#8e969f;margin-top:3px">${o.sub}</small></span></button>`).join('');
    list.querySelectorAll('[data-style-option]').forEach(row=>row.addEventListener('click',()=>{modal.close();onSelect(row.dataset.styleOption);}));
  }});
}
async function moveWidget(pid,direction){const c=getDashboardConfig(),i=c.widgets.findIndex(w=>w.pid===pid),j=i+direction;if(i<0||j<0||j>=c.widgets.length)return;const widgets=[...c.widgets];[widgets[i],widgets[j]]=[widgets[j],widgets[i]];await setDashboardWidgets(widgets);}
