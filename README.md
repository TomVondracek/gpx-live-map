# UltraLog – Live Running Map System

Mobilní Android aplikace pro zaznamenávání poznámek při běhu (text / audio / foto) s live Leaflet mapou pro pozorovatele.

---

## Deploy Status

<!-- DEPLOY_STATUS:START -->
- Poslední úspěšný deploy: 2026-04-21 09:30:11
- Agent: Codex (GPT-5.4)
- APK build: fresh Gradle debug rebuild
- APK cesta: `android\app\build\outputs\apk\debug\app-debug.apk`
- Google Drive: https://drive.google.com/drive/folders/1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj
<!-- DEPLOY_STATUS:END -->

---

## Architektura

```
Běžcův Android telefon (Capacitor 6 native app)
        │
        ├─ Google STT (online, cs-CZ)   ──→ textový přepis  (primární)
        ├─ Vosk STT (offline Czech)     ──→ textový přepis  (záloha)
        ├─ MediaDevices API             ──→ audio nahrávka  (WebM/Base64)
        ├─ Capacitor Camera             ──→ fotografie       (JPEG/Base64)
        ├─ Capacitor Geolocation        ──→ GPS souřadnice  (watchPosition + cache)
        ├─ Capacitor Haptics            ──→ haptická odezva
        ├─ Screen Wake Lock API         ──→ displej svítí při nahrávání
        │
        ▼
  IndexedDB offline fronta (sw.js – Service Worker + Background Sync)
        │
        ├─ Online: direct POST ──→ Google Apps Script ──┬─→ Google Sheets (metadata, texty, Drive ID)
        │                                               └─→ Google Drive (audio, foto soubory)
        └─ Offline: uloženo do fronty
             └─ Background Sync / visibilitychange → flush při reconnectu

                                                      │
                                                      ▼
                                             GitHub Pages (Leaflet.js)
                                                      │
                                                      ▼
                                             Live mapa pro pozorovatele
                                             (mapa + poznámky + audio + foto lightbox)
```

---

## Struktura projektu

```
C:\DEV\gpx-live-map\
│
│  # ── Zdrojové soubory (editovat zde) ──────────────────────────
├── app.html              # UI mobilní aplikace (CSS + HTML)
├── app.js                # Veškerá JS logika (~1400 řádků)
├── sw.js                 # Service Worker (Background Sync, IDB config store)
├── index.html            # Live mapa pro pozorovatele (Leaflet.js)
├── appscript.js          # Google Apps Script backend (nasadit do GAS)
├── trasa.gpx             # GPX plánovaná trasa
│
│  # ── Capacitor / Android ──────────────────────────────────────
├── capacitor.config.ts   # Capacitor konfigurace (appId: cz.behpoznamky.app, appName: UltraLog)
├── package.json          # npm závislosti (Capacitor 6 + pluginy)
├── www/                  # GENEROVÁNO – needitovat (build: scripts/copy-www.js)
├── android/
│   ├── app/
│   │   ├── build.gradle                  # Vosk SDK deps, noCompress config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml       # Oprávnění: audio, lokace, síť, kamera
│   │       ├── res/
│   │       │   ├── mipmap-*/             # Ikony pro všechny Android density (generováno)
│   │       │   └── values/strings.xml    # app_name: "UltraLog"
│   │       ├── assets/
│   │       │   ├── models/vosk-model-small-cs/  # Český Vosk model (~40 MB, gitignored)
│   │       │   └── public/               # Web assets (kopíruje cap sync)
│   │       └── java/cz/behpoznamky/app/
│   │           ├── MainActivity.java
│   │           ├── vosk/VoskPlugin.java
│   │           └── googlestt/GoogleSTTPlugin.java
│   └── variables.gradle                  # SDK verze (compileSdk=35, minSdk=24)
│
│  # ── Build skripty ────────────────────────────────────────────
├── scripts/
│   ├── copy-www.js             # Kopíruje web assets do www/ (app.html→index.html)
│   ├── generate-icons.js       # Generuje Android mipmap ikony z icon-source.png
│   ├── create-icon-source.js   # Generuje SVG-based icon-source.png (fallback)
│   ├── upload-apk.js           # Nahrává APK na Google Drive (OAuth2)
│   └── download-vosk-model.js  # Stahuje český Vosk model do android assets
│
│  # ── Konfigurace (gitignored) ──────────────────────────────────
├── runtime-config.js           # WRITE_TOKEN, SHEET_URL (gitignored)
├── gdrive-oauth-client.json    # OAuth2 Desktop App credentials (gitignored)
├── .gdrive-token.json          # OAuth2 refresh token (generováno při prvním upload-apk)
├── gdrive-service-account.json # Service Account credentials (gitignored, nepoužívá se)
└── icon-source.png             # Zdrojová ikona 1024×1024 (gitignored)
```

