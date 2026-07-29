/**
 * greeting.js
 * ---------------------------------------------------------------------------
 * Bağlantı kurulduğunda okunan karşılama cümlesi.
 *
 * DÜZELTME (kritik hata): Önceki sürüm "Araç bağlantısı başarılı" ve "Sürüş
 * kaydı başlatılıyor" cümlelerini KOŞULSUZ söylüyordu - 4 PID okumasının
 * (motor sıcaklığı, dış sıcaklık, voltaj, yakıt) TAMAMI başarısız olsa bile.
 * Bluetooth soketi açık ama ELM327 hiç yanıt vermiyorsa (ör. native taraftaki
 * thread kilitlenmesi gibi bir sorun varsa) kullanıcı "bağlandı, kayıt
 * başladı" duyuyordu ama gerçekte HİÇBİR veri akmıyordu - "sanki bağlantıdan
 * bağımsız çalışıyor" şikayetinin sebebi tam olarak buydu. Artık en az BİR
 * okuma gerçekten başarılı olmadıkça "başarılı" denmez; bunun yerine dürüst
 * bir "veri alınamıyor" mesajı okunur ve `false` döner - çağıran taraf
 * (app-init.js) bunu görüp sesli komut/uyarı sistemini başlatmaz, tekrar dener.
 * ---------------------------------------------------------------------------
 */

import { queryPid } from '../obd/elm327.js';
import { speak } from './tts.js';
import { logInfo, logWarn } from '../core/logger.js';

/**
 * Karşılama cümlesini oluşturur ve seslendirir - yalnızca EN AZ BİR PID
 * okuması gerçekten başarılıysa "bağlantı başarılı" der.
 * @param {string} ownerName - Aracın/uygulamanın sahibi (profil adı).
 * @returns {Promise<boolean>} Bağlantının GERÇEKTEN doğrulanıp doğrulanmadığı.
 */
export async function speakConnectionGreeting(ownerName) {
  const readings = await Promise.allSettled([
    queryPid('05'), // motor sıcaklığı
    queryPid('46'), // dış sıcaklık
    queryPid('42'), // akü voltajı
    queryPid('2F'), // yakıt seviyesi
  ]);

  const [coolant, outside, voltage, fuel] = readings.map((r) =>
    r.status === 'fulfilled' ? r.value : null,
  );

  const verified = coolant !== null || outside !== null || voltage !== null || fuel !== null;

  if (!verified) {
    logWarn('greeting', 'Hiçbir PID okuması başarılı olmadı - bağlantı doğrulanamadı, "başarılı" denmeyecek');
    try {
      await speak(`${ownerName}, araca bağlanılıyor ama henüz veri alınamıyor. Kontrol ediliyor.`);
    } catch (error) {
      logWarn('greeting', 'Uyarı cümlesi seslendirilemedi', error);
    }
    return false;
  }

  const parts = [`Merhaba ${ownerName}.`, 'Araç bağlantısı başarılı.'];

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
  return true;
}
