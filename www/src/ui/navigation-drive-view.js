/**
 * Smart Drive AI — Navigation Drive View
 * Faz 2.2 — sürüş odaklı navigasyon + dönüş rehberi.
 */
import L from 'leaflet';
import { searchAddress } from '../maps/forward-geocode.js';
import { getDrivingRoute } from '../maps/route-service.js';
import { onPosition, getLastPosition } from '../core/gps-tracker.js';
import { getSpeedLimitNear } from '../maps/speed-limit-service.js';
import { getCachedCameras, onCamerasUpdate } from '../maps/speed-camera-service.js';
import { getLivePidValue, onLiveDataChange } from '../core/vehicle-live-data-store.js';
import { estimateLitersPerHour, estimateLitersPer100Km } from '../fuel/instant-consumption.js';
import { onViewChange } from '../core/view-router.js';

const S = {
  map:null, vehicleMarker:null, routeLine:null, destMarker:null,
  cameraMarkers:[], posUnsubscribe:null, liveUnsubscribe:null, cameraUnsubscribe:null,
  follow:false, navigationActive:false, fullscreen:false, initialized:false,
  dest:null, lastPos:null, speedLimit:null, lastHeading:0, lastZoom:null,
  routeCoords:[], routeDistances:[], routeTotalKm:0, routeProgressIndex:0,
  routeSteps:[], nextStepIndex:0, deviationSince:0, rerouteBusy:false,
  searchTimer:null, searchSeq:0, speedLimitAt:0, lastCameraAt:0,
};

const el=id=>document.getElementById(id);
const txt=(id,v)=>{const n=el(id);if(n)n.textContent=v??'';};
const display=(id,v)=>{const n=el(id);if(n)n.style.display=v;};
const msg=v=>txt('ndv-msg',v);

function ensureLayout(){
  const view=document.querySelector('[data-view="navigation-drive"]');
  if(!view)return null;
  if(view.querySelector('#ndv-root'))return view;
  view.innerHTML=`<div id="ndv-root">
    <div id="ndv-search-row"><div id="ndv-search-box"><span id="ndv-search-icon">⌕</span><input id="ndv-input" type="search" placeholder="Nereye gidiyorsun?" autocomplete="off"><button id="ndv-clear-search" type="button">×</button></div><button id="ndv-search-btn" class="ndv-btn" type="button">Ara</button></div>
    <div id="ndv-suggestions"></div>
    <div id="ndv-map-wrap"><div id="ndv-map"></div><div id="ndv-loading"><div class="ndv-spinner"></div><strong>Harita hazırlanıyor</strong><span>Konum alınıyor…</span></div>
      <div id="ndv-top-info"><div id="ndv-speed-card"><strong id="ndv-speed-val">0</strong><span>km/sa</span></div><div id="ndv-limit-badge"><span id="ndv-limit-val">--</span></div></div>
      <div id="ndv-camera-badge" style="display:none">● Radar</div><div id="ndv-heading-badge">N</div>
      <button id="ndv-follow-btn" type="button">◎</button><button id="ndv-fullscreen-exit" type="button">×</button>
      <div id="ndv-route-banner"><span id="ndv-route-next">Navigasyon</span><strong id="ndv-route-remaining">--</strong></div>
    </div>
    <div id="ndv-stats"><div class="ndv-stat"><span>HIZ</span><strong id="ndv-stat-speed">0</strong><small>km/sa</small></div><div class="ndv-stat"><span>LİMİT</span><strong id="ndv-stat-limit">--</strong><small>km/sa</small></div><div class="ndv-stat"><span>TÜKETİM</span><strong id="ndv-stat-cons">--</strong><small>L/100 km</small></div><div class="ndv-stat"><span>MESAFE</span><strong id="ndv-stat-dist">--</strong><small>km</small></div><div class="ndv-stat"><span>VARIŞ</span><strong id="ndv-stat-eta">--</strong><small>ETA</small></div></div>
    <div id="ndv-shortcuts"><button data-dest="locate">⌖<span>Konumum</span></button><button data-dest="home">⌂<span>Ev</span></button><button data-dest="work">▣<span>İş</span></button></div>
    <div id="ndv-summary"><div class="ndv-summary-main"><span class="ndv-summary-icon">➤</span><div><strong id="ndv-sum-label">--</strong><small>Hedef</small></div></div><div class="ndv-summary-item"><strong id="ndv-sum-dist">--</strong><small>Mesafe</small></div><div class="ndv-summary-item"><strong id="ndv-sum-dur">--</strong><small>Süre</small></div></div>
    <div id="ndv-action-row"><button id="ndv-start-btn" type="button">➤ Navigasyonu Başlat</button><button id="ndv-cancel-btn" type="button">İptal</button></div><p id="ndv-msg">Navigasyon hazır.</p>
  </div>`;
  return view;
}

