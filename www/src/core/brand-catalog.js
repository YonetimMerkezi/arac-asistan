/**
 * brand-catalog.js
 * ---------------------------------------------------------------------------
 * Türkiye'deki yaygın akaryakıt dağıtıcılarının SEMANTİK kaydı: her marka
 * için bir renk ve rozet (badge) baş harfi tanımlar. Gerçek marka logoları
 * (telif hakkı korumalı grafikler) KULLANILMAZ - bunun yerine markaya özgü
 * renkte, baş harfli/simgeli bir rozet üretilir (bkz. ui/components/brand-badge.js).
 *
 * fuel-price-service.js'teki BRAND_ALIASES ile KARIŞTIRILMAMALI: o dosya
 * worker'ın fiyat listesi ile OSM etiketleri arasında İSİM eşleştirmesi
 * yapar (hangi kayıt hangi kayıt). Bu dosya ise yalnızca GÖRSEL (renk/rozet)
 * eşlemesi yapar - iki kaygı bilinçli olarak ayrı tutuldu.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} BrandVisual
 * @property {string} key - Normalize edilmiş anahtar (küçük harf, boşluksuz).
 * @property {string} label - Görüntülenecek marka adı.
 * @property {string} color - Rozet/işaretçi zemin rengi (hex).
 * @property {string} textColor - Rozet üzerindeki metin/simge rengi (hex).
 * @property {string} initials - Rozette gösterilecek 1-2 harf.
 */

/** @type {BrandVisual[]} Bilinen dağıtıcılar - yeni marka eklemek tek satır. */
export const BRAND_CATALOG = [
  { key: 'petrolofisi', label: 'Petrol Ofisi', color: '#E30613', textColor: '#FFFFFF', initials: 'PO' },
  { key: 'opet', label: 'Opet', color: '#0057B8', textColor: '#FFFFFF', initials: 'OP' },
  { key: 'shell', label: 'Shell', color: '#FBCE07', textColor: '#DD1D21', initials: 'SH' },
  { key: 'bp', label: 'BP', color: '#009B3A', textColor: '#FFFFFF', initials: 'BP' },
  { key: 'total', label: 'Total', color: '#D2001C', textColor: '#FFFFFF', initials: 'TE' },
  { key: 'totalenerji', label: 'Total Energies', color: '#D2001C', textColor: '#FFFFFF', initials: 'TE' },
  { key: 'aytemiz', label: 'Aytemiz', color: '#F7941E', textColor: '#14171C', initials: 'AY' },
  { key: 'moil', label: 'M Oil', color: '#6B2C91', textColor: '#FFFFFF', initials: 'MO' },
  { key: 'lukoil', label: 'Lukoil', color: '#ED1C24', textColor: '#FFFFFF', initials: 'LU' },
  { key: 'alpet', label: 'Alpet', color: '#00A651', textColor: '#FFFFFF', initials: 'AL' },
  { key: 'elloil', label: 'Elloil', color: '#1D9BF0', textColor: '#FFFFFF', initials: 'EL' },
  { key: 'sunpet', label: 'Sunpet', color: '#FFB100', textColor: '#14171C', initials: 'SU' },
];

/** @type {BrandVisual} Marka çözülemediğinde kullanılan nötr görsel. */
const UNKNOWN_BRAND_VISUAL = { key: 'bilinmeyen', label: 'Bilinmeyen', color: '#6B7280', textColor: '#FFFFFF', initials: '?' };

/**
 * Serbest metin bir marka adını (OSM etiketi, worker kaydı veya kullanıcı
 * girdisi) katalogdaki en yakın görsel tanıma eşler. Tam eşleşme aranmaz -
 * iki kaynak farklı yazım kullanabilir (ör. "PO" / "Petrol Ofisi").
 * @param {string|null|undefined} rawName
 * @returns {BrandVisual}
 */
export function resolveBrandVisual(rawName) {
  if (!rawName) return UNKNOWN_BRAND_VISUAL;
  const needle = normalize(rawName);

  const exact = BRAND_CATALOG.find((b) => b.key === needle);
  if (exact) return exact;

  const partial = BRAND_CATALOG.find((b) => needle.includes(b.key) || b.key.includes(needle));
  return partial ?? { ...UNKNOWN_BRAND_VISUAL, label: rawName };
}

/**
 * Serbest bir marka adını (dağıtıcı adı) normalize edilmiş bir anahtara
 * çevirir - hem BRAND_CATALOG eşleştirmesinde hem de logo dosya adı
 * üretiminde (bkz. ui/components/brand-badge.js) kullanılır, ikisi de AYNI
 * kurala uysun diye dışa açıldı.
 * @param {string} text
 * @returns {string}
 */
export function normalizeBrandKey(text) {
  return normalize(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .toLocaleLowerCase('tr')
    .replace(/i̇/g, 'i')
    .replace(/[^a-z0-9]/g, '');
}
