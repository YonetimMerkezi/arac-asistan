# Smart Drive AI — Yol Haritası

## Durum: Faz 0 tamamlandı (İskelet)

## Faz Sırası
- [x] **Faz 0** — Klasör yapısı, tema sistemi (koyu/açık/dinamik), uygulama kabuğu, logger, view-router
- [x] **Faz 1** — Bluetooth bağlantı yönetimi + ELM327 komut katmanı + PID keşfi + VIN okuma
- [x] **Faz 2** — Ana ekran canlı veri (gösterge kartları + arc gauge bileşeni)
- [x] **Faz 3** — Sesli asistan (TTS karşılama, STT komutlar, sesli uyarılar)
- [x] **Faz 4** — Yolculuk kaydı (SQLite, Chart.js, PDF/Excel rapor)
- [x] **Faz 5** — Navigasyon + hız limiti/radar uyarıları (OSM)
- [x] **Faz 6** — Yakıt & Bakım modülleri
- [x] **Faz 7** — Arıza Merkezi (DTC okuma/silme, Türkçe açıklama, maliyet tahmini)
- [ ] **Faz 8** — Yapay zekâ katmanı (sürüş analizi, tahminler, haftalık rapor)
- [ ] **Faz 9** — Firebase (Auth/Firestore/FCM), ayarlar ekranı, offline senkron, güvenlik

## Klasör Haritası
```
smart-drive-ai/
├── package.json
├── capacitor.config.json      (webDir: www)
├── android/                   (Faz 1'de `npx cap add android` ile doldurulacak)
└── www/                       ← Capacitor'ın paketlediği statik kaynak
    ├── index.html
    ├── assets/icons/
    └── src/
        ├── core/               app-init, theme-manager, view-router, logger
        ├── bluetooth/          (Faz 1)
        ├── obd/                (Faz 1)
        ├── voice/              (Faz 3)
        ├── trip/               (Faz 4)
        ├── charts/             (Faz 4)
        ├── data/               SQLite erişim katmanı (Faz 4+)
        ├── maps/               (Faz 5)
        ├── fuel/               (Faz 6)
        ├── maintenance/        (Faz 6)
        ├── diagnostics/        (Faz 7)
        ├── ai/                 (Faz 8)
        ├── settings/           (Faz 9)
        └── ui/
            ├── styles/          theme.css, base.css
            └── components/      (paylaşılan bileşenler, örn. gauge.js — Faz 2)
```

## Tasarım Dili (Faz 0'da kuruldu)
- Zemin: grafit tonları (gösterge paneli kimliği), saf siyah/beyaz değil
- Vurgu: kehribar/turuncu (analog ibre) + camgöbeği (dijital telemetri)
- Rakamlar: mono genişlikli yazı tipi (JetBrains Mono) — etiketler: Inter
- İmza öğe: yay (arc) gösterge çizgisi — Faz 2'de `ui/components/gauge.js` olarak tüm kartlarda tekrar edecek
- `--sda-accent-hue` CSS değişkeni JS'ten güncellenebilir (Android 12+ Material You için hazır)

## Faz 1'de Verilen Kararlar (uygulandı)
1. **Bundler: esbuild.** `build.js` eklendi, `www/src/core/app-init.js`
   giriş noktasından `www/dist/app.bundle.js`'i üretiyor. `index.html` artık
   bu paketi yüklüyor. Geliştirirken `npm run watch`, üretim için `npm run build`.
2. **Bluetooth Classic (SPP), BLE değil.** Ucuz ELM327 klonlarının çoğu SPP
   kullandığı için `@capacitor-community/bluetooth-le` kaldırıldı; onun yerine
   özel `BluetoothClassicPlugin.kt` (SPP UUID `00001101-...`) yazıldı.
   JS köprüsü: `src/bluetooth/native-bridge.js`.