function injectCss(){
 if(el('ndv-style'))return;
 const s=document.createElement('style');s.id='ndv-style';s.textContent=`
[data-view="navigation-drive"]{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;display:flex!important;overflow:hidden!important;box-sizing:border-box!important;background:var(--sda-bg-base,#0f1218);color:var(--sda-text-primary,#fff)}
#ndv-root{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;padding:8px;gap:7px;overflow:hidden}
#ndv-search-row{display:flex;gap:7px;flex:0 0 auto;min-width:0}#ndv-search-box{position:relative;display:flex;align-items:center;flex:1;min-width:0;height:44px;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));border-radius:14px;background:var(--sda-bg-elevated,#191e27);overflow:hidden}#ndv-search-icon{margin-left:12px;font-size:22px;opacity:.7}#ndv-input{width:100%;height:100%;padding:0 38px 0 10px;border:0;outline:0;background:transparent;color:inherit;font-size:14px;box-sizing:border-box}#ndv-clear-search{position:absolute;right:5px;top:50%;transform:translateY(-50%);border:0;background:none;color:var(--sda-text-muted,#8992a3);font-size:20px}.ndv-btn{height:44px;padding:0 14px;border:0;border-radius:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-weight:800}
#ndv-suggestions{display:none;max-height:210px;overflow:auto;flex:0 0 auto;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));border-radius:13px;background:var(--sda-bg-elevated,#191e27);z-index:5000;box-shadow:0 12px 30px rgba(0,0,0,.3)}#ndv-suggestions button{width:100%;padding:12px;text-align:left;border:0;border-bottom:1px solid var(--sda-hairline,rgba(255,255,255,.08));background:none;color:inherit;font-size:13px}
#ndv-map-wrap{position:relative;flex:1 1 0;min-width:0;min-height:0;overflow:hidden;border-radius:18px;border:1px solid var(--sda-hairline,rgba(255,255,255,.12));background:#d8dde4}#ndv-map{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
#ndv-map.ndv-bearing .leaflet-tile-pane,#ndv-map.ndv-bearing .leaflet-overlay-pane,#ndv-map.ndv-bearing .leaflet-shadow-pane,#ndv-map.ndv-bearing .leaflet-marker-pane,#ndv-map.ndv-bearing .leaflet-tooltip-pane,#ndv-map.ndv-bearing .leaflet-popup-pane{transform:rotate(var(--ndv-bearing,0deg));transform-origin:50% 50%;will-change:transform}
#ndv-loading{position:absolute;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:rgba(8,12,18,.82);color:#fff}#ndv-loading.hidden{display:none}.ndv-spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,.18);border-top-color:#22c55e;border-radius:50%;animation:ndvspin .8s linear infinite}@keyframes ndvspin{to{transform:rotate(360deg)}}
#ndv-top-info{position:absolute;top:10px;left:50px;z-index:900;display:flex;gap:8px;pointer-events:none}#ndv-speed-card{width:62px;height:62px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(14,17,24,.92);border:3px solid rgba(255,255,255,.25)}#ndv-speed-card strong{font-size:21px;color:#fff}#ndv-speed-card span{font-size:8px;color:#bbb}#ndv-limit-badge{width:46px;height:46px;border-radius:50%;background:#fff;border:4px solid #e02020;display:flex;align-items:center;justify-content:center}#ndv-limit-val{color:#111;font-weight:900}
#ndv-follow-btn{position:absolute;right:10px;bottom:10px;z-index:1000;width:46px;height:46px;border:0;border-radius:50%;background:rgba(14,17,24,.92);color:#fff;font-size:22px}#ndv-follow-btn.active{outline:3px solid #22c55e}#ndv-fullscreen-exit{display:none;position:absolute;right:10px;top:10px;z-index:1200;width:42px;height:42px;border:0;border-radius:50%;background:rgba(14,17,24,.82);color:#fff;font-size:24px}#ndv-heading-badge{position:absolute;right:62px;top:14px;z-index:900;width:34px;height:34px;border-radius:50%;background:#fff;color:#dc2626;display:flex;align-items:center;justify-content:center;font-weight:900}
#ndv-camera-badge{position:absolute;right:10px;bottom:64px;z-index:900;background:rgba(220,38,38,.9);color:#fff;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:800}#ndv-route-banner{display:none;position:absolute;left:10px;right:60px;bottom:10px;z-index:900;padding:9px 12px;border-radius:12px;background:rgba(14,17,24,.92);color:#fff;align-items:center;justify-content:space-between;gap:10px}#ndv-route-next{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:700}#ndv-route-remaining{flex:0 0 auto;font-size:12px}
#ndv-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;flex:0 0 auto}.ndv-stat{min-width:0;padding:8px 3px;text-align:center;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:11px;background:var(--sda-bg-elevated,#191e27);overflow:hidden}.ndv-stat span,.ndv-stat small{display:block;font-size:7px;color:var(--sda-text-muted,#8992a3)}.ndv-stat strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ndv-shortcuts{display:flex;gap:7px;flex:0 0 auto}#ndv-shortcuts button{flex:1;padding:9px 4px;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:11px;background:var(--sda-bg-elevated,#191e27);color:inherit;font-size:11px;font-weight:700}#ndv-shortcuts button span{display:block}#ndv-summary{display:none;align-items:center;gap:8px;min-width:0;flex:0 0 auto;padding:9px 10px;border:1px solid var(--sda-hairline,rgba(255,255,255,.1));border-radius:13px;background:var(--sda-bg-elevated,#191e27)}.ndv-summary-main{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.ndv-summary-main>div{min-width:0}.ndv-summary-main strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.ndv-summary-main small,.ndv-summary-item small{display:block;font-size:8px;color:var(--sda-text-muted,#8992a3)}.ndv-summary-icon{width:30px;height:30px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#16a34a;color:#fff}.ndv-summary-item{flex:0 0 auto;min-width:58px;text-align:right}.ndv-summary-item strong{display:block;font-size:12px;white-space:nowrap}
#ndv-action-row{display:none;gap:7px;flex:0 0 auto}#ndv-start-btn{flex:1;padding:12px;border:0;border-radius:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:14px;font-weight:900}#ndv-cancel-btn{padding:12px 14px;border:0;border-radius:13px;background:var(--sda-danger-soft,rgba(255,90,95,.14));color:var(--sda-danger,#ff5a5f);font-weight:800}#ndv-msg{margin:0;text-align:center;font-size:10px;color:var(--sda-text-muted,#8992a3)}
#ndv-root.ndv-fullscreen{position:fixed;inset:0;z-index:99999;width:100vw!important;height:100dvh!important;padding:0!important;gap:0!important;background:#10141b}#ndv-root.ndv-fullscreen #ndv-search-row,#ndv-root.ndv-fullscreen #ndv-suggestions,#ndv-root.ndv-fullscreen #ndv-stats,#ndv-root.ndv-fullscreen #ndv-shortcuts,#ndv-root.ndv-fullscreen #ndv-summary,#ndv-root.ndv-fullscreen #ndv-action-row,#ndv-root.ndv-fullscreen #ndv-msg{display:none!important}#ndv-root.ndv-fullscreen #ndv-map-wrap{border:0;border-radius:0}#ndv-root.ndv-fullscreen #ndv-fullscreen-exit{display:block}
`;
 document.head.appendChild(s);
}

