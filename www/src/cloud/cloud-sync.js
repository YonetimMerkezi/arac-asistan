import { Preferences } from '@capacitor/preferences';
import { getDb } from '../data/database.js';
import { importAllData } from '../data/backup-service.js';
import {
  downloadSnapshot,
  uploadSnapshot,
  saveConflictSnapshot,
  isFirebaseReady,
} from './firebase-service.js';
import { logInfo, logWarn } from '../core/logger.js';

const TABLES = [
  'trips',
  'trip_points',
  'speed_corridors',
  'fuel_purchases',
  'maintenance_items',
  'dtc_history',
];

const LOCAL_META_KEY = 'sda_cloud_sync_meta_v3';

/**
 * Yerel verinin tamamını tek ve deterministik bir snapshot haline getirir.
 * Preferences tarafında Firebase bağlantı ayarları snapshot'a alınmaz.
 */
export async function collectLocalSnapshot() {
  const db = getDb();
  const tables = {};

  for (const table of TABLES) {
    try {
      const result = await db.query(`SELECT * FROM ${table}`);
      tables[table] = result.values ?? [];
    } catch {
      tables[table] = [];
    }
  }

  const { keys } = await Preferences.keys();
  const preferences = {};

  for (const key of [...keys].sort()) {
    if (key.startsWith('sda_firebase_')) continue;
    if (key === LOCAL_META_KEY) continue;
    const { value } = await Preferences.get({ key });
    preferences[key] = value;
  }

  return {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    tables,
    preferences,
  };
}

function snapshotForSignature(snapshot) {
  return {
    formatVersion: snapshot?.formatVersion ?? 1,
    tables: snapshot?.tables ?? {},
    preferences: snapshot?.preferences ?? {},
  };
}

async function makeSignature(snapshot) {
  const text = JSON.stringify(snapshotForSignature(snapshot));
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Eski WebView'lar için deterministik ve yeterli bir fallback.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_META_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeMeta(meta) {
  localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta));
}

/**
 * Gerçek çift yönlü senkronizasyon:
 * - İlk eşitlemede yerel veri buluta gönderilir.
 * - Yalnızca bulut değiştiyse buluttan alınır.
 * - Yalnızca yerel değiştiyse buluta gönderilir.
 * - İki taraf da değiştiyse bulut sürümü önce conflict belgesi olarak saklanır,
 *   ardından bu kişisel uygulamada yerel sürüm korunur.
 */
export async function syncNow() {
  if (!isFirebaseReady()) {
    return { enabled: false, uploaded: false, downloaded: false, direction: 'none' };
  }

  const local = await collectLocalSnapshot();
  const localSignature = await makeSignature(local);
  const meta = readMeta();
  const remote = await downloadSnapshot();

  if (!remote || !remote.payload?.tables) {
    const result = await uploadSnapshot(local, localSignature);
    writeMeta({
      lastSyncAt: result.clientUpdatedAt,
      lastLocalSignature: localSignature,
      lastRemoteSignature: localSignature,
      status: 'uploaded',
      schemaVersion: local.formatVersion,
    });
    logInfo('cloud-sync', 'İlk yerel veri Firebase ile eşitlendi.');
    return { enabled: true, uploaded: true, downloaded: false, direction: 'upload', at: result.clientUpdatedAt };
  }

  const remoteSignature = remote.signature;

  // Aynı veri zaten iki tarafta da mevcut.
  if (remoteSignature && remoteSignature === localSignature) {
    const at = remote.clientUpdatedAt ?? new Date().toISOString();
    writeMeta({
      lastSyncAt: at,
      lastLocalSignature: localSignature,
      lastRemoteSignature: remoteSignature,
      status: 'unchanged',
      schemaVersion: local.formatVersion,
    });
    return { enabled: true, uploaded: false, downloaded: false, direction: 'unchanged', at };
  }

  // Eski sürümün oluşturduğu signature'sız kayıt: veri kaybetmemek için
  // mevcut yereli yeni senkron formatıyla buluta yazarız.
  if (!remoteSignature) {
    const result = await uploadSnapshot(local, localSignature);
    writeMeta({
      lastSyncAt: result.clientUpdatedAt,
      lastLocalSignature: localSignature,
      lastRemoteSignature: localSignature,
      status: 'migrated-upload',
      schemaVersion: local.formatVersion,
    });
    return { enabled: true, uploaded: true, downloaded: false, direction: 'upload', at: result.clientUpdatedAt };
  }

  const localChanged = !meta?.lastLocalSignature || localSignature !== meta.lastLocalSignature;
  const remoteChanged = !meta?.lastRemoteSignature || remoteSignature !== meta.lastRemoteSignature;

  // Sadece bulut değişmiş.
  if (!localChanged && remoteChanged) {
    await importAllData(JSON.stringify(remote.payload));
    const at = remote.clientUpdatedAt ?? new Date().toISOString();
    writeMeta({
      lastSyncAt: at,
      lastLocalSignature: remoteSignature,
      lastRemoteSignature: remoteSignature,
      status: 'downloaded',
      schemaVersion: remote.schemaVersion ?? 1,
    });
    logInfo('cloud-sync', 'Bulut değişiklikleri yerel veriye uygulandı.');
    return { enabled: true, uploaded: false, downloaded: true, direction: 'download', at };
  }

  // Sadece yerel değişmiş.
  if (localChanged && !remoteChanged) {
    const result = await uploadSnapshot(local, localSignature);
    writeMeta({
      lastSyncAt: result.clientUpdatedAt,
      lastLocalSignature: localSignature,
      lastRemoteSignature: localSignature,
      status: 'uploaded',
      schemaVersion: local.formatVersion,
    });
    logInfo('cloud-sync', 'Yerel değişiklikler Firebase ile eşitlendi.');
    return { enabled: true, uploaded: true, downloaded: false, direction: 'upload', at: result.clientUpdatedAt };
  }

  // İlk kez bu cihazda iki tarafın da farklı olduğu bir durum oluştuysa,
  // bulutu kaybetmeden yereli koruyoruz.
  const conflictId = await saveConflictSnapshot(remote.payload, remoteSignature);
  const result = await uploadSnapshot(local, localSignature);
  writeMeta({
    lastSyncAt: result.clientUpdatedAt,
    lastLocalSignature: localSignature,
    lastRemoteSignature: localSignature,
    status: 'conflict-local-wins',
    conflictId,
    schemaVersion: local.formatVersion,
  });
  logWarn('cloud-sync', 'Yerel ve bulut verisi aynı anda değişmişti; bulut sürümü conflict kaydı olarak korundu.', { conflictId });

  return {
    enabled: true,
    uploaded: true,
    downloaded: false,
    direction: 'conflict-local-wins',
    conflictId,
    at: result.clientUpdatedAt,
  };
}

export async function getRemoteSnapshot() {
  if (!isFirebaseReady()) return null;
  const remote = await downloadSnapshot();
  if (!remote) return null;

  const payload = remote.payload ?? remote;
  if (!payload || !payload.tables) {
    logWarn('cloud-sync', 'Bulut yedeği beklenen biçimde değil.');
    return null;
  }

  return {
    payload,
    clientUpdatedAt: remote.clientUpdatedAt ?? null,
    schemaVersion: remote.schemaVersion ?? payload.formatVersion ?? 1,
    signature: remote.signature ?? null,
  };
}

export function getLastSyncInfo() {
  return readMeta();
}
