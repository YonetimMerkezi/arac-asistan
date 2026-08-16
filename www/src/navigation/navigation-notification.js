/**
 * Smart Drive AI - araç bağlantı bildirimi köprüsü.
 * Web tarafı Android native Notification API'yi doğrudan zorlamaz.
 */
export function notifyVehicleAvailable(vehicle = {}) {
  const title = 'Smart Drive AI';
  const text = vehicle.name
    ? `${vehicle.name} araca bağlanmaya hazır.`
    : 'Araç bağlantısı algılandı.';

  if (window.SmartDriveNotifications?.vehicleAvailable) {
    window.SmartDriveNotifications.vehicleAvailable(title, text);
    return true;
  }

  // Browser/WebView fallback: izin verilmişse bildirim.
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body: text, tag: 'sda-vehicle' });
    return true;
  }

  return false;
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    return Notification.requestPermission();
  }
  return Notification.permission;
}
