/**
 * patch-manifest.js
 * ---------------------------------------------------------------------------
 * `npx cap add android` her CI çalışmasında AndroidManifest.xml'i sıfırdan
 * üretir (proje repoda "android/" platformunu commit etmiyor - bkz.
 * .github/workflows/build-android.yml). Bu betik, üretilen manifest'e
 * BluetoothClassicPlugin.kt'nin ihtiyaç duyduğu izinleri ekler.
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

function main() {
  const manifest = readFileSync(MANIFEST_PATH, 'utf8');

  const missingLines = REQUIRED_PERMISSIONS.filter(
    (line) => !manifest.includes(line.trim().split(' android:')[0]),
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
  console.log(`[patch-manifest] ${missingLines.length} izin satırı eklendi.`);
}

main();
