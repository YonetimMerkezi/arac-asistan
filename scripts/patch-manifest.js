/**
 * patch-manifest.js
 * ---------------------------------------------------------------------------
 * `npx cap add android` her CI çalışmasında AndroidManifest.xml'i sıfırdan
 * üretir (proje repoda "android/" platformunu commit etmiyor - bkz.
 * .github/workflows/build-android.yml). Bu betik, üretilen manifest'e
 * BluetoothClassicPlugin.kt/gps-tracker.js gibi modüllerin ihtiyaç duyduğu
 * izinleri ekler.
 *
 * DÜZELTME (kritik hata): Önceki sürüm, bir iznin manifest'te zaten olup
 * olmadığını `line.trim().split(' android:')[0]` ile kontrol ediyordu.
 * Bu, HER izin satırı için aynı jenerik "<uses-permission" dizesini üretiyordu
 * (çünkü her satırda "android:name=" öncesinde bir boşluk var) - yani script
 * tüm izinleri TEK bir grup olarak görüyor, biri "zaten var" sanılırsa hepsi
 * atlanabiliyordu. Bu yüzden ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION
 * hiç eklenmemişti. Artık her iznin GERÇEK adı (android:name="...") ayrı
 * ayrı kontrol ediliyor.
 *
 * Node.js'in yerleşik `fs` modülü dışında bağımlılık kullanılmaz.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';

/** @type {string[]} Eklenecek izin satırları (zaten varsa tekrar eklenmez). */
const REQUIRED_PERMISSIONS = [
  '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
  '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '    <uses-permission android:name="android.permission.INTERNET" />',
  '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
];

/**
 * Bir izin satırından gerçek izin adını (android:name="...") çıkarır.
 * @param {string} line
 * @returns {string} ör. `android:name="android.permission.RECORD_AUDIO"`.
 */
function extractPermissionKey(line) {
  const match = line.match(/android:name="([^"]+)"/);
  return match ? `android:name="${match[1]}"` : line.trim();
}

function main() {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');

  const missingLines = REQUIRED_PERMISSIONS.filter(
    (line) => !manifest.includes(extractPermissionKey(line)),
  );

  if (missingLines.length === 0) {
    console.log('[patch-manifest] Tüm izinler zaten mevcut, değişiklik yapılmadı.');
    return;
  }

  const insertion = `${missingLines.join('\n')}\n`;
  const patched = manifest.replace(
    /(<manifest[^>]*>\n)/,
    `$1${insertion}`,
  );

  if (patched === manifest) {
    throw new Error('[patch-manifest] <manifest> etiketi bulunamadı, ekleme yapılamadı.');
  }

  writeFileSync(MANIFEST_PATH, patched, 'utf8');
  console.log(`[patch-manifest] ${missingLines.length} izin satırı eklendi: ${missingLines.map(extractPermissionKey).join(', ')}`);
}

main();
