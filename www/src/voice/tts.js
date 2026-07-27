/**
 * tts.js
 * ---------------------------------------------------------------------------
 * Metin okuma (Text-to-Speech) sarmalayıcısı.
 *
 * @capacitor-community/text-to-speech üzerine ince bir katman: birden fazla
 * "speak" çağrısı üst üste gelirse (ör. karşılama cümlesi bitmeden bir uyarı
 * tetiklenirse) cümleler birbirine karışmasın diye SIRALI bir kuyruk kullanır.
 * ---------------------------------------------------------------------------
 */

import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { logError, logInfo } from '../core/logger.js';

/** @type {string} Uygulama genelinde kullanılan dil. */
const LANGUAGE = 'tr-TR';

/** @typedef {{text: string, resolve: () => void}} SpeechTask */

/** @type {SpeechTask[]} */
const queue = [];

/** @type {boolean} */
let speaking = false;

/** @type {boolean} Kullanıcı ayarlardan sesi kapattıysa (Faz 9) true olur. */
let muted = false;

/**
 * Bir metni sesli okuma kuyruğuna ekler. Önceki cümle bitmeden başlamaz.
 * @param {string} text
 * @returns {Promise<void>} Bu cümlenin okunması tamamlandığında çözülür.
 */
export function speak(text) {
  return new Promise((resolve) => {
    if (muted || !text) {
      resolve();
      return;
    }
    queue.push({ text, resolve });
    processQueue();
  });
}

/**
 * Kuyruğu tamamen boşaltır (ör. kritik bir uyarı en öne alınacaksa
 * kullanılabilir - şu an sırayı korumak için tercih edilmiyor, ama
 * ileride acil durum uyarıları için hazır).
 */
export function clearSpeechQueue() {
  queue.length = 0;
}

/**
 * Sesi geçici olarak kapatır/açar (Faz 9 ayarlar ekranı bu API'yi kullanacak).
 * @param {boolean} value
 */
export function setMuted(value) {
  muted = value;
  if (value) clearSpeechQueue();
}

/**
 * Kuyruktaki bir sonraki cümleyi seslendirir.
 */
async function processQueue() {
  if (speaking || queue.length === 0) return;

  speaking = true;
  const task = queue.shift();

  try {
    await TextToSpeech.speak({
      text: task.text,
      lang: LANGUAGE,
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      category: 'ambient',
    });
    logInfo('tts', `Seslendirildi: "${task.text}"`);
  } catch (error) {
    logError('tts', `Seslendirme başarısız: "${task.text}"`, error);
  } finally {
    speaking = false;
    task.resolve();
    processQueue();
  }
}