function initMap(lat,lon){
 if(S.map)return;
 const c=el('ndv-map');if(!c)return;
 S.map=L.map(c,{center:[lat,lon],zoom:17,zoomControl:true,attributionControl:true,preferCanvas:true});
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'}).addTo(S.map);
 S.vehicleMarker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:'<div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:28px solid #ff7a18;filter:drop-shadow(0 2px 4px #0008)"></div>',iconSize:[20,28],iconAnchor:[10,14]}),zIndexOffset:1000}).addTo(S.map);
 S.map.on('dragstart',()=>{if(S.navigationActive){S.follow=false;el('ndv-follow-btn')?.classList.remove('active')}});
 [0,100,300,700].forEach(t=>setTimeout(()=>S.map?.invalidateSize(true),t));
 el('ndv-loading')?.classList.add('hidden');
}
function hav(a,b){const R=6371,d1=(b.lat-a.lat)*Math.PI/180,d2=(b.lon-a.lon)*Math.PI/180,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,x=Math.sin(d1/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(d2/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function bearing(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,d=(b.lon-a.lon)*Math.PI/180;return(Math.atan2(Math.sin(d)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(d))*180/Math.PI+360)%360;}
function smooth(h){let d=((h-S.lastHeading+540)%360)-180;if(Math.abs(d)>100)d*=.35;S.lastHeading=(S.lastHeading+d*.25+360)%360;return S.lastHeading;}
function applyBearing(h){const m=el('ndv-map');if(!m||!S.navigationActive)return;m.classList.add('ndv-bearing');m.style.setProperty('--ndv-bearing',`${-h}deg`);const dirs=['N','NE','E','SE','S','SW','W','NW'];txt('ndv-heading-badge',dirs[Math.round(h/45)%8]);}
function zoomForSpeed(v){if(v<10)return 18;if(v<30)return 17;if(v<55)return 16;if(v<85)return 15;if(v<115)return 14;return 13;}
function buildRouteMetrics(coords){S.routeCoords=(coords||[]).map(p=>({lat:Number(p[0]),lon:Number(p[1])})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));S.routeDistances=new Array(S.routeCoords.length).fill(0);for(let i=1;i<S.routeCoords.length;i++)S.routeDistances[i]=S.routeDistances[i-1]+hav(S.routeCoords[i-1],S.routeCoords[i]);S.routeTotalKm=S.routeDistances.at(-1)||0;S.routeProgressIndex=0;}
function routeProgress(pos){if(S.routeCoords.length<2)return{remaining:S.dest?.distKm||0,index:0,next:null};let start=Math.max(0,S.routeProgressIndex-12),end=Math.min(S.routeCoords.length-1,S.routeProgressIndex+100),best=Infinity,idx=S.routeProgressIndex;for(let i=start;i<=end;i++){const d=hav(pos,S.routeCoords[i]);if(d<best){best=d;idx=i;}}S.routeProgressIndex=Math.max(S.routeProgressIndex,idx);const remaining=Math.max(0,S.routeTotalKm-(S.routeDistances[S.routeProgressIndex]||0));const next=S.routeCoords[Math.min(S.routeProgressIndex+1,S.routeCoords.length-1)];return{remaining,index:S.routeProgressIndex,next,distanceFromRoute:best};}
function stepDistance(pos,step){return step?.location?hav(pos,{lat:step.location[0],lon:step.location[1]}):Infinity;}
function updateStepGuidance(pos,speed){
 if(!S.navigationActive||!S.routeSteps.length)return;
 while(S.nextStepIndex<S.routeSteps.length-1 && stepDistance(pos,S.routeSteps[S.nextStepIndex])<0.035)S.nextStepIndex++;
 const step=S.routeSteps[S.nextStepIndex];
 if(!step)return;
 const d=stepDistance(pos,step);
 let text=step.instruction;
 if(d<0.03)text=`Şimdi ${text.toLowerCase()}`;
 else if(d<0.08)text=`Yaklaşık ${Math.round(d*1000)} m sonra ${text.toLowerCase()}`;
 else if(d<0.25)text=`${Math.round(d*1000)} m sonra ${text.toLowerCase()}`;
 else text=`${d.toFixed(1)} km sonra ${text.toLowerCase()}`;
 txt('ndv-route-next',text);
}
async function rerouteIfNeeded(pos,offRouteKm){
 if(!S.navigationActive||!S.dest||S.rerouteBusy||offRouteKm<0.06)return;
 const now=Date.now();
 if(!S.deviationSince)S.deviationSince=now;
 if(now-S.deviationSince<2500)return;
 S.rerouteBusy=true;msg('Rotadan çıktınız. Yeni rota hesaplanıyor…');
 try{
   const routes=await getDrivingRoute({lat:pos.latitude,lon:pos.longitude},{lat:S.dest.lat,lon:S.dest.lon},{destinationLabel:S.dest.label,cache:false});
   if(routes?.length){const best=routes[0];S.routeLine?.remove();S.routeLine=L.polyline(best.coordinates,{color:'#2563eb',weight:7,opacity:.9,lineJoin:'round'}).addTo(S.map);S.dest={...S.dest,distKm:best.distanceKm,durationMin:best.durationMinutes};buildRouteMetrics(best.coordinates);S.routeSteps=best.steps||[];S.nextStepIndex=0;msg('Yeni rota hazır.');}
 }catch(e){console.error(e);msg('Yeni rota hesaplanamadı.');}
 S.deviationSince=0;S.rerouteBusy=false;
}
function updateRouteProgress(pos,speed){
 if(!S.dest||!S.routeCoords.length)return;
 const p=routeProgress({lat:pos.latitude,lon:pos.longitude});
 const fallbackSpeed=Math.max(25,S.dest.distKm/(Math.max(.01,S.dest.durationMin/60)));const v=speed>=5?speed:fallbackSpeed;const eta=p.remaining/v*60;
 const remainingText=p.remaining>=1?`${p.remaining.toFixed(1)} km`:`${Math.round(p.remaining*1000)} m`;
 txt('ndv-stat-dist',remainingText);const d=new Date(Date.now()+eta*60000);txt('ndv-stat-eta',`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);txt('ndv-route-remaining',remainingText);
 updateStepGuidance({lat:pos.latitude,lon:pos.longitude},speed);
 rerouteIfNeeded(pos,p.distanceFromRoute);
 if(p.remaining<.03){msg('Hedefe ulaştınız.');S.navigationActive=false;S.follow=false;display('ndv-route-banner','none');exitFullscreen();}
}
function updateCamera(pos){if(!S.map||!S.navigationActive||!S.follow)return;const z=zoomForSpeed(Number(pos.speedKmh)||0);if(z!==S.lastZoom){S.lastZoom=z;S.map.setZoom(z,{animate:true,duration:.4});}const target=L.latLng(pos.latitude,pos.longitude);S.map.panTo(target,{animate:true,duration:.35,easeLinearity:.2});}
function onNewPosition(pos){
 if(!pos)return;S.lastPos=pos;if(!S.map)initMap(pos.latitude,pos.longitude);if(!S.map)return;
 S.vehicleMarker?.setLatLng([pos.latitude,pos.longitude]);const speed=Math.round(Number(pos.speedKmh)||0);txt('ndv-speed-val',speed);txt('ndv-stat-speed',speed);
 let h=Number(pos.headingDeg);if(!Number.isFinite(h)||h<0||h>360)h=S.routeCoords.length?bearing({lat:pos.latitude,lon:pos.longitude},S.routeCoords[Math.min(S.routeProgressIndex+2,S.routeCoords.length-1)]):S.lastHeading;if(S.navigationActive&&speed>=2)applyBearing(smooth(h));updateCamera(pos);if(S.dest)updateRouteProgress(pos,speed);
 const now=Date.now();if(now-S.speedLimitAt>5000){S.speedLimitAt=now;getSpeedLimitNear(pos.latitude,pos.longitude).then(l=>{S.speedLimit=l;txt('ndv-limit-val',l==null?'--':l);txt('ndv-stat-limit',l==null?'--':l);}).catch(()=>{});}if(now-S.lastCameraAt>3000){S.lastCameraAt=now;checkCameras();}
}
function onLiveData(){const maf=getLivePidValue('10'),spd=getLivePidValue('0D');if(!maf)return;const lph=estimateLitersPerHour(maf.value),kmh=spd?spd.value:(S.lastPos?.speedKmh||0),v=estimateLitersPer100Km(lph,kmh);txt('ndv-stat-cons',v!=null?v.toFixed(1):lph.toFixed(1));}
function checkCameras(){const c=getCachedCameras();const b=el('ndv-camera-badge');if(b)b.style.display=c.length?'block':'none';}
function renderCameraMarkers(c){if(!S.map)return;S.cameraMarkers.forEach(m=>S.map.removeLayer(m));S.cameraMarkers=(c||[]).slice(0,20).map(x=>L.circleMarker([x.lat,x.lon],{radius:7,color:'#dc2626',fillOpacity:.75}).addTo(S.map).bindPopup('📸 Radar'));}

async function routeTo(dest){
 if(!S.map||!dest)return;const from=S.lastPos||getLastPosition();if(!from){msg('Konum henüz alınamadı.');return;}msg('Rota hesaplanıyor…');
 try{
  const routes=await getDrivingRoute({lat:from.latitude,lon:from.longitude},{lat:dest.lat,lon:dest.lon},{destinationLabel:dest.label});if(!routes?.length){msg('Rota bulunamadı.');return;}
  const best=routes[0];S.routeLine?.remove();S.destMarker?.remove();S.routeLine=L.polyline(best.coordinates,{color:'#2563eb',weight:7,opacity:.9,lineJoin:'round'}).addTo(S.map);S.destMarker=L.marker([dest.lat,dest.lon]).addTo(S.map).bindPopup(dest.label);
  S.dest={...dest,distKm:best.distanceKm,durationMin:best.durationMinutes};buildRouteMetrics(best.coordinates);S.routeSteps=best.steps||[];S.nextStepIndex=0;S.deviationSince=0;
  const dist=best.distanceKm>=1?`${best.distanceKm.toFixed(1)} km`:`${Math.round(best.distanceKm*1000)} m`;txt('ndv-sum-label',dest.label);txt('ndv-sum-dist',dist);txt('ndv-sum-dur',`~${Math.round(best.durationMinutes)} dk`);display('ndv-summary','flex');display('ndv-action-row','flex');display('ndv-shortcuts','none');S.navigationActive=false;S.follow=false;display('ndv-route-banner','none');S.map.fitBounds(S.routeLine.getBounds(),{padding:[40,40],maxZoom:16,animate:true});txt('ndv-stat-dist',dist);txt('ndv-stat-eta',(()=>{const d=new Date(Date.now()+best.durationMinutes*60000);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`})());msg(`${dest.label} · ${dist} · ~${Math.round(best.durationMinutes)} dk`);
 }catch(e){console.error(e);msg('Rota hesaplanamadı. İnternet bağlantısını kontrol edin.');}
}
function cancelRoute(){S.routeLine?.remove();S.destMarker?.remove();S.routeLine=null;S.destMarker=null;S.dest=null;S.routeCoords=[];S.routeDistances=[];S.routeSteps=[];S.navigationActive=false;S.follow=false;S.deviationSince=0;el('ndv-map')?.classList.remove('ndv-bearing');display('ndv-summary','none');display('ndv-action-row','none');display('ndv-shortcuts','flex');display('ndv-route-banner','none');exitFullscreen();msg('Rota iptal edildi.');}
function shortLabel(x=''){return String(x).split(',').slice(0,3).join(',').trim();}
function esc(x=''){return String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function hideSuggestions(){const b=el('ndv-suggestions');if(b){b.style.display='none';b.innerHTML='';}}
function showSuggestions(rs){const b=el('ndv-suggestions');if(!b)return;b.innerHTML=(rs||[]).map((r,i)=>`<button type="button" data-i="${i}"><strong>${esc(shortLabel(r.label))}</strong></button>`).join('');if(!rs?.length){hideSuggestions();return;}b.style.display='block';b.querySelectorAll('[data-i]').forEach(x=>x.addEventListener('click',async()=>{const r=rs[Number(x.dataset.i)];el('ndv-input').value=shortLabel(r.label);hideSuggestions();await routeTo({lat:r.lat,lon:r.lon,label:shortLabel(r.label)});}));}
async function liveSearch(q){const v=q.trim();if(v.length<3){hideSuggestions();return;}const seq=++S.searchSeq;try{const rs=await searchAddress(v,5);if(seq===S.searchSeq)showSuggestions(rs);}catch{if(seq===S.searchSeq)hideSuggestions();}}
async function routeToSearch(q){hideSuggestions();await liveSearch(q);const b=el('ndv-suggestions');if(b?.children.length===1)b.children[0].click();}
async function favorite(id){try{const m=await import('../maps/favorites-store.js'),f=m.getFavoriteLocation(id);if(!f){msg(`${id==='home'?'Ev':'İş'} konumu henüz ayarlanmadı.`);return;}await routeTo({lat:f.lat,lon:f.lon??f.lng,label:f.label??(id==='home'?'Ev':'İş')});}catch{msg('Favori konuma rota çizilemedi.');}}
async function enterFullscreen(){const r=el('ndv-root');if(!r)return;r.classList.add('ndv-fullscreen');S.fullscreen=true;try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}catch{}setTimeout(()=>S.map?.invalidateSize(true),100);}
async function exitFullscreen(){const r=el('ndv-root');r?.classList.remove('ndv-fullscreen');S.fullscreen=false;try{if(document.fullscreenElement&&document.exitFullscreen)await document.exitFullscreen();}catch{}setTimeout(()=>S.map?.invalidateSize(true),100);}

