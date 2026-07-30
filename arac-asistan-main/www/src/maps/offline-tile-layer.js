/**
 * offline-tile-layer.js
 * ---------------------------------------------------------------------------
 * Standart L.TileLayer'ın "önce yerel önbelleğe bak, yoksa ağdan indir"
 * davranışı eklenmiş hali.
 *
 * NEDEN AYRI DOSYA: navigation-view.js zaten 500 satır sınırına yakın; karo
 * matematiği (lon/lat <-> x/y/z) hem burada hem offline-region-download.js'te
 * gerekiyor - o yüzden bu dosyada dışa açılıyor, tekrar YAZILMIYOR.
 *
 * DAVRANIŞ: Bir karo istenince önce offline-region-store'da var mı bakılır
 * (kullanıcı o bölgeyi "Bölge İndir" ile indirmişse anında oradan gelir,
 * internet gerekmez). Yoksa normal ağ isteği yapılır - bu yüzden çevrimdışı
 * indirilmemiş alanlarda uygulama ÖNCEKİ gibi (internet varken) çalışmaya
 * devam eder, hiçbir davranış kaybolmaz.
 * ---------------------------------------------------------------------------
 */

import L from 'leaflet';
import { getTileBlob } from './offline-region-store.js';

/** @type {string[]} Standart OpenStreetMap karo alt alan adları (round-robin). */
const TILE_SUBDOMAINS = ['a', 'b', 'c'];

/**
 * @param {number} z
 * @param {number} x
 * @returns {string} https://a.tile.openstreetmap.org/{z}/{x}/{y}.png biçiminde şablon uygular.
 */
function subdomainFor(z, x) {
  return TILE_SUBDOMAINS[(z + x) % TILE_SUBDOMAINS.length];
}

/**
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function osmTileUrl(z, x, y) {
  return `https://${subdomainFor(z, x)}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/**
 * Bir enlem/boylam noktasının verilen zoom seviyesindeki slippy-map karo
 * koordinatını hesaplar (standart OSM formülü).
 * @param {number} lat
 * @param {number} lon
 * @param {number} z
 * @returns {{x:number, y:number}}
 */
export function lonLatToTile(lat, lon, z) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z,
  );
  return { x, y };
}

/**
 * Çevrimdışı önbellek destekli Leaflet karo katmanı. Genel L.tileLayer(...)
 * ile birebir aynı şekilde kullanılır (aynı seçenekler, aynı .addTo(map)).
 */
export const OfflineTileLayer = L.TileLayer.extend({
  /**
   * @param {import('leaflet').Coords} coords
   * @param {(error: Error|null, tile: HTMLElement) => void} done
   * @returns {HTMLElement}
   */
  createTile(coords, done) {
    const img = document.createElement('img');
    img.setAttribute('role', 'presentation');

    const { z, x, y } = coords;
    const networkUrl = osmTileUrl(z, x, y);

    getTileBlob(z, x, y).then((blob) => {
      if (blob) {
        // Önbellekte var - anında göster, ağa hiç çıkmaz (çevrimdışıyken de çalışır).
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          done(null, img);
        };
        img.onerror = (error) => done(error, img);
        img.src = objectUrl;
        return;
      }

      // Önbellekte yok - normal ağ davranışı (önceki sürümle birebir aynı).
      img.onload = () => done(null, img);
      img.onerror = (error) => done(error, img);
      img.src = networkUrl;
    });

    return img;
  },
});

/**
 * OfflineTileLayer örneği oluşturur - L.tileLayer(url, options) çağrısının
 * yerini alır (url parametresi artık yok, karo adresi osmTileUrl() ile
 * sabit - önbellek anahtarları da bu adrese göre üretildiği için tutarlılık
 * gerekir).
 * @param {import('leaflet').TileLayerOptions} options
 * @returns {import('leaflet').TileLayer}
 */
export function offlineTileLayer(options) {
  return new OfflineTileLayer('', options);
}
