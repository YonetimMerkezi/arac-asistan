/**
 * dtc-descriptions.js
 * ---------------------------------------------------------------------------
 * Yaygın JENERİK (üretici bağımsız, SAE standardı) arıza kodları için
 * Türkçe açıklama ve genel kontrol önerisi.
 *
 * ÖNEMLİ DÜRÜSTLÜK NOTU: "Tahmini maliyet" özelliği KASITLI OLARAK yok -
 * onarım maliyeti araca, bölgeye, işçiliğe göre o kadar değişir ki genel bir
 * tahmin vermek yanıltıcı ve potansiyel olarak zararlı olurdu (kullanıcıyı
 * yanlış bütçe beklentisine sokabilir). Bunun yerine yalnızca "hangi
 * sistemi kontrol ettirin" düzeyinde genel yönlendirme veriliyor.
 *
 * Bu liste kapsamlı DEĞİLDİR - yalnızca en sık görülen jenerik kodları
 * içerir. Listede olmayan bir kod için genel açıklama gösterilir.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} DtcDescription
 * @property {string} title - Kısa Türkçe başlık.
 * @property {string} detail - Bir cümlelik açıklama.
 * @property {string} checkSuggestion - Genel kontrol yönlendirmesi (maliyet İÇERMEZ).
 */