## Faz 1 Kapsamı (tamamlandı)
- `src/bluetooth/native-bridge.js` — native eklenti kaydı
- `src/bluetooth/bluetooth-manager.js` — kayıtlı cihazı hatırlama, bağlan/kes,
  beklenmedik kopmada üstel geri çekilmeli otomatik yeniden bağlanma
  (maks. 8 deneme, 2sn→30sn), bağlantı kalitesi (`good`/`weak`/`none`)
  hesaplama
- `src/obd/pid-definitions.js` — saf veri: PID formülleri (SAE J1979)
- `src/obd/elm327.js` — komut kuyruğu, ATZ/ATE0/ATL0/ATH0/ATSP0 başlatma
  dizisi, 00/20/40 PID grup keşfi, VIN okuma (Mod 09), yakıt tipi okuma (PID 51),
  genel `queryPid()` sorgusu
- `app-init.js` içine bağlandı: açılışta kayıtlı cihaza sessiz otomatik bağlanma
  + üst çubuktaki durum noktasının canlı güncellenmesi

## ⚠️ Bilgisayar Yok — Derleme Bulutta Yapılıyor (GitHub Actions)
Sedat şu an yalnızca telefondan çalışıyor, bu yüzden `npx cap add android` /
Android Studio / Gradle gibi adımlar yerel olarak ÇALIŞTIRILAMAZ.
Bunun yerine `.github/workflows/build-android.yml` eklendi: her `git push`'ta
GitHub'ın bulut sunucusu şunları otomatik yapar:
1. `npm run build` (esbuild paketleme)
2. Android platformunu sıfırdan üretir (`npx cap add android`)
3. Elle yazdığımız `BluetoothClassicPlugin.kt`/`MainActivity.kt`'yi geri kopyalar
4. `scripts/patch-manifest.js` ile gerekli Bluetooth izinlerini manifest'e ekler
5. `./gradlew assembleDebug` ile APK derler
6. Sonucu "Actions" sekmesinde indirilebilir `smart-drive-ai-debug-apk`
   artifact'i olarak yayınlar

### Telefondan kurulum (tek seferlik)
1. github.com'da hesap yoksa oluştur, yeni **private** repo aç (ör. `smart-drive-ai`)
2. Telefonda zip'i "Dosyalar" uygulamasıyla aç (klasöre çıkart)
3. Repo sayfasında **Add file → Upload files**, çıkardığın klasördeki tüm
   dosya/klasörleri seç ve yükle (mobil Chrome'da klasör seçimi destekleniyor)
4. Commit et → **Actions** sekmesine düş, "Android APK Derle" iş akışı otomatik
   başlar (~5-8 dk sürer)
5. İş akışı bitince açtığın çalıştırmanın altındaki **Artifacts** bölümünden
   `smart-drive-ai-debug-apk`'yı indir, telefonda kur (Bilinmeyen kaynaklara
   izin vermek gerekebilir)

### Sonraki değişiklikler için (Android Studio'suz düzenleme)
Repo sayfasında klavyeden **"."** tuşuna bas → tarayıcıda **github.dev**
açılır (VS Code benzeri, dokunmatik uyumlu bir düzenleyici). Orada dosya
değiştirip commit edebilirsin; her commit otomatik yeni bir APK derlemesi
tetikler. Bu sayede tüm geliştirme süreci Android Studio'ya hiç ihtiyaç
duymadan telefondan yürütülebilir.

## Faz 1 Test Notu
Fiziksel bir ELM327 adaptörü Android sistem ayarlarından önce eşleştirilmeli
(paired). Uygulama şu an cihaz seçim arayüzüne sahip değil (bu, Faz 9 Ayarlar
ekranında gelecek); test için geçici olarak `bluetooth-manager.js`'deki
`connectToDevice(address, name)` fonksiyonu doğrudan çağrılabilir veya
Faz 2/9'da erken bir "cihaz seç" ekranı öne çekilebilir.

