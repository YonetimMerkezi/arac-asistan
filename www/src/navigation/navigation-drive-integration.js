/**
 * Smart Drive AI - sürüş kaydı entegrasyon köprüsü
 *
 * Navigasyon başlaması sürüş kaydını zorla başlatmaz.
 * Mevcut sürüş kaydı modülünün kendi minimum mesafe/hareket kriterleri korunur.
 */
const listeners = new Set();

function emit(type, detail={}) {
  listeners.forEach(fn => { try { fn(type, detail); } catch {} });
  window.dispatchEvent(new CustomEvent(`sda:drive:${type}`, { detail }));
}

export function bindDriveIntegration() {
  window.addEventListener('sda:drive-record-started', e => emit('started', e.detail));
  window.addEventListener('sda:drive-record-saved', e => emit('saved', e.detail));
  window.addEventListener('sda:drive-record-discarded', e => emit('discarded', e.detail));
  window.addEventListener('sda:obd-data', e => emit('obd', e.detail));
}

export function onDriveIntegration(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestDriveRecordSave(summary) {
  window.dispatchEvent(new CustomEvent('sda:drive-save-request', {
    detail: summary,
  }));
}
