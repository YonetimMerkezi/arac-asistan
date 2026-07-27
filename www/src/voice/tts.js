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
import { Preferences } from '@capacitor/preferences';
import { logError, logInfo } from '../core/logger.js';

/** @type {string} Uygulama genelinde kullanılan dil. */
const LANGUAGE = 'tr-TR';

/** @type {string} Ses tercihi Preferences anahtarı. */
const MUTED_STORAGE_KEY = 'sda_tts_muted';

/** @typedef {{text: string, resolve: () => void}} SpeechTask */

/** @type {SpeechTask[]} */
const queue = [];

/** @type {boolean} */
let speaking = false;

/** @type {boolean} Kullanıcı Ayarlar ekranından sesi kapattıysa true olur. */
let muted = false;

/**
 * Kayıtlı ses tercihini yükler. Uygulama açılışında bir kez çağrılmalıdır.
 * @returns {Promise<void>}
 */
export async function initTts() {
  try {
    const { value } = await Preferences.get({ key: MUTED_STORAGE_KEY });
    muted = value === 'true';
    logInfo('tts', `Ses tercihi yüklendi: ${muted ? 'kapalı' : 'açık'}`);
  } catch (error) {
    logError('tts', 'Ses tercihi okunamadı, varsayılan (açık) kullanılıyor', error);
    muted = false;
  }
}

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
 * Sesi geçici olarak kapatır/açar ve tercihi kalıcı olarak saklar.
 * @param {boolean} value
 * @returns {Promise<void>}
 */
export async function setMuted(value) {
  muted = value;
  if (value) clearSpeechQueue();
  try {
    await Preferences.set({ key: MUTED_STORAGE_KEY, value: String(value) });
  } catch (error) {
    logError('tts', 'Ses tercihi kaydedilemedi', error);
  }
}

/**
 * @returns {boolean} Sesin şu an kapalı olup olmadığı.
 */
export function isMuted() {
  return muted;
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
