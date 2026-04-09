# Běh – poznámky (Live Running Map System)

## Overview

Real-time voice-noted running tracker for ultra-distance runs. The runner dictates notes hands-free, which are automatically tagged with GPS coordinates and sent to a Google Sheet. Observers see notes on a live Leaflet map with a clickable notes panel. The system is designed for minimal cognitive load, offline resilience, and low battery usage.

---

## Architecture

```
Runner's Android phone (Capacitor native app)
        │
        ├─ Google STT (online, cs-CZ)  ─→ text transcript  (primary)
        ├─ Vosk STT (offline Czech)    ─→ text transcript  (fallback)
        ├─ Capacitor Geolocation       ─→ GPS coordinates
        ├─ Capacitor Device            ─→ battery level
        │
        ▼
  IndexedDB offline queue
        │
        ├─ Online: direct POST ──→ Google Apps Script ──→ Google Sheets
        │
        └─ Offline: stored in queue
             └─ Capacitor Network listener ──→ flush on reconnect

                                                      │
                                                      ▼
                                             GitHub Pages (Leaflet.js)
                                                      │
                                                      ▼
                                             Live Map for observers
                                             (map + clickable notes panel)
```

### Version history

**v1 – PWA + MacroDroid:** Used MacroDroid for automation, later replaced by a vanilla JS PWA with Chrome's Web Speech API. Offline STT depended on Chrome's experimental on-device model (Chrome 127+). Service Worker + Background Sync for offline queue.

**v2 – Native Android + Vosk (offline-only STT):** Capacitor wraps the web UI into a native Android APK. Speech recognition uses Vosk with a bundled Czech model (~40 MB). Service Worker replaced by in-app IndexedDB queue + Capacitor Network listener.

**v3 – Hybrid STT & Telemetry (current):** Added Google STT (Android `SpeechRecognizer` API, cs-CZ) as the primary online engine. Vosk remains the offline fallback. Added real-time telemetry (speed, altitude) sent with notes. GPX route matching and weather fetching (via OpenMeteo) are handled automatically for map observers.

---

## Project Structure

