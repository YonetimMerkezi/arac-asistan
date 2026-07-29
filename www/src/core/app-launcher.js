/**
 * app-launcher.js
 * ---------------------------------------------------------------------------
 * AppLauncherPlugin (native) için JS köprüsü + "müzik uygulaması aç" mantığı.
 *
 * Hangi müzik uygulamasının telefonda YÜKLÜ olduğunu bilmediğimiz için,
 * bilinen popüler uygulamaların paket adlarını SIRAYLA dener - ilk yüklü
 * bulduğunu açar. Hiçbiri yüklü değilse dürüstçe "yüklü müzik uygulaması
 * bulunamadı" der (sahte başarı iddia edilmez).
 * ---------------------------------------------------------------------------
 */

import { registerPlugin } from '@capacitor/core';
import { logInfo, logWarn } from './logger.js';

const AppLauncher = registerPlugin('AppLauncher');

/** @type {{label: string, packageName: string}[]} Türkiye'de yaygın müzik uygulamaları, denenme sırasıyla. */
const MUSIC_APP_CANDIDATES = [
  { label: 'Spotify', packageName: 'com.spotify.music' },
  { label: 'YouTube Music', packageName: 'com.google.android.apps.youtube.music' },
  { label: 'Fizy', packageName: 'com.turkcell.gncplay' },
  { label: 'Muud', packageName: 'com.turktelekom.muud' },
  { label: 'Deezer', packageName: 'deezer.android.app' },
  { label: 'Apple Music', packageName: 'com.apple.android.music' },
];

/**
 * Yüklü olan İLK müzik uygulamasını bulup açar.
 * @returns {Promise<{ok: true, label: string} | {ok: false}>}
 */
export async function launchMusicApp() {
  for (const candidate of MUSIC_APP_CANDIDATES) {
    try {
      const { installed } = await AppLauncher.isAppInstalled({ packageName: candidate.packageName });
      if (!installed) continue;

      await AppLauncher.launchApp({ packageName: candidate.packageName });
      logInfo('app-launcher', `${candidate.label} açıldı`);
      return { ok: true, label: candidate.label };
    } catch (error) {
      logWarn('app-launcher', `${candidate.label} açılamadı, sıradaki denenecek`, error);
    }
  }

  logWarn('app-launcher', 'Yüklü hiçbir müzik uygulaması bulunamadı');
  return { ok: false };
}