export async function initNavigationDriveView(){
 injectCss();const view=ensureLayout();if(!view||S.initialized)return;S.initialized=true;S.posUnsubscribe=onPosition(onNewPosition);S.liveUnsubscribe=onLiveDataChange(onLiveData);S.cameraUnsubscribe=onCamerasUpdate(renderCameraMarkers);const last=getLastPosition();if(last){initMap(last.latitude,last.longitude);onNewPosition(last);}else setTimeout(()=>{if(!S.map){initMap(39,35);msg('GPS konumu bekleniyor…');}},1500);
 el('ndv-search-btn')?.addEventListener('click',()=>{const q=el('ndv-input')?.value.trim();if(q)routeToSearch(q);});
 el('ndv-input')?.addEventListener('input',e=>{clearTimeout(S.searchTimer);S.searchTimer=setTimeout(()=>liveSearch(e.target.value),350);});
 el('ndv-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const q=e.target.value.trim();if(q)routeToSearch(q);}});
 el('ndv-clear-search')?.addEventListener('click',()=>{el('ndv-input').value='';hideSuggestions();el('ndv-input').focus();});
 el('ndv-start-btn')?.addEventListener('click',async()=>{if(!S.dest)return;S.navigationActive=true;S.follow=true;el('ndv-follow-btn')?.classList.add('active');S.lastZoom=18;if(S.lastPos){let h=Number(S.lastPos.headingDeg);if(!Number.isFinite(h)||h<0||h>360)h=S.routeCoords.length?bearing({lat:S.lastPos.latitude,lon:S.lastPos.longitude},S.routeCoords[Math.min(2,S.routeCoords.length-1)]):0;S.lastHeading=h;applyBearing(h);S.map?.setView([S.lastPos.latitude,S.lastPos.longitude],18,{animate:true});}display('ndv-route-banner','flex');await enterFullscreen();msg('Navigasyon başladı. İyi yolculuklar!');});
 el('ndv-follow-btn')?.addEventListener('click',()=>{S.follow=true;S.navigationActive=true;el('ndv-follow-btn')?.classList.add('active');if(S.lastPos){S.lastZoom=zoomForSpeed(Number(S.lastPos.speedKmh)||0);S.map?.setView([S.lastPos.latitude,S.lastPos.longitude],S.lastZoom,{animate:true});}});
 el('ndv-fullscreen-exit')?.addEventListener('click',exitFullscreen);el('ndv-cancel-btn')?.addEventListener('click',cancelRoute);
 view.querySelectorAll('#ndv-shortcuts [data-dest]').forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.dest;if(id==='locate'){S.follow=true;if(S.lastPos)S.map?.setView([S.lastPos.latitude,S.lastPos.longitude],18,{animate:true});}else await favorite(id);}));
 onViewChange(v=>{if(v==='navigation-drive')requestAnimationFrame(()=>S.map?.invalidateSize(true));else if(S.fullscreen)exitFullscreen();});
 document.addEventListener('click',e=>{if(!e.target.closest('#ndv-suggestions')&&!e.target.closest('#ndv-search-box'))hideSuggestions();},{passive:true});window.addEventListener('resize',()=>S.map?.invalidateSize(true));
}
export function destroyNavigationDriveView(){S.posUnsubscribe?.();S.liveUnsubscribe?.();S.cameraUnsubscribe?.();clearTimeout(S.searchTimer);exitFullscreen();S.cameraMarkers.forEach(m=>S.map?.removeLayer(m));try{S.map?.remove();}catch{}Object.assign(S,{map:null,vehicleMarker:null,routeLine:null,destMarker:null,cameraMarkers:[],posUnsubscribe:null,liveUnsubscribe:null,cameraUnsubscribe:null,follow:false,navigationActive:false,dest:null,lastPos:null,routeCoords:[],routeDistances:[],routeTotalKm:0,routeProgressIndex:0,routeSteps:[],nextStepIndex:0,deviationSince:0,rerouteBusy:false,initialized:false});}