/** @type {Record<string, DtcDescription>} */
export const DTC_DESCRIPTIONS = {
  P0171: {
    title: 'Yakıt Sistemi Fakir (Bank 1)',
    detail: 'Motor, hava/yakıt karışımında beklenenden fazla hava algılıyor.',
    checkSuggestion: 'Emme manifoldu vakum kaçağı, MAF sensörü ve yakıt basıncı kontrol edilmeli.',
  },
  P0172: {
    title: 'Yakıt Sistemi Zengin (Bank 1)',
    detail: 'Motor, hava/yakıt karışımında beklenenden fazla yakıt algılıyor.',
    checkSuggestion: 'Yakıt enjektörleri, oksijen sensörü ve MAF sensörü kontrol edilmeli.',
  },
  P0300: {
    title: 'Rastgele/Çoklu Silindir Ateşleme Kaçağı',
    detail: 'Birden fazla silindirde düzensiz ateşleme tespit edildi.',
    checkSuggestion: 'Buji, ateşleme bobinleri ve yakıt enjektörleri kontrol edilmeli.',
  },
  P0301: { title: '1. Silindir Ateşleme Kaçağı', detail: '1. silindirde ateşleme kaçağı tespit edildi.', checkSuggestion: 'İlgili silindirin bujisi ve bobini kontrol edilmeli.' },
  P0302: { title: '2. Silindir Ateşleme Kaçağı', detail: '2. silindirde ateşleme kaçağı tespit edildi.', checkSuggestion: 'İlgili silindirin bujisi ve bobini kontrol edilmeli.' },
  P0303: { title: '3. Silindir Ateşleme Kaçağı', detail: '3. silindirde ateşleme kaçağı tespit edildi.', checkSuggestion: 'İlgili silindirin bujisi ve bobini kontrol edilmeli.' },
  P0304: { title: '4. Silindir Ateşleme Kaçağı', detail: '4. silindirde ateşleme kaçağı tespit edildi.', checkSuggestion: 'İlgili silindirin bujisi ve bobini kontrol edilmeli.' },
  P0325: {
    title: 'Vuruntu Sensörü Devresi Arızası',
    detail: 'Vuruntu (knock) sensörü sinyalinde anormallik.',
    checkSuggestion: 'Vuruntu sensörü ve kablo bağlantısı kontrol edilmeli.',
  },
  P0335: {
    title: 'Krank Mili Konum Sensörü Devresi',
    detail: 'Krank mili konum sensörü sinyalinde sorun.',
    checkSuggestion: 'Sensör ve kablo tesisatı kontrol edilmeli.',
  },
  P0340: {
    title: 'Eksantrik Mili Konum Sensörü Devresi',
    detail: 'Eksantrik mili konum sensörü sinyalinde sorun.',
    checkSuggestion: 'Sensör ve kablo tesisatı kontrol edilmeli.',
  },
  P0401: {
    title: 'EGR Akışı Yetersiz',
    detail: 'Egzoz gazı resirkülasyon sisteminde yetersiz akış.',
    checkSuggestion: 'EGR valfi ve ilgili hortumlar/kanallar kontrol edilmeli.',
  },
  P0420: {
    title: 'Katalitik Konvertör Verimliliği Düşük (Bank 1)',
    detail: 'Katalitik konvertör verimliliği eşiğin altında.',
    checkSuggestion: 'Katalitik konvertör ve oksijen sensörleri kontrol edilmeli.',
  },
  P0430: {
    title: 'Katalitik Konvertör Verimliliği Düşük (Bank 2)',
    detail: 'Katalitik konvertör verimliliği eşiğin altında.',
    checkSuggestion: 'Katalitik konvertör ve oksijen sensörleri kontrol edilmeli.',
  },
  P0440: {
    title: 'Buharlaşma Emisyon Sistemi Arızası',
    detail: 'EVAP sisteminde genel bir arıza tespit edildi.',
    checkSuggestion: 'Yakıt kapağı sızdırmazlığı ve EVAP hortumları kontrol edilmeli.',
  },
  P0442: {
    title: 'Buharlaşma Sisteminde Küçük Sızıntı',
    detail: 'EVAP sisteminde küçük bir sızıntı tespit edildi.',
    checkSuggestion: 'Yakıt kapağının tam kapandığından emin olun, EVAP hortumları kontrol edilmeli.',
  },
  P0455: {
    title: 'Buharlaşma Sisteminde Büyük Sızıntı',
    detail: 'EVAP sisteminde büyük bir sızıntı tespit edildi.',
    checkSuggestion: 'Yakıt kapağı ve EVAP sistemi bileşenleri kontrol edilmeli.',
  },
  P0500: {
    title: 'Araç Hız Sensörü Arızası',
    detail: 'Araç hız sensörü sinyalinde sorun.',
    checkSuggestion: 'Hız sensörü ve kablo bağlantısı kontrol edilmeli.',
  },
  P0505: {
    title: 'Rölanti Kontrol Sistemi Arızası',
    detail: 'Rölanti hava kontrol sisteminde sorun.',
    checkSuggestion: 'Rölanti kontrol valfi ve gaz kelebeği gövdesi kontrol edilmeli.',
  },
  P0562: {
    title: 'Sistem Voltajı Düşük',
    detail: 'Kontrol modülünün algıladığı besleme voltajı düşük.',
    checkSuggestion: 'Akü, alternatör ve şarj sistemi kontrol edilmeli.',
  },
  P0563: {
    title: 'Sistem Voltajı Yüksek',
    detail: 'Kontrol modülünün algıladığı besleme voltajı yüksek.',
    checkSuggestion: 'Alternatör ve şarj sistemi kontrol edilmeli.',
  },
  P0600: {
    title: 'Seri İletişim Bağlantısı Arızası',
    detail: 'Kontrol modülleri arası iletişimde sorun.',
    checkSuggestion: 'Araç içi ağ (CAN bus) ve ilgili kontrol modülleri kontrol edilmeli.',
  },
  P0700: {
    title: 'Şanzıman Kontrol Sistemi Arızası',
    detail: 'Şanzıman kontrol modülü bir arıza bildirdi (detay için şanzıman modülü ayrıca okunmalı).',
    checkSuggestion: 'Yetkili serviste şanzıman kontrol modülü ayrıca taranmalı.',
  },
};

/** @type {DtcDescription} Listede olmayan kodlar için varsayılan. */
export const DEFAULT_DTC_DESCRIPTION = {
  title: 'Tanımlanmamış Kod',
  detail: 'Bu kod için yerel açıklama veritabanında bir kayıt yok.',
  checkSuggestion: 'Kodun tam anlamı için yetkili servise danışmanız önerilir.',
};

/**
 * Bir DTC kodu için açıklama döndürür (listede yoksa varsayılan).
 * @param {string} code
 * @returns {DtcDescription}
 */
export function getDtcDescription(code) {
  return DTC_DESCRIPTIONS[code.toUpperCase()] ?? DEFAULT_DTC_DESCRIPTION;
}
