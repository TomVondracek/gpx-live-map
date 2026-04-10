# Běh – poznámky (Live Running Map System)

## Overview

Real-time voice and text noted running tracker for ultra-distance runs. The runner dictates notes hands-free or records audio messages, which are automatically tagged with GPS coordinates and sent to a Google Sheet and Google Drive. Observers see notes and listen to audio on a live Leaflet map with a clickable notes panel. The system is designed for minimal cognitive load, offline resilience, and extremely low battery usage.

---

## Architecture

```
Runner's Android phone (Capacitor native app)
        │
        ├─ Google STT (online, cs-CZ)  ─→ text transcript  (primary)
        ├─ Vosk STT (offline Czech)    ─→ text transcript  (fallback)
        ├─ MediaDevices API            ─→ audio recording  (WebM)
        ├─ Capacitor Geolocation       ─→ GPS coordinates  (on-demand)
        ├─ Capacitor Device            ─→ battery level
        │
        ▼
  IndexedDB offline queue
        │
        ├─ Online: direct POST ──→ Google Apps Script ──┬─→ Google Sheets (metadata, texts, Drive IDs)
        │                                               └─→ Google Drive (audio files)
        └─ Offline: stored in queue
             └─ Capacitor Network listener ──→ flush on reconnect

                                                      │
                                                      ▼
                                             GitHub Pages (Leaflet.js)
                                                      │
                                                      ▼
                                             Live Map for observers
                                             (map + clickable notes + audio playback)
```

### Version history

**v1 – PWA + MacroDroid:** Used MacroDroid for automation, later replaced by a vanilla JS PWA with Chrome's Web Speech API. Offline STT depended on Chrome's experimental on-device model (Chrome 127+). Service Worker + Background Sync for offline queue.

**v2 – Native Android + Vosk (offline-only STT):** Capacitor wraps the web UI into a native Android APK. Speech recognition uses Vosk with a bundled Czech model (~40 MB). Service Worker replaced by in-app IndexedDB queue + Capacitor Network listener.

**v3 – Hybrid STT & Telemetry:** Added Google STT (Android `SpeechRecognizer` API, cs-CZ) as the primary online engine. Vosk remains the offline fallback. Added real-time telemetry (speed, altitude) sent with notes. GPX route matching and weather fetching (via OpenMeteo) are handled automatically for map observers.

**v4 – Audio Notes & Battery Optimized (current):** Added support for recording actual audio files (WebM), sending them as Base64 to Google Apps Script, and saving them to Google Drive. The live map now supports playing these audio notes directly from the map, automatically pausing updates during playback. Refined UI/UX for both mobile and desktop. Validated extreme battery optimization (on-demand GPS only, no background tasks).

---

## Project Structure

```
C:\DEV\gpx-live-map\
│
│  # ── Web source files (authoritative, edit these) ─────────────
├── app.html              # Runner's app UI (dark mobile-first layout)
├── app.js                # Main application logic (~1200 lines)
├── index.html            # Live map for observers (Leaflet.js + notes panel)
├── appscript.js          # Google Apps Script backend (deploy to GAS, not served locally)
├── trasa.gpx             # GPX planned route (~2000 trackpoints)
│
│  # ── Capacitor / Android ──────────────────────────────────────
├── capacitor.config.ts   # Capacitor config (appId, webDir, plugins)
├── package.json          # npm dependencies (Capacitor + plugins)
├── www/                  # GENERATED — do not edit (built by scripts/copy-www.js)
├── android/
│   ├── app/
│   │   ├── build.gradle                  # Vosk SDK deps, noCompress config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml       # Permissions: audio, location, network
│   │       ├── assets/
│   │       │   ├── models/vosk-model-small-cs/  # Czech Vosk model (~40 MB, gitignored)
│   │       │   └── public/               # Web assets (copied by cap sync)
│   │       └── java/cz/behpoznamky/app/
│   │           ├── MainActivity.java     # Registers VoskPlugin + GoogleSTTPlugin
│   │           ├── vosk/VoskPlugin.java  # Capacitor plugin: offline STT via Vosk
│   │           └── googlestt/GoogleSTTPlugin.java  # Capacitor plugin: online STT
│   ├── build.gradle                      # Root gradle config + Vosk Maven repo
│   └── variables.gradle                  # SDK versions (compileSdk=35, minSdk=24)
│
│  # ── Build scripts ────────────────────────────────────────────
├── scripts/
│   ├── copy-www.js             # Copies web assets to www/ (app.html→index.html rename)
│   └── download-vosk-model.js  # Downloads Czech Vosk model into android assets
│
│  # ── Config ───────────────────────────────────────────────────
├── .gitignore            # Ignores node_modules, www/, build artifacts, vosk model, IDE files
└── README.md             # This file
```

---

## Battery Optimization

The mobile app is designed for **extreme battery efficiency**, crucial for ultra-marathons:
1. **On-Demand GPS:** It does not track location continuously (`watchPosition`). The GPS chip is activated for a few seconds only when sending a note.
2. **No Background Execution:** The app does not use wake locks or background services. When the phone is locked or the app is minimized, it sleeps entirely, consuming virtually zero battery.
3. **No Polling:** Unlike the live map, the mobile app does not poll the server. It only uses the network exactly when transmitting a payload.

