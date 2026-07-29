/**
 * patch-manifest.js
 * ---------------------------------------------------------------------------
 * `npx cap add android` her CI çalışmasında AndroidManifest.xml'i sıfırdan
 * üretir (proje repoda "android/" platformunu commit etmiyor - bkz.
 * .github/workflows/build-android.yml). Bu betik, üretilen manifest'e
 * gerekli izinleri VE SmartDriveForegroundService kaydını ekler.
 *
 * DÜZELTME (geçmiş hata): Önceki sürüm, bir iznin manifest'te zaten olup
 * olmadığını `line.trim().split(' android:')[0]` ile kontrol ediyordu - bu
 * HER satır için aynı jenerik "<uses-permission" dizesini üretiyordu, yani
 * script tüm izinleri tek grup sanıyordu. Artık her iznin GERÇEK adı ayrı
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
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />',
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
];

/** @type {string} <application> içine (arka plan servisi) eklenecek servis kaydı. */
const SERVICE_DECLARATION = `        <service
            android:name=".SmartDriveForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="connectedDevice" />
`;

/** @type {string[]} AppLauncherPlugin'in "yüklü mü" kontrolü/başlatma yapabilmesi için
 * görünür olması gereken paket adları (bkz. core/app-launcher.js - aynı liste). */
const QUERIES_PACKAGES = [
  'com.spotify.music',
  'com.google.android.apps.youtube.music',
  'com.turkcell.gncplay',
  'com.turktelekom.muud',
  'deezer.android.app',
  'com.apple.android.music',
];

/**
 * Bir izin satırından gerçek izin adını (android:name="...") çıkarır.
 * @param {string} line
 * @returns {string}
 */
function extractPermissionKey(line) {
  const match = line.match(/android:name="([^"]+)"/);
  return match ? `android:name="${match[1]}"` : line.trim();
}

function patchPermissions(manifest) {
  const missingLines = REQUIRED_PERMISSIONS.filter(
    (line) => !manifest.includes(extractPermissionKey(line)),
  );

  if (missingLines.length === 0) {
    console.log('[patch-manifest] Tüm izinler zaten mevcut.');
    return manifest;
  }

  const insertion = `${missingLines.join('\n')}\n`;
  const patched = manifest.replace(/(<manifest[^>]*>\n)/, `$1${insertion}`);

  if (patched === manifest) {
    throw new Error('[patch-manifest] <manifest> etiketi bulunamadı, izin eklenemedi.');
  }

  console.log(`[patch-manifest] ${missingLines.length} izin satırı eklendi: ${missingLines.map(extractPermissionKey).join(', ')}`);
  return patched;
}

function patchServiceDeclaration(manifest) {
  if (manifest.includes('SmartDriveForegroundService')) {
    console.log('[patch-manifest] Servis kaydı zaten mevcut.');
    return manifest;
  }

  const patched = manifest.replace(/(\s*<\/application>)/, `\n${SERVICE_DECLARATION}$1`);

  if (patched === manifest) {
    throw new Error('[patch-manifest] </application> etiketi bulunamadı, servis kaydedilemedi.');
  }

  console.log('[patch-manifest] SmartDriveForegroundService kaydedildi.');
  return patched;
}

/**
 * Android 11+ (API 30+) paket görünürlüğü için <queries> bloğunu ekler -
 * bu olmadan AppLauncherPlugin.kt başka hiçbir uygulamayı (müzik uygulamaları
 * dahil) "yüklü mü" diye göremez veya başlatamaz.
 * @param {string} manifest
 * @returns {string}
 */
function patchQueries(manifest) {
  if (manifest.includes('<queries>')) {
    console.log('[patch-manifest] <queries> bloğu zaten mevcut.');
    return manifest;
  }

  const packageLines = QUERIES_PACKAGES
    .map((pkg) => `        <package android:name="${pkg}" />`)
    .join('\n');
  const block = `    <queries>\n${packageLines}\n    </queries>\n`;

  const patched = manifest.replace(/(<manifest[^>]*>\n)/, `$1${block}`);

  if (patched === manifest) {
    throw new Error('[patch-manifest] <manifest> etiketi bulunamadı, <queries> eklenemedi.');
  }

  console.log(`[patch-manifest] <queries> bloğu eklendi (${QUERIES_PACKAGES.length} paket).`);
  return patched;
}

function main() {
  let manifest = readFileSync(MANIFEST_PATH, 'utf8');
  manifest = patchPermissions(manifest);
  manifest = patchServiceDeclaration(manifest);
  manifest = patchQueries(manifest);
  writeFileSync(MANIFEST_PATH, manifest, 'utf8');
}

main();
