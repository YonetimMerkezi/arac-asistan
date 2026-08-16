/**
 * navigation-voice.js
 * Türkçe sesli yönlendirme.
 *
 * Öncelik:
 * 1) Android SmartDriveTTS bridge
 * 2) Web Speech API
 */

let enabled = true;
let lastText = '';
let lastSpokenAt = 0;

export function setVoiceEnabled(value) {
  enabled = Boolean(value);
}

export function isVoiceEnabled() {
  return enabled;
}

export function speak(text, options = {}) {
  if (!enabled || !text) return false;

  const now = Date.now();
  const minInterval = Number(options.minInterval || 3500);

  if (text === lastText && now - lastSpokenAt < minInterval) {
    return false;
  }

  lastText = text;
  lastSpokenAt = now;

  try {
    if (window.SmartDriveTTS?.speak) {
      window.SmartDriveTTS.speak(String(text), 'tr-TR');
      return true;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = 'tr-TR';
      utterance.rate = 0.98;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
      return true;
    }
  } catch {}

  return false;
}

export function stopVoice() {
  try {
    window.SmartDriveTTS?.stop?.();
    window.speechSynthesis?.cancel?.();
  } catch {}
}