---

## Key Components

### 1. Runner's App (`app.html` + `app.js`)

**Purpose:** Voice/Text note capture, Audio recording, GPS tagging, offline queue management.

**UI:** Single-screen dark-themed mobile interface:
- Status bar with online/offline indicator, battery level, queued note count
- Recording mode tabs: TEXT (Speech-to-Text) vs. AUDIO (Voice recording)
- Real-time transcript textarea or audio duration timer
- Send / Discard buttons

**Data flow per note:**
1. User records text (via STT) or audio (via MediaDevices).
2. User taps Odeslat → `refreshBattery()` + `Geolocation.getCurrentPosition()`
3. Payload (including Base64 encoded audio if applicable) → direct POST if online, else enqueue.
4. On POST failure: enqueue for later retry.

---

### 2. Google STT Plugin & 3. Vosk Plugin

Both native plugins handle speech-to-text functionality.
- **Google STT:** Primary online engine (`cs-CZ`).
- **Vosk:** Offline fallback engine (bundled Czech model). Auto-restarts on silence timeouts transparently.

---

### 4. Live Map (`index.html`)

**Purpose:** Read-only map visualization for observers.

**Features:**
- Leaflet.js map with OpenStreetMap tiles and GPX route overlay.
- Note markers fetched from Google Apps Script every 10 seconds.
- **Audio Playback:** Notes containing audio can be played directly from the map popups or side panel.
- **Smart Refresh:** The 10-second auto-refresh automatically **pauses** if an audio note is currently playing, preventing playback interruption.
- **Telemetry & Weather:** Shows route position (km), movement speed (km/h), altitude (m), and weather info at the time.
- **Responsive Notes Panel:** Right-side panel (desktop) or slide-up drawer (mobile). Auto-scrolls to the newest note unless the user is scrolling manually.

**Access protection:** Open the map with a token in the URL hash, e.g., `map.html#token=YOUR_READ_TOKEN`.

---

### 5. Backend (`appscript.js`)

**Platform:** Google Apps Script (deployed as web app).

**Functions:**
- `doPost(e)` — Parses JSON. Handles both text notes and audio files. Audio files are decoded from Base64 and saved to a specific Google Drive folder. Appends metadata to Google Sheets.
- `doGet(e)` — Returns all rows as JSON. If requested, returns a specific audio file as Base64 for the map to play.

**Critical Setup for Google Drive:**
For the Apps Script to save audio files to Google Drive, it needs explicit permission.
1. Deploy the script.
2. In the Apps Script editor, create a dummy function (e.g., `function testDrive() { DriveApp.getFiles(); }`).
3. Run this function manually once. Google will prompt you for Drive permissions. Accept them. Without this, audio uploads will fail silently.

**No Content-Type header** in POST requests — intentional. Sends as `text/plain` to avoid CORS preflight.

---

## Build & Development

### Prerequisites

- **Node.js** (v18+)
- **Android Studio** (Hedgehog or later) with Android SDK
- **Java JDK 21**

### First-time setup

```powershell
npm install
node scripts/download-vosk-model.js
npm run cap:sync
```

### Build APK

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
npm run cap:sync
cd android
.\gradlew.bat assembleDebug
```
APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Configuration

### Android permissions (`AndroidManifest.xml`)

| Permission               | Used by                          |
| ------------------------ | -------------------------------- |
| `INTERNET`               | POST to Google Apps Script       |
| `RECORD_AUDIO`           | Vosk + Google STT + Audio Notes  |
| `MODIFY_AUDIO_SETTINGS`  | MediaDevices API (Audio Notes)   |
| `ACCESS_FINE_LOCATION`   | GPS coordinates per note         |
| `ACCESS_COARSE_LOCATION` | Fallback location                |
| `ACCESS_NETWORK_STATE`   | Online/offline detection         |

---

## Critical Invariants

1. **POST requests to Google Apps Script must NOT include a Content-Type header.** Avoids CORS preflight.
2. **`app.html` in the project root is the source of truth.** Never edit `www/` or `android/` web assets directly.
3. **`app.html` is renamed to `index.html` in `www/`** because Capacitor loads `index.html` as the entry point. The original `index.html` (observer map) becomes `map.html`.
4. **The Vosk model is gitignored.** Run `node scripts/download-vosk-model.js` after cloning.
5. **IndexedDB queue records include the full POST URL.**
6. **STT auto-restart relies on `userStoppedRecording` flag.**
7. **Google Apps Script needs explicit Drive authorization** via a manual run in the editor to accept audio uploads.

---

## Possible Future Improvements

1. **Tune STT field thresholds** — test Vosk silence timeouts during actual running.
2. **Generate proper app icons** — replace Capacitor defaults.
3. **Keep screen on during recording** — use `@capacitor/keep-awake`.
4. **Current position indicator** — highlight runner's last known position on the live map.
5. **Camera integration** — capture and attach a photo to a note.
