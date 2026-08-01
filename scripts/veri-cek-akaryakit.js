// Smart Drive AI — Akaryakıt fiyatları statik yedek veri üretici
//
// NEDEN: Uygulama "okul-ai-asistan" Cloudflare Worker'ından il/ilçe bazlı
// akaryakıt fiyatı çekiyor, ama bazı ağlarda workers.dev'e erişim
// engelleniyor (Kasam'da tespit edilen aynı sorun). Bu script,
// doviz.com/akaryakit-fiyatlari sayfalarını GitHub Actions'ın sunucusundan
// TÜM il ve ilçeler için tarayıp tek bir statik JSON'a yazar. Uygulama,
// worker'a ulaşamadığında bu JSON'u (raw.githubusercontent.com üzerinden)
// yedek olarak kullanabilir.
//
// NASIL ÇALIŞIR (elle il/ilçe listesi YAZILMADI — sayfadan otomatik keşfediliyor):
//   1. Ana sayfadan (/akaryakit-fiyatlari) tüm il slug'larını çıkar
//      (href="/akaryakit-fiyatlari/{il}" — TEK segment, ilçe/dağıtıcı
//      linkleri iki/üç segmentli olduğu için otomatik elenir).
//   2. Her il sayfasından o ilin ilçe slug'larını çıkar
//      (href="/akaryakit-fiyatlari/{il}/{ilce}" — İKİ segment).
//   3. Her il/ilçe sayfasından fiyat tablosunu (Dağıtıcı/Benzin/Motorin/
//      LPG/Tarih) ayrıştır.
//
// ÖLÇEK UYARISI: Türkiye'de ~980 ilçe var, bu yüzden bu script binin
// üzerinde HTTP isteği atar. doviz.com'u aşırı yormamak için sınırlı
// eşzamanlılık (concurrency) ve istekler arası küçük bir bekleme kullanır.
// Bu yüzden ilk çalıştırma uzun (muhtemelen 15-40 dakika) sürebilir —
// bu normaldir, GitHub Actions'ın ücretsiz plan sınırı (job başına 6 saat)
// içinde rahatça kalır.

const fs = require('fs');
const path = require('path');

const BASE = 'https://www.doviz.com/akaryakit-fiyatlari';
const ESZAMANLILIK = 5;           // aynı anda en fazla 5 istek
const ISTEKLER_ARASI_MS = 150;    // her istekten önce küçük bir bekleme
const ZAMAN_ASIMI_MS = 12000;

function gecikme(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sayfaGetir(url) {
  const denetleyici = new AbortController();
  const zamanlayici = setTimeout(() => denetleyici.abort(), ZAMAN_ASIMI_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: denetleyici.signal
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  } finally {
    clearTimeout(zamanlayici);
  }
}

/**
 * Basit bir "havuz" (pool) çalıştırıcı: verilen görev listesini en fazla
 * `eszamanlilik` kadarını aynı anda çalıştırır, aralarına küçük bir
 * bekleme koyar. Tek bir görevin hata vermesi diğerlerini etkilemez.
 */
async function havuzdaCalistir(gorevler, isleyici, eszamanlilik) {
  const sonuclar = new Array(gorevler.length);
  let sonrakiIndex = 0;

  async function isci() {
    while (sonrakiIndex < gorevler.length) {
      const index = sonrakiIndex++;
      await gecikme(ISTEKLER_ARASI_MS);
      try {
        sonuclar[index] = await isleyici(gorevler[index], index);
      } catch (e) {
        sonuclar[index] = { hata: e.message };
      }
    }
  }

  const isciler = Array.from({ length: Math.min(eszamanlilik, gorevler.length) }, () => isci());
  await Promise.all(isciler);
  return sonuclar;
}

/** href="/akaryakit-fiyatlari/{tekSegment}" biçimindeki linkleri (il listesi) çıkarır. */
function ilLinkleriniCikar(html) {
  const re = /href="\/akaryakit-fiyatlari\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>/g;
  const bulunan = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    const ad = m[2].trim();
    if (!bulunan.has(slug)) bulunan.set(slug, ad);
  }
  return bulunan;
}