```
C:\DEV\gpx-live-map\
│
│  # ── Web source files (authoritative, edit these) ─────────────
├── app.html              # Runner's app UI (dark mobile-first layout)
├── app.js                # Main application logic (~690 lines)
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

## Key Components

### 1. Runner's App (`app.html` + `app.js`)

**Purpose:** Voice note capture, GPS tagging, offline queue management.

**UI:** Single-screen dark-themed mobile interface:

- Status bar with online/offline indicator dot, STT engine, battery level, queued note count
- Large circular MLUVIT/STOP button with recording glow animation
- Real-time transcript textarea (editable after recording stops, auto-grows with content)
- Send / Discard buttons
- Collapsible STT diagnostics panel

**Tech:** Vanilla JS, no framework, no bundler. Capacitor plugins accessed via global `Capacitor.Plugins`.

#### STT engine selection (`chooseEngine()`):

| Condition | Engine used |
|-----------|-------------|
| Device online + Google STT available | `"google"` (Android SpeechRecognizer, cs-CZ) |
| Device offline OR Google STT unavailable | `"vosk"` (bundled Czech model) |
| Neither available | Button disabled, error shown |

Both engines are initialized in parallel on startup. The status bar shows which engine is active.

#### Pause / silence handling:

STT sessions auto-stop when silence is detected. To prevent pausing mid-thought from ending the recording, the app **auto-restarts the STT session** transparently:

- `userStoppedRecording` flag — set to `true` only on manual STOP tap
- On `stopped` event from either engine: if `userStoppedRecording === false` → `restartCurrentEngine()` is called silently, transcript accumulates, recording indicator stays on
- Manual STOP → `finishRecording()` → confirm panel appears

Vosk silence timeout: **6 seconds**. Google STT silence hint: **6000 ms** (server may override).

#### Data flow per note:

1. User taps MLUVIT → `startRecording()` → selects engine → `startListening()`
2. Engine sends `result` events (partial + final) → displayed in real-time in textarea
3. On silence: auto-restart (transparent) OR on STOP tap: `finishRecording()`
4. User may edit transcript manually before sending
5. User taps Odeslat → `refreshBattery()` + `Geolocation.getCurrentPosition()`
6. Payload `{time, lat, lon, note, battery}` → direct POST if online, else enqueue
7. On POST failure: enqueue for later retry

#### Payload schema:

```json
{
  "time": "2026-04-08T14:53:00.000Z",
  "lat": 49.7892,
  "lon": 18.27,
  "note": "krize ale držím tempo",
  "battery": 85,
  "speed": 10.5,
  "altitude": 320
}
```

---

### 2. Google STT Plugin (`GoogleSTTPlugin.java`)

**Purpose:** Primary online STT engine. Native Capacitor plugin wrapping Android `SpeechRecognizer` API.

**Location:** `android/app/src/main/java/cz/behpoznamky/app/googlestt/GoogleSTTPlugin.java`

**Language:** `cs-CZ` (Czech). Requires internet connection. Must run on UI thread.

**Methods (callable from JS):**

| Method | Description |
|---|---|
| `isAvailable()` | Returns `{available: boolean}` — checks `SpeechRecognizer.isRecognitionAvailable()` |
| `startListening()` | Creates recognizer, starts listening with partial results enabled |
| `stopListening()` | Stops listening, waits for final result callback |

**Events (sent to JS):**

| Event | Fields | Description |
|---|---|---|
| `result` | `{text, isFinal}` | Partial (full text replacement) or final transcription |
| `stopped` | `{reason}` | Session ended: `"silence"`, `"end_of_speech"` |
| `error` | `{message}` | Non-fatal errors are mapped to `stopped`; fatal errors trigger `error` |

**Silence hints passed to Android:**

| Intent extra | Value |
|---|---|
| `EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS` | 6000 ms |
| `EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS` | 5000 ms |
| `EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS` | 4000 ms |

> Note: Android treats these as hints. The Google STT server may apply shorter timeouts regardless. The JS-layer auto-restart (`restartCurrentEngine()`) compensates for this.

---

### 3. Vosk Plugin (`VoskPlugin.java`)

**Purpose:** Offline fallback STT engine. Native Capacitor plugin bridging WebView JS to Android Vosk SDK.

**Location:** `android/app/src/main/java/cz/behpoznamky/app/vosk/VoskPlugin.java`

**Methods (callable from JS):**

| Method | Description |
|---|---|
| `initialize()` | Extracts and loads Czech model from assets (async, ~2–5 s on first run) |
| `startListening()` | Opens AudioRecord (16 kHz mono PCM), feeds Vosk recognizer |
| `stopListening()` | Stops recording, emits final result |
| `getStatus()` | Returns `{modelReady, modelLoading, isListening}` |

**Events (sent to JS):** Same interface as GoogleSTTPlugin — `result`, `stopped`, `error`.

**Silence detection:** Monitors max amplitude of each audio buffer. Constants in `VoskPlugin.java`:

| Constant | Value | Description |
|---|---|---|
| `SILENCE_THRESHOLD` | 1500 | Amplitude below which a frame is considered silent (16-bit PCM, range 0–32768) |
| `SILENCE_TIMEOUT_SEC` | 6.0 | Seconds of silence after speech before auto-stop |
| `GRACE_PERIOD_SEC` | 3.0 | Silence detection ignored for first N seconds (prep time) |

**Model:** `vosk-model-small-cs-0.4-rhasspy` — compact Czech model optimised for Rhasspy home assistant. Accuracy on free-form dictation is limited; Google STT is preferred when online.

---

### 4. Live Map (`index.html`)

**Purpose:** Read-only map visualization for observers (friends/family).

**Hosting:** GitHub Pages (static file, runs independently in any browser).

**Features:**

- Leaflet.js map with OpenStreetMap tiles
- GPX route overlay (`trasa.gpx` via leaflet-gpx plugin)
- Note markers fetched from Google Apps Script every 10 seconds
- Latest position highlighted with red marker, popup opened automatically
- Czech locale timestamps (`cs-CZ`, `Europe/Prague`)
- **Telemetry & Weather:** Popups and panel items enrich notes with calculated route position (km), movement speed (km/h), altitude (m), and weather info at the time (emoji + °C).
- **Notes panel** — right-side panel (desktop) or slide-up drawer (mobile):
  - Shows all notes sorted newest-first
  - Each row: compact timestamp + note text + mini-telemetry row (e.g. `☀️ 18°C · ⚡ 10.5 km/h · ▲ 312 m · 📍 km 12.3`)
  - Click on a row → `map.setView([lat, lon], 15)` + opens marker popup
  - Active row highlighted with green left border
  - Notes without GPS shown dimmed (no map interaction)
  - Auto-scrolls to newest note on each data refresh (unless user is scrolling)
  - Mobile: floating `☰ Zprávy [N]` button toggles panel; clicking a note closes panel

**Dependencies (CDN):** Leaflet.js, leaflet-gpx, leaflet-color-markers.

**Access protection:** The observer map no longer contains a hardcoded read credential. To load notes, open the map with a token in the URL hash, for example `map.html#token=YOUR_READ_TOKEN`. The page stores the token locally and removes it from the visible URL.