---

## Build & vývoj

### Prerekvizity

- **Node.js** (v18+)
- **Android Studio** (Hedgehog nebo novější) s Android SDK
- **Java JDK 21**

### První spuštění po klonování

```powershell
npm install
node scripts/download-vosk-model.js   # stáhne ~40 MB Vosk model
```

### Build APK

```powershell
npm run build                          # kopíruje web assets do www/
npx cap sync                          # synchronizuje do android/
cd android
.\gradlew assembleDebug
```

APK výstup: `android/app/build/outputs/apk/debug/app-debug.apk`

### Nahrání APK na Google Drive

```powershell
npm run upload-apk
```

První spuštění vyžaduje OAuth2 autorizaci v prohlížeči. Token se uloží do `.gdrive-token.json` — další spuštění jsou automatická.

### Kompletní deploy workflow

Pro jednotný agent workflow jsou v repu připravené skripty:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-complete.ps1 -Agent codex
powershell -ExecutionPolicy Bypass -File scripts/deploy-complete.ps1 -Agent opencode
```

Nebo přes npm:

```powershell
npm run deploy:complete:codex
npm run deploy:complete:opencode
```

Workflow provede:
1. `npm run build`
2. `npx cap sync android`
3. `.\gradlew assembleDebug` v `android/`
4. `npm run upload-apk`
5. aktualizaci sekce `Deploy Status` v README
6. git commit staged změn
7. ntfy notifikaci na `ntfy.sh/Codex_done` nebo `ntfy.sh/OpenCode_done`

Pokud rebuild APK neprojde, workflow se zastaví, nic nenahraje na Google Drive a odešle failure notifikaci.

### Regenerace ikon

```powershell
# Z vlastní ikony:
# Ulož 1024×1024 PNG jako icon-source.png do kořene projektu
node scripts/generate-icons.js

# Nebo vygeneruj SVG-based fallback ikonu:
node scripts/create-icon-source.js
node scripts/generate-icons.js
```

---

## Klíčové součásti

### 1. Mobilní aplikace (`app.html` + `app.js`)

**Funkce:** Záznam poznámek (text / audio / foto), GPS tagging, offline fronta.

**UI:** Tmavý mobilní layout:
- Status bar: online/offline, GPS accuracy badge (zelená/žlutá/červená), stav baterie, počet čekajících poznámek
- Záložky záznamu: TEXT (STT) / AUDIO (nahrávka) / FOTO (kamera)
- Tlačítka: Odeslat / Zahodit
- Bottom sheet: fronta čekajících položek se seznamem a možností smazání

**Tok dat per poznámka:**
1. Uživatel diktuje text (STT) nebo nahrává audio/foto.
2. Tap Odeslat → `refreshBattery()` + GPS z cache (max 30s stará) nebo nový fix.
3. Audio/foto → Base64 serializace **před** enqueue (SW nemá přístup k in-memory Blob).
4. Přímý POST pokud online, jinak enqueue do IDB → Background Sync / visibilitychange pojistka.

### 2. Service Worker (`sw.js`)

- Background Sync tag: `flush-queue`
- Čte WRITE_TOKEN + SHEET_URL z IDB config store (verze 2)
- `swSyncRegister()` je fire-and-forget (nesmí blokovat UI)

### 3. Live mapa (`index.html`)

**Funkce:** Read-only vizualizace pro pozorovatele.

- Leaflet.js + OpenStreetMap + GPX trasa overlay
- Note markery (modrá = starší, červená = poslední bod)
- **Spojnice bodů:** přerušovaná cyan čára mezi markery (chronologický postup)
- Poznámky fetchovány z Google Apps Script každých 10 sekund
- **Audio přehrávání:** přímo z popup / side panelu; refresh se pozastaví během přehrávání
- **Foto lightbox:** fullscreen overlay, klávesa Escape, plné rozlišení (w1600)
- **Telemetrie:** pozice na trase (km), rychlost (km/h), nadmořská výška (m), počasí (OpenMeteo)
- **Favicon:** inline SVG (stejný design jako ikona aplikace)
- Přístup chráněn tokenem: `map.html#token=READ_TOKEN`

