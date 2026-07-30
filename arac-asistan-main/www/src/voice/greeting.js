/**
 * greeting.js
 * ---------------------------------------------------------------------------
 * Bağlantı kurulduğunda okunan karşılama cümlesi.
 *
 * DÜZELTME (kritik hata): Önceki sürüm "Araç bağlantısı başarılı" ve "Sürüş
 * kaydı başlatılıyor" cümlelerini KOŞULSUZ söylüyordu - 4 PID okumasının
 * (motor sıcaklığı, dış sıcaklık, voltaj, yakıt) TAMAMI başarısız olsa bile.
 * Artık en az BİR okuma gerçekten başarılı olmadıkça "başarılı" denmez;
 * bunun yerine dürüst bir "veri alınamıyor" mesajı okunur ve `false` döner -
 * çağıran taraf (app-init.js) bunu görüp sesli komut/uyarı sistemini
 * başlatmaz, tekrar dener. BU DOĞRULAMA MANTIĞI, aşağıdaki sesli okuma
 * tercihlerinden BAĞIMSIZ olarak HER ZAMAN çalışır - yalnızca "SÖYLENSİN Mİ"
 * ve "NELER söylensin" tercihe bağlıdır, "DOĞRULANSIN MI" değil.
 *
 * YENİ: Karşılama artık Ayarlar'dan (1) tamamen sessize alınabilir, (2)
 * içeriği (hangi bilgilerin söyleneceği) özelleştirilebilir - bkz.
 * core/greeting-preferences-store.js.
 * ---------------------------------------------------------------------------
 */

import { queryPid } from '../obd/elm327.js';
import { speak } from './tts.js';
import { isGreetingSpoken, getGreetingFields } from '../core/greeting-preferences-store.js';
import { logInfo, logWarn } from '../core/logger.js';

/**
 * Karşılama cümlesini oluşturur ve (tercih açıksa) seslendirir - yalnızca
 * EN AZ BİR PID okuması gerçekten başarılıysa "bağlantı başarılı" der.
 * @param {string} ownerName - Aracın/uygulamanın sahibi (profil adı).
 * @returns {Promise<boolean>} Bağlantının GERÇEKTEN doğrulanıp doğrulanmadığı
 *   (bu değer, sesli okuma tercihinden BAĞIMSIZDIR - çağıran taraf sesli
 *   komut sistemini başlatıp başlatmayacağına bununla karar verir).
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
  const fields = new Set(getGreetingFields());

  if (!verified) {
    logWarn('greeting', 'Hiçbir PID okuması başarılı olmadı - bağlantı doğrulanamadı, "başarılı" denmeyecek');
    if (isGreetingSpoken()) {
      try {
        await speak(`${ownerName}, araca bağlanılıyor ama henüz veri alınamıyor. Kontrol ediliyor.`);
      } catch (error) {
        logWarn('greeting', 'Uyarı cümlesi seslendirilemedi', error);
      }
    }
    return false;
  }

  const parts = [`Merhaba ${ownerName}.`];

  if (fields.has('success')) parts.push('Araç bağlantısı başarılı.');
  if (fields.has('coolant') && coolant) parts.push(`Motor sıcaklığı ${Math.round(coolant.value)} derece.`);
  if (fields.has('outside') && outside) parts.push(`Dış hava sıcaklığı ${Math.round(outside.value)} derece.`);
  if (fields.has('voltage') && voltage) parts.push(`Akü voltajı ${voltage.value.toFixed(1)} volt.`);
  if (fields.has('fuel') && fuel) parts.push(`Yakıt seviyeniz yüzde ${Math.round(fuel.value)}.`);
  if (fields.has('closing')) {
    parts.push('Sürüş kaydı başlatılıyor.');
    parts.push('İyi yolculuklar.');
  }

  const sentence = parts.join(' ');
  logInfo('greeting', `Karşılama cümlesi: "${sentence}"`);

  if (isGreetingSpoken()) {
    try {
      await speak(sentence);
    } catch (error) {
      logWarn('greeting', 'Karşılama cümlesi seslendirilemedi', error);
    }
  } else {
    logInfo('greeting', 'Karşılama sesi kapalı (Ayarlar) - yalnızca günlüğe yazıldı, seslendirilmedi.');
  }

  return true;
}