---

### 5. Backend (`appscript.js`)

**Platform:** Google Apps Script (deployed as web app).

**Endpoint:** `https://script.google.com/macros/s/AKfycbx.../exec`

**Functions:**

- `doPost(e)` — Parses JSON body, verifies write token, optionally fetches current weather from OpenMeteo API, and appends row `[time, lat, lon, note, battery, speed, altitude, weather_temp, weather_code]` to Google Sheet
- `doGet(e)` — Verifies read token and returns all rows as JSON array with fully parsed floats/integers

**No Content-Type header** in POST requests — intentional. Sends as `text/plain` to avoid CORS preflight. This is a critical invariant (see below).

### Security setup

#### 1. Runtime config for the runner app

Create a local `runtime-config.js` in the project root (gitignored) based on `runtime-config.example.js`:

```js
window.RUN_NOTES_CONFIG = {
  sheetUrl: "https://script.google.com/macros/s/AKfycbx.../exec",
  writeToken: "replace-with-strong-write-token"
};
```

`npm run build` copies this file into `www/runtime-config.js` for the Capacitor app.

#### 2. Script Properties in Google Apps Script

In the Apps Script editor, set these Script Properties:

- `WRITE_TOKEN` for note uploads from the mobile app
- `READ_TOKEN` for observer map access

You can also set a single fallback `API_TOKEN`, but separate read/write tokens are recommended.

---

### 6. Offline Queue

**Storage:** IndexedDB (`beh-poznamky-db`, object store `queue`).

**Strategy:** Online → direct POST; on failure → enqueue. Offline → enqueue immediately.

**Queue record format:**

```json
{
  "id": "1712612345678-a3bx7",
  "url": "https://script.google.com/macros/s/.../exec",
  "payload": { "time": "...", "lat": ..., "lon": ..., "note": "...", "battery": ..., "speed": ..., "altitude": ... },
  "createdAt": "2026-04-08T14:53:00.000Z"
}
```

**Flush triggers:**

1. App start (if online)
2. `Network.addListener("networkStatusChange")` when `connected === true`

**Mutex:** `isFlushing` flag prevents concurrent flush runs.

---

## Build & Development

### Prerequisites

- **Node.js** (v18+)
- **Android Studio** (Hedgehog or later) with Android SDK
- **Java JDK 21** (`C:\Program Files\Java\jdk-21`)

### First-time setup

```powershell
# 1. Install npm dependencies
npm install

# 2. Download Czech Vosk model (~40 MB) into android assets
#    NOTE: May require NODE_TLS_REJECT_UNAUTHORIZED=0 if behind corporate proxy
node scripts/download-vosk-model.js

# 3. Add Android platform (already done, only needed if android/ is missing)
npx cap add android

# 4. Sync web assets to Android project
npm run cap:sync
```

### Build APK

**Option A — Android Studio (recommended):**

1. Open `C:\DEV\gpx-live-map\android` in Android Studio
2. Let Gradle sync complete
3. Build > Build Bundle(s) / APK(s) > Build APK(s)
4. APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

