---
name: android-build-deploy
description: Build Android APK pro UltraLog a nahrání na Google Drive
---

## Co dělám

- Sestavím Android debug APK (Capacitor 6 + Gradle)
- Nahraji APK na Google Drive jako `UltraLog-debug.apk`

## Kdy mě použít

Použij tento skill kdykoliv uživatel chce:
- zbuildovat / sestavit / build APK
- nahrát APK na Google Drive
- udělat deploy mobilní aplikace
- kombinaci obojího

## Prerekvizity

Před buildem musí existovat:
- `android/app/src/main/assets/models/vosk-model-small-cs/` — pokud chybí, spusť nejdřív `node scripts/download-vosk-model.js`
- `gdrive-oauth-client.json` — potřebné pouze pro upload na Google Drive

## Postup buildu

Všechny příkazy spouštěj z kořene projektu `C:\DEV\gpx-live-map`.

### Krok 1 – Web assets

```powershell
npm run build
```

Kopíruje zdrojové soubory do `www/`:
- `app.html` → `www/index.html` (Capacitor entry point)
- `index.html` → `www/map.html`
- `app.js`, `app/`, `sw.js`, `vendor/`, `trasa.gpx`, `runtime-config.js`

### Krok 2 – Capacitor sync

```powershell
npx cap sync android
```

Synchronizuje `www/` do `android/app/src/main/assets/public/` a aktualizuje Capacitor pluginy.

### Krok 3 – Gradle build

```powershell
cd android
.\gradlew assembleDebug
cd ..
```

**Výstup:** `android/app/build/outputs/apk/debug/app-debug.apk` (~110 MB)

Úspěšný build končí řádkem: `BUILD SUCCESSFUL`

## Postup nahrání na Google Drive

```powershell
npm run upload-apk
```

Skript `scripts/upload-apk.js`:
- Nahraje APK jako `UltraLog-debug.apk` do složky na Google Drive
- Pokud soubor existuje → aktualizuje ho (zachová sdílecí URL)
- Pokud neexistuje → vytvoří nový

**Google Drive složka:** `https://drive.google.com/drive/folders/1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj`

### První spuštění (OAuth2)

Pokud `.gdrive-token.json` neexistuje, skript vyžádá autorizaci:
1. Prohlížeč se otevře automaticky
2. Uživatel se přihlásí Google účtem
3. Zkopíruje autorizační kód a vloží do terminálu
4. Token se uloží do `.gdrive-token.json` — další spuštění jsou automatická

## Celý postup najednou

```powershell
npm run build && npx cap sync android && cd android && .\gradlew assembleDebug && cd .. && npm run upload-apk
```

## Důležité poznámky

- Nikdy needituj `www/` ani `android/app/src/main/assets/public/` přímo — jsou generované
- `app.html` je zdrojový soubor mobilní UI, ne `www/index.html`
- `gdrive-oauth-client.json` a `.gdrive-token.json` jsou gitignored — nesmí jít do repozitáře