### 4. Backend (`appscript.js`)

**Platforma:** Google Apps Script (nasadit jako web app).

- `doPost(e)` — parsuje JSON, ukládá text/audio/foto. Audio a foto dekóduje z Base64 → Google Drive.
- `doGet(e)` — vrací všechny řádky jako JSON; na vyžádání vrací audio soubor jako Base64.
- **POZOR:** POST nesmí obsahovat `Content-Type` header (CORS preflight workaround).
- **POZOR:** Po nasazení spusť v editoru dummy funkci s `DriveApp.getFiles()` pro udělení Drive oprávnění.

---

## Android oprávnění

| Oprávnění                | Použití                              |
|--------------------------|--------------------------------------|
| `INTERNET`               | POST na Google Apps Script           |
| `RECORD_AUDIO`           | Vosk + Google STT + audio záznamy    |
| `MODIFY_AUDIO_SETTINGS`  | MediaDevices API                     |
| `ACCESS_FINE_LOCATION`   | GPS souřadnice                       |
| `ACCESS_COARSE_LOCATION` | Záložní lokace                       |
| `ACCESS_NETWORK_STATE`   | Detekce online/offline               |
| `CAMERA`                 | Focení poznámek                      |

---

## Kritické invarianty

1. **POST na Google Apps Script nesmí mít `Content-Type` header** — předchází CORS preflight.
2. **`app.html` je zdrojový soubor** — nikdy needituj `www/` ani `android/` web assets přímo.
3. **`app.html` → `www/index.html`**, původní `index.html` (mapa) → `www/map.html` (Capacitor načítá `index.html`).
4. **Vosk model je gitignored** — po klonování spusť `node scripts/download-vosk-model.js`.
5. **Audio Blob musí být serializován (→ Base64) před `enqueue()`** — Service Worker nemá přístup k in-memory Blob objektům.
6. **`swSyncRegister()` musí být fire-and-forget** — `navigator.serviceWorker.ready` může blokovat indefinitely.
7. **`registerServiceWorker()` a `saveConfigForSW()` musí být awaited** na začátku `init()` — jinak WRITE_TOKEN nemusí být v IDB před prvním enqueue.
8. **GPS cache max 30s stará** v `buildBasePayload()` — eliminuje zpoždění odesílání.
9. **`icon-source.png` a credentials soubory jsou gitignored** — nesmí jít do repozitáře.

---

## Google Drive upload setup (jednorázový)

### OAuth2 Desktop App (doporučeno pro osobní Gmail)

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → projekt `ultralog-drive-upload`
2. **"+ Create Credentials"** → **"OAuth client ID"** → **Desktop app** → stáhnout JSON → uložit jako `gdrive-oauth-client.json`
3. OAuth consent screen → přidat svůj email jako **Test user**
4. `npm run upload-apk` → jednou autorizovat v prohlížeči → token uložen do `.gdrive-token.json`

---

## Testovací scénáře

- **Online – TEXT:** diktovat poznámku → odeslat → ověřit na mapě
- **Online – AUDIO:** nahrát poznámku → odeslat → přehrát na mapě
- **Online – FOTO:** vyfotit → odeslat → ověřit lightbox na mapě
- **Offline – TEXT/AUDIO/FOTO:** vypnout Wi-Fi → zaznamenat → fronta → zapnout Wi-Fi → auto-flush → ověřit mapu
- **GPS accuracy badge:** zelená ≤10m / žlutá ≤30m / červená >30m
- **Vibrace:** úspěšné odeslání + chyba
- **Wake Lock:** displej svítí během nahrávání
- **Zvuková signalizace:** pípnutí na start/stop nahrávání
- **Lightbox:** Escape zavírá, caption zobrazuje datum a čas, klik na backdrop zavírá
- **Spojnice bodů:** přerušovaná čára mezi markery se zobrazuje správně
- **Audio refresh pauza:** refresh se pozastaví během přehrávání audio poznámky
- **Offline fronta UI:** badge "Čekají: N", bottom sheet se seznamem a smazáním