**Option B — Command line:**

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
npm run cap:sync
cd android
.\gradlew.bat assembleDebug
```

### Development workflow

1. Edit `app.html` and/or `app.js` in the project root
2. Run `npm run cap:sync` (copies to `www/`, then to android assets)
3. Build APK via Android Studio or Gradle
4. Install on device: `adb install android/app/build/outputs/apk/debug/app-debug.apk`

**Important:** Always edit files in the project root. Never edit `www/` or `android/app/src/main/assets/public/` — those are generated and will be overwritten.

### npm scripts

| Script             | Command                      | Description                                         |
| ------------------ | ---------------------------- | --------------------------------------------------- |
| `npm run build`    | `node scripts/copy-www.js`   | Copies web assets to `www/` with entry point rename |
| `npm run cap:sync` | `build` + `cap sync android` | Full sync: copy assets + update native project      |
| `npm run cap:open` | `cap open android`           | Opens project in Android Studio                     |
| `npm run cap:run`  | `build` + `cap run android`  | Build, sync, and run on connected device            |

### SSL / Corporate proxy issues

If Gradle fails to download dependencies due to SSL errors (`PKIX path building failed`), the global `~/.gradle/gradle.properties` contains a workaround that uses the Windows Certificate Store:

```properties
systemProp.javax.net.ssl.trustStoreType=WINDOWS-ROOT
org.gradle.jvmargs=-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT
```

Building inside Android Studio (which bundles its own JBR with proper certificates) usually resolves the issue if the above doesn't help.

---

## Configuration

### Android SDK versions (`android/variables.gradle`)

| Property            | Value | Reason                                       |
| ------------------- | ----- | -------------------------------------------- |
| `minSdkVersion`     | 24    | Minimum for Vosk Android SDK                 |
| `compileSdkVersion` | 35    | Matches installed Android SDK                |
| `targetSdkVersion`  | 35    | Current Play Store requirements              |

### Capacitor config (`capacitor.config.ts`)

| Property                    | Value                   |
| --------------------------- | ----------------------- |
| `appId`                     | `cz.behpoznamky.app`    |
| `appName`                   | `Běh – poznámky`        |
| `webDir`                    | `www`                   |
| `android.allowMixedContent` | `true`                  |
| `server.allowNavigation`    | `["script.google.com"]` |

### Android permissions (`AndroidManifest.xml`)

| Permission               | Used by                          |
| ------------------------ | -------------------------------- |
| `INTERNET`               | POST to Google Apps Script       |
| `RECORD_AUDIO`           | Vosk + Google STT microphone     |
| `ACCESS_FINE_LOCATION`   | GPS coordinates per note         |
| `ACCESS_COARSE_LOCATION` | Fallback location                |
| `ACCESS_NETWORK_STATE`   | Online/offline detection         |

---

## Critical Invariants

1. **POST requests to Google Apps Script must NOT include a Content-Type header.** This keeps them as "simple requests" avoiding CORS preflight, which GAS cannot handle.

2. **`app.html` in the project root is the source of truth.** The `www/` and `android/app/src/main/assets/public/` copies are generated by `scripts/copy-www.js` + `cap sync`. Never edit them directly.

3. **`app.html` is renamed to `index.html` in `www/`** because Capacitor loads `index.html` as the entry point. The original `index.html` (observer map) becomes `map.html` in the Capacitor build. The footer link in the runner app is patched automatically by `copy-www.js`.

4. **The Vosk model is gitignored** (`android/app/src/main/assets/models/`). After cloning, run `node scripts/download-vosk-model.js` to download it.

5. **IndexedDB queue records include the full POST URL.** This keeps the queue agnostic to the backend endpoint and makes future endpoint migration safe.

6. **STT auto-restart relies on `userStoppedRecording` flag.** Any code path that should stop recording permanently (manual stop, fatal error) must set `userStoppedRecording = true` before triggering the stopped flow, otherwise recording will restart.

7. **Battery level is polled on-demand** (at note send time) because the Capacitor Device plugin has no real-time listener. If continuous monitoring is needed, add a periodic timer.

8. **GoogleSTTPlugin must be called on the UI thread.** `startListening()` and `stopListening()` use `getActivity().runOnUiThread(...)` — do not remove this.

---

## Possible Future Improvements

### High Priority

1. **Tune STT field thresholds** — test Vosk `SILENCE_THRESHOLD` (currently 1500) and `SILENCE_TIMEOUT_SEC` (6.0) during actual running in wind/crowd noise
2. **Generate proper app icons** — replace Capacitor defaults with a microphone icon via Android Studio Image Asset Studio
3. **Keep screen on during recording** — use `@capacitor/keep-awake` to prevent screen sleep mid-dictation

### Medium Priority

4. **Note categorization** — predefined categories (energy, pain, navigation, etc.)
5. **Current position indicator** — highlight runner's last known position on the live map
6. **Camera integration** — capture and attach a photo to a note, display in map panel

### Advanced

8. **Larger Vosk model** (`vosk-model-cs`, ~250 MB) for significantly better offline recognition accuracy
9. **Replace Google Sheets backend** with a database (Supabase / Firebase) for better scalability and real-time streaming
10. **Real-time streaming** instead of 10-second polling on the observer map