## Faz 2 Kapsamı (tamamlandı)
- `ui/components/gauge.js` — `<sda-gauge>` Web Component'i (Shadow DOM, framework-free),
  imza yay (arc) çizimi; hem ana hız göstergesinde (size="lg") hem küçük
  kartlarda (size="sm") aynı bileşen kullanılıyor
- `core/vehicle-info-store.js` — Faz 1'de keşfedilen supportedPids/VIN/yakıt
  tipini tüm modüllerin okuyabileceği tek paylaşılan durum
- `ui/dashboard-view.js` — 9 kartlık ızgara (hız, RPM, hararet, voltaj, yakıt,
  motor yükü, gaz kelebeği, emme havası, dış sıcaklık); bağlıyken PID'leri
  ardışık (ELM327 yarı çift yönlü olduğu için paralel değil) sorgulayan poll
  döngüsü; desteklenmeyen PID'lerin kartlarını otomatik gizleme
- `index.html`'deki dashboard placeholder'ı kaldırıldı, artık JS ile inşa ediliyor

## Faz 3 Kapsamı (tamamlandı)
- `voice/tts.js` — sıralı seslendirme kuyruğu (@capacitor-community/text-to-speech)
- `voice/stt.js` — sürekli dinleme döngüsü (@capacitor-community/speech-recognition),
  her cümleden sonra otomatik yeniden başlar
- `voice/greeting.js` — bağlantı karşılama cümlesi (motor sıcaklığı, dış sıcaklık,
  akü voltajı, yakıt seviyesi); **not:** orijinal metindeki "Sürüş kaydı
  başlatılıyor" cümlesi BİLİNÇLİ olarak çıkarıldı çünkü Faz 4 (yolculuk kaydı)
  henüz yok - gerçekte başlamayan bir şeyi başlatılıyormuş gibi söylemek yanlış
  olurdu. Faz 4 tamamlanınca hem cümle hem gerçek trip-start çağrısı eklenecek.
- `voice/voice-commands.js` — anahtar kelime eşleştirme; şu an çalışan komutlar:
  motor sıcaklığı, yakıt seviyesi, akü voltajı, hız, motor devri. Henüz
  geliştirilmemiş modüllere ait komutlar (arıza kodu, navigasyon, bakım, ortalama
  tüketim) dürüstçe "henüz hazır değil" yanıtı veriyor - sahte veri yok.
- `voice/voice-alerts.js` — histerezisli eşik uyarıları (hararet ≥108°C,
  akü <11.8V, yakıt ≤%12)