/** href="/akaryakit-fiyatlari/{il}/{ilce}" biçimindeki linkleri (ilçe listesi) çıkarır. */
function ilceLinkleriniCikar(html, ilSlug) {
  const kacis = ilSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href="\\/akaryakit-fiyatlari\\/${kacis}\\/([a-z0-9-]+)"[^>]*>([^<]+)<\\/a>`, 'g');
  const bulunan = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    const ad = m[2].trim();
    if (!bulunan.has(slug)) bulunan.set(slug, ad);
  }
  return bulunan;
}

/** Sayfadaki fiyat tablosunu (Dağıtıcı/Benzin/Motorin/LPG/Tarih) düz metinden ayrıştırır. */
function fiyatTablosunuAyristir(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const sayi = (str) => {
    if (!str || str === '-') return null;
    const n = parseFloat(String(str).replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  const satirRe = /([A-Za-zÇĞİÖŞÜçğıöşü0-9. ]{2,40}?)\s*₺?([\d,]+|-)\s*₺?([\d,]+|-)\s*₺?([\d,]+|-)\s*(\d{2}\.\d{2}\.\d{4})/g;
  const istasyonlar = [];
  let m;
  while ((m = satirRe.exec(text)) !== null) {
    const dagitici = m[1].trim();
    // Çok kısa/anlamsız veya tekrarlanan eşleşmeleri ele (nav metinlerinden gelebilir)
    if (dagitici.length < 2) continue;
    istasyonlar.push({
      dagitici,
      benzin: sayi(m[2]),
      motorin: sayi(m[3]),
      lpg: sayi(m[4]),
      tarih: m[5]
    });
  }
  return istasyonlar;
}

async function calistir() {
  console.log('İl listesi keşfediliyor...');
  const anaSayfaHtml = await sayfaGetir(BASE);
  const iller = ilLinkleriniCikar(anaSayfaHtml);
  console.log(`${iller.size} il bulundu.`);

  const ilSlugListesi = Array.from(iller.keys());
  const sonuc = { iller: {} };

  console.log('Her ilin ilçe listesi keşfediliyor...');
  const ilSayfalari = await havuzdaCalistir(ilSlugListesi, async (ilSlug) => {
    const html = await sayfaGetir(`${BASE}/${ilSlug}`);
    return { ilSlug, html };
  }, ESZAMANLILIK);

  // İl+ilçe görev listesini oluştur
  const ilceGorevleri = [];
  for (const kayit of ilSayfalari) {
    if (!kayit || kayit.hata || !kayit.html) continue;
    const { ilSlug, html } = kayit;
    const ilAdi = iller.get(ilSlug);
    const ilceler = ilceLinkleriniCikar(html, ilSlug);
    sonuc.iller[ilSlug] = { ad: ilAdi, ilceler: {} };
    for (const [ilceSlug, ilceAdi] of ilceler) {
      ilceGorevleri.push({ ilSlug, ilceSlug, ilceAdi });
    }
  }
  console.log(`Toplam ${ilceGorevleri.length} il/ilçe kombinasyonu taranacak.`);

  let tamamlanan = 0;
  const ilceSonuclari = await havuzdaCalistir(ilceGorevleri, async (gorev) => {
    const { ilSlug, ilceSlug, ilceAdi } = gorev;
    const html = await sayfaGetir(`${BASE}/${ilSlug}/${ilceSlug}`);
    const istasyonlar = fiyatTablosunuAyristir(html);
    tamamlanan++;
    if (tamamlanan % 50 === 0) console.log(`${tamamlanan}/${ilceGorevleri.length} tamamlandı...`);
    return { ilSlug, ilceSlug, ilceAdi, istasyonlar };
  }, ESZAMANLILIK);

  let basariliSayisi = 0;
  for (const r of ilceSonuclari) {
    if (!r || r.hata) continue;
    const { ilSlug, ilceSlug, ilceAdi, istasyonlar } = r;
    if (!sonuc.iller[ilSlug]) continue;
    sonuc.iller[ilSlug].ilceler[ilceSlug] = { ad: ilceAdi, istasyonlar };
    if (istasyonlar.length > 0) basariliSayisi++;
  }

  sonuc.kaynak = 'doviz.com/akaryakit-fiyatlari';
  sonuc.guncellemeZamani = new Date().toISOString();
  sonuc.toplamIlceSayisi = ilceGorevleri.length;
  sonuc.basariliIlceSayisi = basariliSayisi;

  const cikisDizini = path.join(__dirname, '..', 'veri');
  fs.mkdirSync(cikisDizini, { recursive: true });
  fs.writeFileSync(path.join(cikisDizini, 'akaryakit-veri.json'), JSON.stringify(sonuc));

  console.log(`Yazıldı: veri/akaryakit-veri.json (${basariliSayisi}/${ilceGorevleri.length} ilçe başarılı)`);

  if (basariliSayisi === 0) {
    console.error('Hiçbir ilçe için veri alınamadı - sayfa yapısı değişmiş olabilir.');
    process.exit(1);
  }
}

calistir().catch((e) => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});
