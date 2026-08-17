import { getFirebaseConfig, saveFirebaseConfig, clearFirebaseConfig, parseFirebaseConfigText } from '../cloud/firebase-config.js';
import { initFirebaseService, isFirebaseReady, getFirebaseUser } from '../cloud/firebase-service.js';
import { syncNow, getRemoteSnapshot, getLastSyncInfo } from '../cloud/cloud-sync.js';
import { importAllData } from '../data/backup-service.js';
import { iconMarkup } from './icons.js';

export function initFirebaseSettingsPanel(){
  const container=document.querySelector('[data-view="settings"]');
  if(!container||container.querySelector('[data-firebase-panel]'))return;
  const card=document.createElement('section');
  card.setAttribute('data-firebase-panel','');
  card.innerHTML=`
    <h3 style="margin:18px 0 4px;">Bulut Yedekleme ve Senkron</h3>
    <div class="sda-card sda-firebase-card">
      <div class="sda-firebase-head">
        <div class="sda-firebase-icon">${iconMarkup('cloud', {size:22})}</div>
        <div><strong>Firebase</strong><small data-firebase-status>Yapılandırılmadı — uygulama yerel çalışıyor.</small></div>
      </div>
      <p class="sda-firebase-help">Kendi Firebase projenizin Web uygulama yapılandırmasını bir kez kaydedin. Veri eşitleme yalnızca siz etkinleştirince yapılır; Firebase yapılandırılmamışsa uygulamanın mevcut offline çalışma düzeni değişmez.</p>
      <textarea data-firebase-config rows="7" placeholder='Firebase Console → Proje ayarları → Web uygulaması\nconst firebaseConfig = { ... }'></textarea>
      <div class="sda-firebase-actions">
        <button type="button" class="sda-nav-btn" data-firebase-save>Bağla</button>
        <button type="button" class="sda-nav-btn" data-firebase-sync>Eşitle</button>
        <button type="button" class="sda-nav-btn" data-firebase-download>Buluttan Al</button>
        <button type="button" class="sda-nav-btn" data-firebase-clear>Bağlantıyı Kaldır</button>
      </div>
      <small data-firebase-message class="sda-card__label"></small>
      <small data-firebase-last class="sda-card__label"></small>
    </div>`;
  const corridorHeading=container.querySelector('[data-corridor-form]')?.previousElementSibling;
  if(corridorHeading)container.insertBefore(card,corridorHeading);else container.appendChild(card);
  injectStyles();
  bind(card);
}

async function bind(card){
  const cfg=await getFirebaseConfig();
  if(cfg)card.querySelector('[data-firebase-config]').value=JSON.stringify(cfg,null,2);
  await refreshStatus(card);
  card.querySelector('[data-firebase-save]').addEventListener('click',async()=>{
    try{
      const config=parseFirebaseConfigText(card.querySelector('[data-firebase-config]').value);
      await saveFirebaseConfig(config);
      const result=await initFirebaseService();
      if(!result.enabled)throw new Error('Firebase başlatılamadı. Config ve Firebase Console ayarlarını kontrol edin.');
      setMessage(card,'Firebase bağlantısı hazır.');
      await refreshStatus(card);
    }catch(error){setMessage(card,error?.message||'Firebase ayarı kaydedilemedi.',true);}
  });
  card.querySelector('[data-firebase-sync]').addEventListener('click',async()=>{
    try{
      await initFirebaseService();
      const result=await syncNow();
      if(!result.enabled)throw new Error('Önce Firebase bağlantısını kurun.');
      setMessage(card,`Eşitleme tamamlandı: ${new Date(result.at).toLocaleString('tr-TR')}`);
      await refreshStatus(card);
    }catch(error){setMessage(card,error?.message||'Eşitleme başarısız.',true);}
  });
  card.querySelector('[data-firebase-download]').addEventListener('click',async()=>{
    try{
      await initFirebaseService();
      const remote=await getRemoteSnapshot();
      if(!remote)throw new Error('Bulutta kayıtlı veri bulunamadı.');
      const ok=window.confirm('Buluttaki yedek mevcut yerel verilerin üzerine yazılacak. Devam edilsin mi?');
      if(!ok)return;
      await importAllData(JSON.stringify(remote));
      setMessage(card,'Bulut yedeği geri yüklendi. Uygulamayı yeniden başlatmanız önerilir.');
    }catch(error){setMessage(card,error?.message||'Bulut verisi alınamadı.',true);}
  });
  card.querySelector('[data-firebase-clear]').addEventListener('click',async()=>{
    await clearFirebaseConfig();
    card.querySelector('[data-firebase-config]').value='';
    setMessage(card,'Firebase bağlantı bilgisi bu cihazdan kaldırıldı.');
    await refreshStatus(card);
  });
}

async function refreshStatus(card){
  const status=card.querySelector('[data-firebase-status]');
  const user=getFirebaseUser();
  status.textContent=isFirebaseReady()?
    `Bağlı • anonim kullanıcı • ${user?.uid?.slice(0,8)??'—'}`:
    'Yapılandırılmadı — uygulama yerel çalışıyor.';
  const last=getLastSyncInfo();
  card.querySelector('[data-firebase-last]').textContent=last?.lastSyncAt?`Son eşitleme: ${new Date(last.lastSyncAt).toLocaleString('tr-TR')}`:'';
}
function setMessage(card,text,error=false){const el=card.querySelector('[data-firebase-message]');el.textContent=text;el.style.color=error?'var(--sda-danger,#ef4444)':'var(--sda-success,#22c55e)';}
function injectStyles(){if(document.getElementById('sda-firebase-style'))return;const s=document.createElement('style');s.id='sda-firebase-style';s.textContent=`.sda-firebase-card{margin-bottom:16px}.sda-firebase-head{display:flex;align-items:center;gap:10px}.sda-firebase-head strong,.sda-firebase-head small{display:block}.sda-firebase-head small{margin-top:2px;color:var(--sda-text-muted);font-size:.72rem}.sda-firebase-icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--sda-accent-soft);color:var(--sda-accent)}.sda-firebase-help{font-size:.78rem;line-height:1.45;color:var(--sda-text-muted)}.sda-firebase-card textarea{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--sda-hairline);border-radius:12px;padding:10px;background:var(--sda-bg-surface);color:var(--sda-text-primary);font:12px var(--sda-font-display,monospace)}.sda-firebase-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}.sda-firebase-actions .sda-nav-btn{min-width:0;padding:10px 6px}.sda-firebase-card [data-firebase-message],.sda-firebase-card [data-firebase-last]{display:block;margin-top:7px}`;document.head.appendChild(s);}
