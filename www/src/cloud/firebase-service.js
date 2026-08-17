import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getFirebaseConfig } from './firebase-config.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

let app=null;
let auth=null;
let db=null;
let user=null;
let initialized=false;
let authUnsubscribe=null;

export async function initFirebaseService(){
  if(initialized)return {enabled:true,user};
  const config=await getFirebaseConfig();
  if(!config){logInfo('firebase','Firebase yapılandırılmamış; uygulama yerel/offline çalışıyor.');return {enabled:false,user:null};}
  try{
    app=getApps()[0]??initializeApp(config);
    auth=getAuth(app);
    db=getFirestore(app);
    initialized=true;
    authUnsubscribe=onAuthStateChanged(auth,u=>{user=u??null;});
    if(!auth.currentUser)await signInAnonymously(auth);
    user=auth.currentUser;
    await enableNetwork(db).catch(()=>{});
    logInfo('firebase','Firebase hazır.',{uid:user?.uid});
    return {enabled:true,user};
  }catch(error){
    initialized=false;
    logError('firebase','Firebase başlatılamadı',error);
    return {enabled:false,user:null,error};
  }
}

export function isFirebaseReady(){return initialized&&!!db&&!!auth?.currentUser;}
export function getFirebaseUser(){return user??auth?.currentUser??null;}

export async function uploadSnapshot(snapshot){
  if(!isFirebaseReady())throw new Error('Firebase bağlı değil.');
  const uid=getFirebaseUser()?.uid;
  if(!uid)throw new Error('Firebase kullanıcı oturumu yok.');
  await setDoc(doc(db,'users',uid,'sync','current'),{version:1,updatedAt:serverTimestamp(),payload:snapshot},{merge:false});
  return true;
}

export async function downloadSnapshot(){
  if(!isFirebaseReady())throw new Error('Firebase bağlı değil.');
  const uid=getFirebaseUser()?.uid;
  if(!uid)throw new Error('Firebase kullanıcı oturumu yok.');
  const snap=await getDoc(doc(db,'users',uid,'sync','current'));
  return snap.exists()?snap.data().payload??null:null;
}

export async function setFirebaseNetwork(online){
  if(!db)return;
  try{if(online)await enableNetwork(db);else await disableNetwork(db);}catch(error){logWarn('firebase',online?'Ağ açılamadı':'Offline moda geçilemedi',error);}
}

export function disposeFirebaseService(){authUnsubscribe?.();authUnsubscribe=null;app=null;auth=null;db=null;user=null;initialized=false;}
