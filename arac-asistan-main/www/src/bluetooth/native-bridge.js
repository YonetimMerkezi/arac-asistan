/**
 * native-bridge.js
 * ---------------------------------------------------------------------------
 * android/.../BluetoothClassicPlugin.kt için ince JS köprüsü.
 *
 * Bu dosyanın tek görevi Capacitor.registerPlugin çağrısını yapmak ve
 * native metotlara tip güvenli (JSDoc ile) bir JS arayüzü sunmaktır.
 * Bağlantı YÖNETİMİ (otomatik yeniden bağlanma, tarama vb.) burada değil,
 * bluetooth-manager.js'de yapılır - SOLID tek sorumluluk ilkesi.
 * ---------------------------------------------------------------------------
 */

import { registerPlugin } from '@capacitor/core';

/**
 * @typedef {Object} PairedDevice
 * @property {string} name
 * @property {string} address
 *
 * @typedef {Object} ConnectionChangeEvent
 * @property {boolean} connected
 * @property {string} [address]
 *
 * @typedef {Object} ReadEvent
 * @property {string} data - ELM327'den gelen ham metin parçası.
 *
 * @typedef {Object} BluetoothClassicPluginInterface
 * @property {() => Promise<{devices: PairedDevice[]}>} listPairedDevices
 * @property {(opts: {address: string}) => Promise<{connected: boolean, address: string}>} connect
 * @property {(opts: {data: string}) => Promise<void>} write
 * @property {() => Promise<void>} disconnect
 * @property {(eventName: 'read', listener: (event: ReadEvent) => void) => Promise<{remove: () => void}>} addListener
 * @property {() => Promise<{bluetooth: string, bluetoothScan: string}>} requestPermissions - Native
 *   tarafta @CapacitorPlugin(permissions=[...]) ile tanımlı BLUETOOTH_CONNECT/BLUETOOTH_SCAN
 *   izinlerini ister (Capacitor'ın standart otomatik-üretilen metodu).
 */

/** @type {BluetoothClassicPluginInterface} */
export const BluetoothClassic = registerPlugin('BluetoothClassic');
