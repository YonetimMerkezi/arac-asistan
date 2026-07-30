/**
 * stt.js
 * ---------------------------------------------------------------------------
 * Sesli komut tanıma (Speech-to-Text) sarmalayıcısı.
 *
 * @capacitor-community/speech-recognition, her `start()` çağrısında TEK bir
 * cümle dinler ve sonucu döndürür. Sürüş sırasında elleri kullanmadan komut
 * verebilmek için bu modül, "dinleme modu" açıkken her sonuçtan sonra
 * otomatik olarak yeniden başlatan bir döngü kurar.
 *
 * NOT: Sürekli dinleme pil tüketimini artırır. Faz 9'da ayarlar ekranından
 * kapatılabilir olacak (bkz. setMuted benzeri bir toggle, tts.js'teki gibi).
 * ---------------------------------------------------------------------------
 */

import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { logError, logInfo, logWarn } from '../core/logger.js';

/** @type {string} Tanıma dili. */
const LANGUAGE = 'tr-TR';

/** @type {number} Bir sonuç alındıktan sonra yeniden dinlemeye başlamadan önceki bekleme (ms). */
const RESTART_DELAY_MS = 400;

/** @type {Set<(transcript: string) => void>} */
const transcriptListeners = new Set();

/** @type {boolean} Kullanıcının "dinleme modu"nu açık tutup tutmadığı. */
let listeningModeActive = false;

/** @type {boolean} Şu an fiilen bir tanıma isteği bekleniyor mu (native tarafta). */
let recognitionInFlight = false;

/**
 * @type {boolean} TTS konuşurken TRUE olur - bu sırada dinleme durdurulur.
 *
 * DÜZELTME (kritik hata - geri besleme döngüsü): Önceden tts.js ile stt.js
 * arasında HİÇBİR koordinasyon yoktu - uygulama sesli cevap SÖYLERKEN
 * mikrofon AYNI ANDA dinlemeye devam ediyordu. Telefon kendi hoparlöründen
 * çıkan sesi (ör. "En yakın akaryakıt istasyonu...") mikrofonla tekrar
 * duyup YENİ bir kullanıcı cümlesi sanıyordu - cevabın içinde zaten
 * "akaryakıt istasyonu" geçtiği için komut KENDİ KENDİNİ tekrar
 * tetikliyordu. "Aynı soruya aralıklarla defalarca cevap verdi"
 * şikayetinin gerçek sebebi buydu. Artık tts.js konuşmaya başlarken
 * pauseListeningForSpeech(), bitirince resumeListeningAfterSpeech() çağırır.
 */
let pausedForSpeech = false;

/**
 * İzinleri kontrol eder/ister ve cihazda tanıma motorunun var olup olmadığını
 * doğrular. Dinlemeye başlamadan önce bir kez çağrılmalıdır.
 * @returns {Promise<boolean>}
 */
export async function ensureSpeechRecognitionReady() {
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) {
      logWarn('stt', 'Cihazda konuşma tanıma motoru bulunamadı');
      return false;
    }

    const permission = await SpeechRecognition.requestPermissions();
    const granted = permission.speechRecognition === 'granted';
    if (!granted) {
      logWarn('stt', 'Konuşma tanıma izni verilmedi');
    }
    return granted;
  } catch (error) {
    logError('stt', 'Konuşma tanıma hazırlığı başarısız', error);
    return false;
  }
}

/**
 * Sürekli dinleme modunu başlatır. Her cümle tanındığında dinleyicilere
 * iletilir ve otomatik olarak bir sonraki cümle için yeniden dinlenir.
 * @returns {Promise<void>}
 */
export async function startListeningMode() {
  if (listeningModeActive) return;

  const ready = await ensureSpeechRecognitionReady();
  if (!ready) return;

  listeningModeActive = true;
  logInfo('stt', 'Sürekli dinleme modu başlatıldı');
  listenOnce();
}

/**
 * Sürekli dinleme modunu durdurur.
 */
export function stopListeningMode() {
  listeningModeActive = false;
  SpeechRecognition.stop().catch(() => {
    /* Zaten durmuşsa hata yok sayılır. */
  });
  logInfo('stt', 'Sürekli dinleme modu durduruldu');
}

/**
 * @returns {boolean} Dinleme modunun şu anki durumu.
 */
export function isListeningModeActive() {
  return listeningModeActive;
}

/**
 * TTS konuşmaya başlarken çağrılır - mikrofonun kendi sesini "duyup" komutu
 * yeniden tetiklemesini önlemek için dinlemeyi HEMEN durdurur (o an bir
 * tanıma isteği sürüyorsa onu da iptal eder).
 */
export function pauseListeningForSpeech() {
  pausedForSpeech = true;
  if (recognitionInFlight) {
    SpeechRecognition.stop().catch(() => {
      /* Zaten durmuşsa hata yok sayılır. */
    });
  }
}

/**
 * TTS konuşmayı bitirdikten sonra çağrılır - dinleme modu hâlâ açıksa
 * yeniden başlatır.
 */
export function resumeListeningAfterSpeech() {
  pausedForSpeech = false;
  if (listeningModeActive && !recognitionInFlight) {
    setTimeout(listenOnce, RESTART_DELAY_MS);
  }
}

/**
 * Tanınan cümlelere abone olur.
 * @param {(transcript: string) => void} callback
 * @returns {() => void}
 */
export function onTranscript(callback) {
  transcriptListeners.add(callback);
  return () => transcriptListeners.delete(callback);
}

/**
 * Tek bir dinleme turu başlatır; sonuç geldiğinde dinleyicilere iletir ve
 * dinleme modu hâlâ açıksa döngüyü tekrarlar.
 */
async function listenOnce() {
  if (!listeningModeActive || recognitionInFlight || pausedForSpeech) return;

  recognitionInFlight = true;
  try {
    const result = await SpeechRecognition.start({
      language: LANGUAGE,
      maxResults: 1,
      partialResults: false,
      popup: false,
    });

    const transcript = result?.matches?.[0];
    if (transcript) {
      logInfo('stt', `Tanındı: "${transcript}"`);
      for (const listener of transcriptListeners) {
        try {
          listener(transcript);
        } catch (error) {
          logError('stt', 'Transkript dinleyicisi hata fırlattı', error);
        }
      }
    }
  } catch (error) {
    // Zaman aşımı / sessizlik gibi durumlar normaldir, sürekli hata basmaz.
    logWarn('stt', 'Bu turda tanıma alınamadı', error);
  } finally {
    recognitionInFlight = false;
    if (listeningModeActive && !pausedForSpeech) {
      setTimeout(listenOnce, RESTART_DELAY_MS);
    }
  }
}
