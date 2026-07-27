/**
 * greeting.js
 * ---------------------------------------------------------------------------
 * Bağlantı kurulduğunda okunan karşılama cümlesi.
 *
 * app-init.js'teki ELM327 başlatma dizisi tamamlanır tamamlanmaz çağrılır.
 * Dashboard'un poll döngüsünün ilk turunu bitirmesini BEKLEMEDEN, kendi
 * sorgularını doğrudan elm327.js üzerinden yapar - böylece karşılama cümlesi
 * gecikmeden ve güncel verilerle okunur.
 *
 * "Sürüş kaydı başlatılıyor" cümlesi artık gerçeği yansıtıyor: trip-recorder.js
 * Bluetooth bağlantısı kurulduğunda (bu cümle okunduğunda) otomatik olarak
 * gerçek bir yolculuk kaydı başlatıyor (Faz 4).
 * ---------------------------------------------------------------------------
 */

import { queryPid } from '../obd/elm327.js';
import { speak } from './tts.js';
import { logInfo, logWarn } from '../core/logger.js';

/**
 * Karşılama cümlesini oluşturur ve seslendirir.
 * @param {string} ownerName - Aracın/uygulamanın sahibi (profil adı).
 * @returns {Promise<void>}
 */
export async function speakConnectionGreeting(ownerName) {
  const parts = [`Merhaba ${ownerName}.`, 'Araç bağlantısı başarılı.'];

  const readings = await Promise.allSettled([
    queryPid('05'), // motor sıcaklığı
    queryPid('46'), // dış sıcaklık
    queryPid('42'), // akü voltajı
    queryPid('2F'), // yakıt seviyesi
  ]);

  const [coolant, outside, voltage, fuel] = readings.map((r) =>
    r.status === 'fulfilled' ? r.value : null,
  );

  if (coolant) parts.push(`Motor sıcaklığı ${Math.round(coolant.value)} derece.`);
  if (outside) parts.push(`Dış hava sıcaklığı ${Math.round(outside.value)} derece.`);
  if (voltage) parts.push(`Akü voltajı ${voltage.value.toFixed(1)} volt.`);
  if (fuel) parts.push(`Yakıt seviyeniz yüzde ${Math.round(fuel.value)}.`);

  parts.push('Sürüş kaydı başlatılıyor.');
  parts.push('İyi yolculuklar.');

  const sentence = parts.join(' ');
  logInfo('greeting', `Karşılama cümlesi: "${sentence}"`);

  try {
    await speak(sentence);
  } catch (error) {
    logWarn('greeting', 'Karşılama cümlesi seslendirilemedi', error);
  }
}
