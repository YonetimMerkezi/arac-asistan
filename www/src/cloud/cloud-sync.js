import { Preferences } from '@capacitor/preferences';
import { getDb } from '../data/database.js';
import { downloadSnapshot, uploadSnapshot, isFirebaseReady } from './firebase-service.js';
import { logInfo, logWarn } from '../core/logger.js';

const TABLES=['trips','trip_points','speed_corridors','fuel_purchases','maintenance_items','dtc_history'];
const LOCAL_META_KEY='sda_cloud_sync_meta_v2';

export async function collectLocalSnapshot(){
  const db=getDb();
  const tables={};
  for(const table of TABLES){
    try{const result=await db.query(`SELECT * FROM ${table}`);tables[table]=result.values??[];}catch{tables[table]=[];}
  }
  const {keys}=await Preferences.keys();
  const preferences={};
  for(const key of keys){
    if(key.startsWith('sda_firebase_'))continue;
    const {value}=await Preferences.get({key});
    preferences[key]=value;
  }
  return {formatVersion:1,createdAt:new Date().toISOString(),tables,preferences};
}

export async function syncNow(){
  if(!isFirebaseReady())return {enabled:false,uploaded:false,downloaded:false};

  const local=await collectLocalSnapshot();
  const result=await uploadSnapshot(local);
  const at=result?.clientUpdatedAt??new Date().toISOString();
  const meta={lastSyncAt:at,status:'uploaded',schemaVersion:local.formatVersion};
  localStorage.setItem(LOCAL_META_KEY,JSON.stringify(meta));
  logInfo('cloud-sync','Yerel veri Firebase ile eşitlendi.',meta);
  return {enabled:true,uploaded:true,downloaded:false,at};
}

export async function getRemoteSnapshot(){
  if(!isFirebaseReady())return null;
  const remote=await downloadSnapshot();
  if(!remote)return null;
  if(remote.payload&&!remote.payload.tables){
    logWarn('cloud-sync','Bulut yedeği beklenen biçimde değil.');
    return null;
  }
  return remote;
}

export function getLastSyncInfo(){
  try{return JSON.parse(localStorage.getItem(LOCAL_META_KEY)||'null');}catch{return null;}
}
