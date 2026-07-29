/**
 * permissions-bootstrap.js
 * ---------------------------------------------------------------------------
 * Uygulama açılışında GEREKEN TÜM çalışma zamanı izinlerini TEK SEFERDE ister.
 *
 * ÖNCEKİ DAVRANIŞ: her izin kendi modülü ilk kullanıldığında isteniyordu -
 * konum yalnızca Harita ekranı açılınca veya Bluetooth bağlanınca
 * (gps-tracker.js), mikrofon yalnızca sesli dinleme başlayınca (voice/stt.js).
 * Bu, kullanıcının izin isteklerini uygulamayı kullandıkça DAĞINIK şekilde
 * görmesine sebep oluyordu. Artık app-init.js bootstrap'ının EN BAŞINDA bu
 * fonksiyon çağrılır - kullanıcı açılışta tüm izinleri arka arkaya görür.
 *
 * Her izin isteği BAĞIMSIZ (Promise.allSettled) yapılır - biri reddedilse
 * veya bir platformda mevcut olmasa bile diğerleri etkilenmez, ve ilgili
 * özellik (Harita, sesli asistan, Bluetooth) yine de kendi anındaki normal
 * "izin verilmedi" akışını izler (bu dosya yalnızca ÖNCEDEN ister, izin
 * reddedilirse özelliği devre dışı bırakmaz - bu iş ilgili modülün kendisinde).
 * ---------------------------------------------------------------------------
 */

import { Geolocation } from '@capacitor/geolocation';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { BluetoothClassic } from '../bluetooth/native-bridge.js';
import { logInfo, logWarn } from './logger.js';

/**
 * Konum, mikrofon ve Bluetooth (Android 12+ BLUETOOTH_CONNECT/SCAN) izinlerini
 * arka arkaya (ayrı diyaloglar halinde, aynı anda değil - Android tek seferde
 * yalnızca bir izin diyaloğu gösterebilir) ister. Uygulama açılışında bir kez
 * çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function requestAllPermissionsUpfront() {
  const results = await Promise.allSettled([
    Geolocation.requestPermissions(),
    SpeechRecognition.requestPermissions(),
    BluetoothClassic.requestPermissions(),
  ]);

  const labels = ['Konum', 'Mikrofon', 'Bluetooth'];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      logInfo('permissions-bootstrap', `${labels[index]} izin sonucu`, result.value);
    } else {
      // Bir izin isteği bu platformda/cihazda desteklenmiyor veya başarısız
      // olabilir - bu BEKLENEN bir durumdur, ilgili özellik kendi normal
      // "izin yok" akışını izler, burada yalnızca teşhis için loglanır.
      logWarn('permissions-bootstrap', `${labels[index]} izni istenemedi`, result.reason);
    }
  });
}