- `core/vehicle-live-data-store.js` — dashboard'un okuduğu değerleri sesli
  modülle paylaşan önbellek (PID'i iki kez sorgulamamak için)
- `scripts/patch-manifest.js`'e `RECORD_AUDIO` izni eklendi

## Faz 4 Kapsamı (tamamlandı)
- `data/database.js` — SQLite bağlantı yaşam döngüsü + şema (trips, trip_points)
- `data/trip-repository.js` — tüm SQL burada toplu (CRUD)
- `trip/geo-utils.js` — haversine mesafe hesabı (saf fonksiyon, Faz 5 navigasyon da kullanacak)
- `trip/trip-recorder.js` — Bluetooth bağlanınca OTOMATİK yolculuk başlatma,
  kesilince otomatik bitirme; GPS izi (throttle'lı), MAF (PID 10) entegrasyonuyla
  yakıt tüketimi tahmini (stokiyometrik AFR yöntemi - Torque benzeri uygulamaların
  kullandığı yaklaşım)
- `charts/trip-chart.js` — Chart.js hız-zaman grafiği (canvas bazlı, bellek
  sızıntısı önleme için destroy() çağrılıyor)
- `trip/trip-report-pdf.js` / `trip/trip-report-excel.js` — jsPDF/SheetJS ile rapor üretimi
- `trip/file-export.js` — @capacitor/filesystem + @capacitor/share ile
  kaydetme/paylaşma (tek nokta, PDF ve Excel ikisi de kullanıyor)
- `ui/trip-view.js` — liste → detay (grafik + PDF/Excel butonları) akışı
- greeting.js'teki "Sürüş kaydı başlatılıyor" cümlesi artık GERÇEK - trip-recorder
  aynı anda tetikleniyor
- Manifest yamasına `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` eklendi

## Not: @capacitor-community/sqlite
Yalnızca Android hedeflendiği için `jeep-sqlite` web bileşenine gerek yok
(o yalnızca tarayıcı/PWA hedefi için gerekli). `npx cap sync android` native
plugin'i otomatik bağlar - BluetoothClassicPlugin'in aksine elle
`registerPlugin()` eklemeye gerek YOK.

## Faz 5 Kapsamı (tamamlandı)
- **Önemli refactor:** GPS izleme artık `core/gps-tracker.js`'te TEK bir merkezi
  kaynak - Bluetooth bağlantı durumuna göre kendi kendini başlatıp durduruyor.
  trip-recorder.js artık kendi Geolocation.watchPosition() çağrısını AÇMIYOR,
  yalnızca onPosition() ile abone oluyor. Faz 5'in tüm modülleri (navigasyon,
  hız uyarısı, radar, koridor) aynı kaynağı paylaşıyor - pil tüketimi ve kod
  tekrarı önlendi.
- `maps/overpass-client.js` — OSM Overpass API için ortak sorgu istemcisi
  (hız limiti, sabit radar, POI arama hepsi bunu kullanıyor)
- `maps/speed-limit-service.js` — yoldan hız limiti okuma (mesafe/süre
  throttle'lı, gereksiz sorgu yok)
- `maps/speed-camera-service.js` — **sabit** hız denetim noktaları (OSM
  `highway=speed_camera` - herkese açık haritalama verisi, aktif radar
  TESPİTİ değil) için yaklaşım uyarısı
- `maps/speed-warning.js` — hız sınırı değişince ve aşılınca sesli uyarı (histerezisli)
- `maps/favorites-store.js` — Ev/İş/favori konumlar (Preferences)
- `maps/route-service.js` — OSRM halka açık sunucusuyla rota hesabı
- `maps/poi-search.js` — yakın otopark/akaryakıt/servis/hastane arama
- `data/corridor-repository.js` + `maps/average-speed-corridor.js` —
  ortalama hız koridoru giriş/çıkış tespiti ve hesabı. **Not:** Türkiye
  çapında hazır bir koridor veri tabanı yok, bu yüzden koridorlar kullanıcı
  tanımlı (Faz 9'da ekleme arayüzü gelecek) - sahte veri YOK, mekanizma
  eksiksiz ama veri kaynağı kullanıcı.
- `ui/navigation-view.js` — Leaflet harita, canlı konum, Eve Git/İşe Git
  (rota çizimi), yakın POI butonları
- `voice/voice-commands.js` — "beni eve götür" ve "en yakın akaryakıt
  istasyonu" artık GERÇEK yanıt veriyor (önceden "henüz hazır değil" idi)
- Manifest yamasına `INTERNET`/`ACCESS_NETWORK_STATE` eklendi

## Not: Navigasyon Özellikleri İnternet Gerektirir
Harita karoları (OpenStreetMap), Overpass (hız limiti/radar/POI) ve OSRM
(rota) hepsi halka açık, ücretsiz servislerdir ve İNTERNET ister. OBD/gösterge
panosu/sesli asistan özellikleri bundan etkilenmez, offline çalışmaya devam eder.

## Faz 6 Kapsamı (tamamlandı)
- `data/fuel-repository.js` — yakıt alımları CRUD (litre, tutar, km, litre fiyatı)
- `data/maintenance-repository.js` — bakım kalemleri CRUD (8 tür: yağ, filtre,
  triger, lastik, muayene, sigorta, kasko, egzoz emisyonu)
- `fuel/odometer-estimator.js` — **dürüstlük notu:** standart OBD Mod 01'de
  toplam km sayacı PID'i YOK. Bu yüzden kullanıcının bir kez girdiği taban
  km değerine, o andan sonraki yolculuk mesafeleri toplamı eklenerek TAHMİN
  ediliyor - UI'da her zaman "tahmini" etiketli
- `maintenance/maintenance-reminder.js` — süresi dolan kalemler için BİR KEZ
  sesli hatırlatma (Preferences'ta "uyarıldı" işareti, tekrar spam yok)
- `charts/fuel-chart.js` — litre fiyatı geçmişi grafiği
- `ui/fuel-view.js` — yakıt kaydı formu + grafik + liste, bakım kalemi formu +
  liste (süresi dolanlar kırmızı vurgulu)
- `voice/voice-commands.js` — "ortalama tüketim" (trip verilerinden gerçek
  hesap) ve "bakım ne zaman" artık GERÇEK yanıt veriyor
- "En ucuz mazot nerede" komutu hâlâ NOT_READY - bu, istasyon bazlı canlı
  yakıt fiyatı karşılaştırması gerektiriyor ve Türkiye'de ücretsiz/açık böyle
  bir veri kaynağı yok; sahte veri uydurmak yerine dürüstçe "hazır değil" diyor

## Faz 7 Kapsamı (tamamlandı)
- `obd/elm327.js`'e `readDtcCodes()` (Mod 03) ve `clearDtcCodes()` (Mod 04)
  eklendi; standart SAE J2012 byte-çözme algoritmasıyla P/C/B/U kod formatına çevriliyor
- `diagnostics/dtc-descriptions.js` — ~20 yaygın jenerik (üretici bağımsız)
  kod için Türkçe başlık + açıklama + genel kontrol önerisi (saf veri dosyası)
- `data/dtc-repository.js` — okuma geçmişi
- `diagnostics/dtc-report-pdf.js` — trip-report-pdf.js ile aynı desende PDF raporu
- `ui/diagnostics-view.js` — oku/sil butonları, kod kartları, "internette ara"
  linki (@capacitor/browser ile), geçmiş listesi, PDF dışa aktarma
- `voice/voice-commands.js` — "arıza kodlarını oku" artık gerçek kodları
  okuyup özetliyor

## ⚠️ Bilinçli Olarak Eklenmeyenler (dürüstlük gerekçesiyle)
- **"Tahmini maliyet"**: Onarım maliyeti araca/bölgeye/işçiliğe göre o kadar
  değişir ki genel bir sayı vermek yanıltıcı olurdu - eklenmedi.
- **Sesli "arıza kodlarını sil"**: Kod silme geri alınamaz bir işlem. Sürüş
  sırasında yanlışlıkla (ör. başka bir konuşmadan) tetiklenmesini önlemek
  için sesli komut bunu YAPMAZ, kullanıcıyı Arıza Merkezi ekranındaki onay
  diyaloğuna yönlendirir. UI'daki silme işlemi `window.confirm()` ile korunuyor.
- **"İnternetten açıklama" (otomatik)**: Güvenilir, ücretsiz bir DTC açıklama
  API'si yok - bunun yerine kullanıcıyı Google aramasına yönlendiren bir
  buton eklendi (gerçek bir API entegrasyonu uydurulmadı).

## Sıradaki Adım: Faz 8 — Yapay Zekâ Katmanı
- Sürüş stili analizi (trip verilerinden)
- Sürüş puanı hesaplama
- Haftalık rapor
- Bakım/arıza tahminleri (mevcut verilerden çıkarılabilecek ölçüde,
  uydurma olasılık yüzdeleri OLMADAN)

## Kod Standartları (uygulanıyor)
- Dosya başına maks. 500 satır
- ES Module, global değişken yok
- Her fonksiyonda JSDoc
- Her modül bağımsız (core/logger.js gibi ortak servisler hariç import zinciri yok)
