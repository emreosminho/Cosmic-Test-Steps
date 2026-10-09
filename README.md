# Cosmic Test Steps

Chrome (Manifest V3) eklentisi: manuel web/QA testlerinde **ekran görüntüsü + adım açıklaması** toplar, adımları düzenlersin ve tek dosyada **Word uyumlu rapor** indirirsin.

## Ne işe yarar?

Test sırasında sayfada ne yaptığını adım adım belgelemek için. Her adımda görsel ve metin birikir; sonunda paylaşılabilir bir test raporu oluşur. Otomasyon değil; **manuel test dokümantasyonu** odaklıdır.

## Özellikler

- **Yan panel** — Araç çubuğu ikonuna tıklayarak sağda paneli aç/kapat; sekme değişince açık kalabilir.
- **Ekran görüntüsü**
  - **Al** veya **⌘⇧S** — Görünür sekme (panel yakalama sırasında gizlenir).
  - **⌘⇧X** — Sayfada alan seç, kırp, önizle, panele ekle.
- **Adım kartları** — Her adıma açıklama yaz; sürükle-bırak ile sırala.
- **Test başlığı** — Kalem ikonu ile düzenle; rapor başlığı ve indirme dosya adına yansır.
- **Kalıcılık** — Adımlar `chrome.storage.local` ile saklanır; paneli kapatıp açsan da veri durur.
- **Rapor** — **İndir** ile `.doc` (HTML tabanlı, Word’de açılır): tarih, görseller, sayfa kırılımları.

## Kurulum (geliştirici modu)

1. Bu repoyu indir veya klonla.
2. Chrome’da `chrome://extensions` aç.
3. **Geliştirici modu**nu aç → **Paketlenmemiş öğe yükle**.
4. `manualTestExt` (manifest.json’un olduğu) klasörünü seç.

## Kullanım

1. Test edeceğin sayfada eklenti ikonuna tıkla → panel açılır.
2. **Al** ile tam ekran veya **⌘⇧X** ile bölge yakala.
3. Her kartın altına ne test ettiğini yaz.
4. Bittiğinde **İndir** → raporu kaydet.
5. Yeni test için **Temizle** (mevcut adımları siler).

## Kısayollar

| Kısayol | İşlem |
|--------|--------|
| ⌘⇧S | Tam ekran görüntü |
| ⌘⇧X | Alan seçerek görüntü |

*(macOS; Windows/Linux’ta genelde Ctrl+Shift+S / Ctrl+Shift+X.)*

## Proje yapısı

| Dosya | Rol |
|--------|-----|
| `manifest.json` | İzinler, content script, panel kaynakları |
| `background.js` | Panel aç/kapa, `captureVisibleTab` |
| `content_script.js` | Panel iframe, yakalama, alan seçimi |
| `panel/` | Panel UI, adım listesi, rapor üretimi |

## Lisans

Bu depo kişisel/kullanım amaçlıdır; lisans eklenmediyse kullanım için depo sahibiyle iletişime geçin.
