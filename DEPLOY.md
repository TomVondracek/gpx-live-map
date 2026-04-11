# UltraLog – Deploy & Build příručka

## Obsah

1. [Prerekvizity](#1-prerekvizity)
2. [Jednorázové nastavení](#2-jednorázové-nastavení)
3. [Build APK](#3-build-apk)
4. [Nahrání APK na Google Drive](#4-nahrání-apk-na-google-drive)
5. [Instalace APK na zařízení](#5-instalace-apk-na-zařízení)
6. [Zkratka – celý postup jedním příkazem](#6-zkratka--celý-postup-jedním-příkazem)

---

## 1. Prerekvizity

| Nástroj | Verze | Poznámka |
|---------|-------|---------|
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | součást Node.js |
| **Java JDK** | 21 | `java -version`; nastavit `JAVA_HOME` |
| **Android Studio** | Hedgehog+ | včetně Android SDK (API 35) |
| **Android SDK** | API 24–35 | nastavit `ANDROID_HOME` / `ANDROID_SDK_ROOT` |

Ověření prostředí:

```powershell
node --version
java -version
echo $env:JAVA_HOME
echo $env:ANDROID_HOME
```

---

## 2. Jednorázové nastavení

### 2a. Instalace npm závislostí

```powershell
npm install
```

### 2b. Stažení Vosk modelu (~40 MB)

Český offline speech recognition model je gitignored — je nutné ho stáhnout ručně:

```powershell
node scripts/download-vosk-model.js
```

Model se uloží do `android/app/src/main/assets/models/vosk-model-small-cs/`.

### 2c. Nastavení Google Drive upload (pro `npm run upload-apk`)

1. Přejdi na [Google Cloud Console – Credentials](https://console.cloud.google.com/apis/credentials)
2. Projekt `ultralog-drive-upload` → **"+ Create Credentials"** → **"OAuth client ID"** → **"Desktop app"**
3. Stáhni JSON → ulož jako `gdrive-oauth-client.json` do kořene projektu
4. OAuth consent screen → přidej svůj email jako **Test user**
5. Povol [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

> `gdrive-oauth-client.json` a `.gdrive-token.json` jsou v `.gitignore` a nesmí jít do repozitáře.

---

## 3. Build APK

### Krok 1 – Zkopíruj web assets do `www/`

```powershell
npm run build
```

Skript `scripts/copy-www.js` provede:
- `app.html` → `www/index.html` (Capacitor entry point, opraví odkaz na mapu)
- `app.js` → `www/app.js`
- `app/` → `www/app/`
- `sw.js` → `www/sw.js`
- `runtime-config.js` → `www/runtime-config.js`
- `index.html` → `www/map.html`
- `trasa.gpx` → `www/trasa.gpx`
- `vendor/` → `www/vendor/`

### Krok 2 – Synchronizuj do Android projektu

```powershell
npx cap sync android
```

Capacitor zkopíruje `www/` do `android/app/src/main/assets/public/` a aktualizuje pluginy.

### Krok 3 – Sestav APK pomocí Gradle

```powershell
cd android
.\gradlew assembleDebug
```

**Výstupní soubor:** `android/app/build/outputs/apk/debug/app-debug.apk`

Velikost APK je přibližně **~110 MB** (obsahuje Vosk model).

---

## 4. Nahrání APK na Google Drive

```powershell
npm run upload-apk
```

Skript `scripts/upload-apk.js`:
- Nahraje `app-debug.apk` jako `UltraLog-debug.apk` do Google Drive složky
- Pokud soubor již existuje → aktualizuje ho (zachová stejné sdílecí URL)
- Pokud soubor neexistuje → vytvoří nový

### První spuštění (OAuth2 autorizace)

```
── OAuth2 autorizace ──────────────────────────────────────────
Otevři tuto URL v prohlížeči a přihlas se svým Google účtem:

https://accounts.google.com/o/oauth2/auth?...
```

1. Prohlížeč se otevře automaticky
2. Přihlas se Google účtem nastaveným jako Test user
3. Zkopíruj autorizační kód z prohlížeče
4. Vlož do terminálu
5. Token se uloží do `.gdrive-token.json` — **další spuštění jsou automatická**

Po úspěšném nahrání:

```
Hotovo! APK dostupné na:
https://drive.google.com/drive/folders/1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj
```

---

## 5. Instalace APK na zařízení

### Varianta A – přes Google Drive

1. Na Android telefonu otevři odkaz na Google Drive složku
2. Stáhni `UltraLog-debug.apk`
3. Otevři stažený soubor → povolit instalaci z neznámých zdrojů → **Nainstalovat**

### Varianta B – přes USB (ADB)

```powershell
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

Pokud je nainstalována starší verze:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

### Varianta C – přes Android Studio

```powershell
npx cap open android
```

V Android Studio: **Run → Run 'app'** (nebo zelené tlačítko ▶).

---

## 6. Zkratka – celý postup jedním příkazem

```powershell
# Build + sync + sestavení APK + nahrání na Drive
npm run build && npx cap sync android && cd android && .\gradlew assembleDebug && cd .. && npm run upload-apk
```

Nebo postupně s npm skripty:

```powershell
npm run cap:sync         # build + cap sync android
cd android
.\gradlew assembleDebug  # sestaví APK
cd ..
npm run upload-apk       # nahraje na Google Drive
```

---

## Struktura výstupů buildu

```
android/app/build/outputs/apk/
└── debug/
    └── app-debug.apk          # Debug APK (~110 MB, obsahuje Vosk model)
```

```
www/                            # Generované web assets (needitovat přímo)
├── index.html                  # = app.html (Capacitor entry point)
├── map.html                    # = index.html (live mapa pro pozorovatele)
├── app.js
├── app/
├── sw.js
├── runtime-config.js
├── trasa.gpx
└── vendor/
```

---

## Časté problémy

| Problém | Řešení |
|---------|--------|
| `JAVA_HOME` není nastaveno | Nastav: `$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"` |
| `ANDROID_HOME` není nastaveno | Nastav cestu k Android SDK |
| Vosk model chybí | Spusť `node scripts/download-vosk-model.js` |
| APK soubor nenalezen při upload | Nejprve proveď `.\gradlew assembleDebug` v `android/` |
| OAuth chyba při upload | Smaž `.gdrive-token.json` a spusť `npm run upload-apk` znovu |
| `gradlew` – permission denied | `git update-index --chmod=+x android/gradlew` |
