import { Preferences } from '@capacitor/preferences';
import { getDb } from '../data/database.js';
import { downloadSnapshot, uploadSnapshot, isFirebaseReady } from './firebase-service.js';
import { logInfo } from '../core/logger.js';

const TABLES=['trips','trip_points','speed_corridors','fuel_purchases','maintenance_items','dtc_history'];
const LOCAL_META_KEY='sda_cloud_sync_meta_v1';

export async function collectLocalSnapshot(){
  const db=getDb();
  const tables={};
  for(const table of TABLES){
    try{const result=await db.query(`SELECT * FROM ${table}`);tables[table]=result.values??[];}catch{tables[table]=[];}
  }
  const {keys}=await Preferences.keys();
  const preferences={};
  for(const key of keys){
    // Firebase ayarları yerel cihazda kalır; tekrar buluta yazılmaz.
    if(key.startsWith('sda_firebase_'))continue;
    const {value}=await Preferences.get({key});
    preferences[key]=value;
  }
  return {formatVersion:1,createdAt:new Date().toISOString(),tables,preferences};
}

export async function syncNow(){
  if(!isFirebaseReady())return {enabled:false,uploaded:false,downloaded:false};
  const local=await collectLocalSnapshot();
  await uploadSnapshot(local);
  const meta={lastSyncAt:new Date().toISOString(),status:'uploaded'};
  localStorage.setItem(LOCAL_META_KEY,JSON.stringify(meta));
  logInfo('cloud-sync','Yerel veri Firebase ile eşitlendi.',meta);
  return {enabled:true,uploaded:true,downloaded:false,at:meta.lastSyncAt};
}

export async function getRemoteSnapshot(){
  if(!isFirebaseReady())return null;
  return downloadSnapshot();
}

export function getLastSyncInfo(){
  try{return JSON.parse(localStorage.getItem(LOCAL_META_KEY)||'null');}catch{return null;}
}
