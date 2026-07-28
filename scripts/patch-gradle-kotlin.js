/**
 * patch-gradle-kotlin.js
 * ---------------------------------------------------------------------------
 * `npx cap add android` Java tabanlı bir proje şablonu üretir - Kotlin
 * Gradle eklentisi VARSAYILAN OLARAK YOK. Bu yüzden BluetoothClassicPlugin.kt,
 * BackgroundServicePlugin.kt, SmartDriveForegroundService.kt ve MainActivity.kt
 * dosyalarımız derlemeye hiç dahil edilmiyordu (sessizce atlanıyordu, hata
 * bile vermiyordu) - "plugin is not implemented on android" çalışma zamanı
 * hatasının kök nedeni buydu.
 *
 * Bu betik:
 *  1. Proje seviyesi build.gradle'a Kotlin Gradle eklentisini ekler
 *  2. Modül seviyesi (app) build.gradle'a 'kotlin-android' eklentisini ve
 *     kotlin-stdlib bağımlılığını ekler
 *  3. Otomatik üretilen MainActivity.java'yı SİLER - aynı paket/sınıf adıyla
 *     kendi MainActivity.kt'miz zaten var, ikisi birden derlenirse çakışma olur
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const PROJECT_GRADLE = 'android/build.gradle';
const APP_GRADLE = 'android/app/build.gradle';
const JAVA_MAIN_ACTIVITY = 'android/app/src/main/java/com/sedat/smartdriveai/MainActivity.java';

/** @type {string} Capacitor 6 / Android Gradle Plugin 8.x ile uyumlu, güncel bir Kotlin sürümü. */
const KOTLIN_VERSION = '1.9.24';

function patchProjectGradle() {
  let content = readFileSync(PROJECT_GRADLE, 'utf8');
  if (content.includes('kotlin-gradle-plugin')) {
    console.log('[patch-gradle-kotlin] Proje build.gradle zaten yamalı.');
    return;
  }

  const patched = content.replace(
    /classpath\s+'com\.android\.tools\.build:gradle:[^']+'/,
    (match) => `${match}\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}'`,
  );

  if (patched === content) {
    throw new Error('[patch-gradle-kotlin] android/build.gradle içinde beklenen "classpath com.android.tools.build:gradle" satırı bulunamadı.');
  }

  writeFileSync(PROJECT_GRADLE, patched, 'utf8');
  console.log('[patch-gradle-kotlin] Proje build.gradle yamalandı (Kotlin classpath eklendi).');
}

function patchAppGradle() {
  let content = readFileSync(APP_GRADLE, 'utf8');

  if (!content.includes("apply plugin: 'kotlin-android'")) {
    const withPlugin = content.replace(
      "apply plugin: 'com.android.application'",
      "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'",
    );
    if (withPlugin === content) {
      throw new Error('[patch-gradle-kotlin] android/app/build.gradle içinde "apply plugin: com.android.application" bulunamadı.');
    }
    content = withPlugin;
  }

  if (!content.includes('kotlin-stdlib')) {
    const withStdlib = content.replace(
      /dependencies\s*\{/,
      (match) => `${match}\n    implementation "org.jetbrains.kotlin:kotlin-stdlib:${KOTLIN_VERSION}"`,
    );
    if (withStdlib === content) {
      throw new Error('[patch-gradle-kotlin] android/app/build.gradle içinde "dependencies {" bloğu bulunamadı.');
    }
    content = withStdlib;
  }

  writeFileSync(APP_GRADLE, content, 'utf8');
  console.log('[patch-gradle-kotlin] Modül (app) build.gradle yamalandı (kotlin-android + kotlin-stdlib eklendi).');
}

/**
 * Kotlin derleyicisinin hedef JVM sürümünü Java derleyicisiyle (17) eşitler.
 * Aksi halde "Inconsistent JVM-target compatibility" hatası oluşur - Kotlin
 * derleyicisi varsayılan olarak kurulu JDK'nın (21) sürümünü hedeflerken,
 * Capacitor'ün sabit sourceCompatibility/targetCompatibility'si 17'de kalır.
 */
function patchKotlinJvmTarget() {
  let content = readFileSync(APP_GRADLE, 'utf8');
  if (content.includes('kotlinOptions')) {
    console.log('[patch-gradle-kotlin] Kotlin JVM hedefi zaten ayarlı.');
    return;
  }

  const block = `
tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
        jvmTarget = "17"
    }
}
`;
  writeFileSync(APP_GRADLE, content + block, 'utf8');
  console.log('[patch-gradle-kotlin] Kotlin JVM hedefi 17 olarak ayarlandı (Java ile eşleşsin diye).');
}

function removeDuplicateJavaMainActivity() {
  if (existsSync(JAVA_MAIN_ACTIVITY)) {
    unlinkSync(JAVA_MAIN_ACTIVITY);
    console.log('[patch-gradle-kotlin] Otomatik üretilen MainActivity.java silindi (MainActivity.kt kullanılacak).');
  } else {
    console.log('[patch-gradle-kotlin] MainActivity.java zaten yok, silme gerekmedi.');
  }
}

patchProjectGradle();
patchAppGradle();
patchKotlinJvmTarget();
removeDuplicateJavaMainActivity();
console.log('[patch-gradle-kotlin] Kotlin desteği başarıyla eklendi.');
