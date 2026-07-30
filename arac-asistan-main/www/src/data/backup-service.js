/**
 * backup-service.js
 * ---------------------------------------------------------------------------
 * Tüm uygulama verisini (SQLite tabloları + tüm tercihler) TEK bir JSON
 * dosyasına yedekler, ve bu dosyadan geri yükler.
 *
 * NELERİ İÇERİR:
 *  - Tüm SQLite tabloları (yolculuklar, yolculuk noktaları, ortalama hız
 *    koridorları, yakıt kayıtları, bakım kalemleri, arıza kodu geçmişi).
 *  - TÜM Capacitor Preferences anahtarları (isim, tema, birim tercihi,
 *    favori konumlar, arka plan servisi/ekran açık kalsın/telefon açılışı
 *    ayarları vb.) - Preferences.keys() ile TÜM anahtarlar okunur, tek tek
 *    anahtar adı bilmeye/listelemeye GEREK YOKTUR - ileride yeni bir ayar
 *    eklendiğinde bu dosyanın GÜNCELLENMESİ gerekmez, otomatik dahil olur.
 * ---------------------------------------------------------------------------
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Preferences } from '@capacitor/preferences';
import { getDb } from './database.js';
import { logError, logInfo } from '../core/logger.js';

/** @type {string[]} Yedeklenecek tüm SQLite tabloları (bkz. database.js şeması). */
const TABLES = ['trips', 'trip_points', 'speed_corridors', 'fuel_purchases', 'maintenance_items', 'dtc_history'];

/** @type {number} Yedek dosyası biçim sürümü - ileride şema değişirse geri yükleme bunu kontrol edebilir. */
const BACKUP_FORMAT_VERSION = 1;

/**
 * Tüm veriyi tek bir JSON dosyasına yedekler ve paylaşım/kaydetme
 * penceresini açar (kullanıcı Dosyalar'a, Drive'a, WhatsApp'a vb. kaydedebilir).
 * @returns {Promise<string>} Oluşturulan dosyanın adı.
 */
export async function exportAllData() {
  const db = getDb();
  const tables = {};

  for (const table of TABLES) {
    try {
      const result = await db.query(`SELECT * FROM ${table}`);
      tables[table] = result.values ?? [];
    } catch (error) {
      logError('backup-service', `${table} tablosu okunamadı`, error);
      tables[table] = [];
    }
  }

  const { keys } = await Preferences.keys();
  const preferences = {};
  for (const key of keys) {
    const { value } = await Preferences.get({ key });
    preferences[key] = value;
  }

  const payload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    preferences,
  };

  const fileName = `smart-drive-ai-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  const json = JSON.stringify(payload, null, 2);

  const written = await Filesystem.writeFile({
    path: fileName,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  logInfo('backup-service', `Yedek oluşturuldu: ${fileName}`);

  await Share.share({
    title: 'Smart Drive AI Veri Yedeği',
    text: `Yedek tarihi: ${payload.exportedAt}`,
    url: written.uri,
  });

  return fileName;
}

/**
 * Verilen yedek dosyasının içeriğini (exportAllData()'nın ürettiği JSON
 * metni) geri yükler. MEVCUT VERİNİN ÜZERİNE YAZAR (tablolar önce temizlenir).
 * @param {string} jsonText
 * @returns {Promise<void>}
 */
export async function importAllData(jsonText) {
  const payload = JSON.parse(jsonText);
  if (!payload || typeof payload !== 'object' || !payload.tables) {
    throw new Error('Geçersiz yedek dosyası biçimi.');
  }

  const db = getDb();

  // Yabancı anahtar kısıtlamaları nedeniyle (trip_points -> trips) önce
  // BAĞIMLI tabloyu, sonra ANA tabloyu temizlemek/doldurmak gerekir.
  const orderedTables = [...TABLES].reverse();

  for (const table of orderedTables) {
    await db.run(`DELETE FROM ${table}`);
  }

  for (const table of TABLES) {
    const rows = payload.tables[table] ?? [];
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => '?').join(', ');
      const values = columns.map((col) => row[col]);
      await db.run(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    }
  }

  if (payload.preferences) {
    for (const [key, value] of Object.entries(payload.preferences)) {
      if (value !== null && value !== undefined) {
        await Preferences.set({ key, value: String(value) });
      }
    }
  }

  logInfo('backup-service', 'Yedek geri yüklendi - uygulamanın yeniden başlatılması önerilir.');
}
