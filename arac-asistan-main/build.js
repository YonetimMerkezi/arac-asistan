/**
 * build.js
 * ---------------------------------------------------------------------------
 * Derleme betiği (esbuild).
 *
 * Neden gerekli: `www/src` altındaki modüller `@capacitor/preferences` gibi
 * npm paketlerini "çıplak" (bare) import ile kullanıyor. Android WebView'daki
 * saf tarayıcı ES Module yükleyicisi bu isimleri çözemez (node_modules
 * kavramını bilmez). esbuild, tüm bağımlılık ağacını tek bir dosyada
 * paketleyerek offline çalışabilir hale getirir - projenin "internet yoksa
 * OBD özellikleri çalışmaya devam edecek" gereksinimiyle uyumlu.
 *
 * ÖNEMLİ: Kaynak dosya yapısı (her özellik ayrı dosyada) DEĞİŞMEDİ.
 * Bu betik sadece www/src/core/app-init.js'i giriş noktası kabul edip
 * www/dist/app.bundle.js'e paketler. index.html tek bir <script> ile bu
 * paketi yükler.
 *
 * Kullanım:
 *   node build.js          → tek seferlik derleme
 *   node build.js --watch  → değişiklikte otomatik yeniden derleme
 * ---------------------------------------------------------------------------
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [path.join(__dirname, 'www/src/core/app-init.js')],
  outfile: path.join(__dirname, 'www/dist/app.bundle.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome100'],
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
};

/**
 * Derlemeyi çalıştırır. Watch modunda esbuild context API'si kullanılır.
 */
async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[build] Değişiklikler izleniyor (watch modu)...');
  } else {
    await esbuild.build(buildOptions);
    console.log('[build] Derleme tamamlandı: www/dist/app.bundle.js');
  }
}

run().catch((error) => {
  console.error('[build] Derleme hatası:', error);
  process.exit(1);
});
