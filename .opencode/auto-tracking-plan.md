# Auto-Tracking — Implementační plán

## Přehled funkcionality

Periodické automatické odesílání GPS polohových záznamů na pozadí — bez nutnosti interakce uživatele.

- **Název funkcionality:** Auto-tracking
- **Nový entry type:** `"track"`
- **Tlačítko:** `#btn-tracking` v hlavním UI
- **Záznamy obsahují:** čas, lat, lon, battery, speed, altitude, gps_accuracy, temperature (server-side)
- **Záznamy NEobsahují:** note, audio, photo

## Architektonická rozhodnutí

- **Background tracking:** `@capacitor-community/background-runner` plugin
- **Map dedup dead zone:** 50 metrů — zobrazit pouze nejnovější track bod v okolí
- **Google Sheet:** Nový sloupec `gps_accuracy` jako col 16

---

## Fáze 1 — Datový model a backend

### `shared/note-records.ts` + `shared/note-records.js`
- [ ] Přidat `"track"` do `EntryType` union typu (řádek ~2–12)
- [ ] Přidat `TrackPayload` interface:
  ```typescript
  interface TrackPayload extends BaseNotePayload {
    entry_type: "track";
    gps_accuracy: number | null;
  }
  ```
- [ ] Přidat `createTrackPayload(base, accuracy)` factory funkci (vzor dle `createTextPayload` ~řádek 121+)
- [ ] Přidat `TrackPayload` do `AnyPayload` union type
- [ ] Aktualizovat `note-records.js` (zkompilovaná JS verze)

### `appscript.js`
- [ ] Přidat `gps_accuracy` do sheet header array jako index 15 (sloupec P)
- [ ] Přidat větev `entry_type === "track"` do `doPost()`:
  - Bez Drive uploadů (žádné audio/photo)
  - Zapsat `gps_accuracy` do sloupce 16
- [ ] Přidat `gps_accuracy` do `doGet()` response objektu pro každý záznam

---

## Fáze 2 — Tracking engine

### `app/tracking.js` (NOVÝ SOUBOR)

Funkce k implementaci:
- `initTracking()` — načte nastavení z localStorage, pokud byl tracking zapnutý před restartem → `startTracking()`
- `startTracking(intervalMin)` — spustí `setInterval`, nastaví Background Runner task, ulož nastavení, aktualizuj badge
- `stopTracking()` — zruší interval, ulož nastavení, skryj badge
- `sendTrackPoint()` — sestaví `TrackPayload`:
  - `lastGpsCoords` z `app/gps.js` jako primární zdroj
  - `getCurrentPosition()` jako fallback pokud cache stará >60s
  - `lastGpsAccuracy` z `app/gps.js`
  - `lastBattery` z `app/gps.js`
  - Zavolá `directPost()` nebo `enqueue()` (vzor z `app/api.ts`)
- `getTrackingSettings()` / `saveTrackingSettings()` — localStorage:
  ```javascript
  { enabled: false, intervalMin: 5 }
  // klíč: "tracking-settings"
  ```
- `openTrackingDialog()` — otevře dialog nastavení
- `closeTrackingDialog()` — zavře dialog

### `@capacitor-community/background-runner` setup
- [ ] `package.json` — přidat `@capacitor-community/background-runner` jako dependency
- [ ] `capacitor.config.ts` — přidat BackgroundRunner plugin config:
  ```typescript
  BackgroundRunner: {
    label: "cz.behpoznamky.app.background",
    src: "runner.js",
    event: "trackPoint",
    repeat: true,
    interval: 5,  // dynamicky měnit dle nastavení
    autoStart: false,
  }
  ```
- [ ] `runner.js` (NOVÝ SOUBOR v root/www) — Background Runner script:
  - Reaguje na event `"trackPoint"`
  - Získá GPS pozici přes Background Runner Geolocation API
  - Sestaví payload a odešle přes fetch nebo uloží do fronty
- [ ] `android/app/src/main/AndroidManifest.xml` — přidat oprávnění:
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_LOCATION`
  - `RECEIVE_BOOT_COMPLETED` (pro auto-restart po restartu telefonu)

---

## Fáze 3 — UI

### `index.html`
- [ ] Nové tlačítko `#btn-tracking` vedle existujících akcí:
  ```html
  <button id="btn-tracking" class="action-btn" title="Auto-tracking">
    <!-- SVG ikona GPS/satelit/crosshair -->
  </button>
  ```
- [ ] Dialog `#tracking-dialog` (bottom sheet):
  ```html
  <div id="tracking-dialog" class="bottom-sheet">
    <h3>📍 Auto-tracking</h3>
    <div class="interval-selector">
      <!-- 7 tlačítek: 1, 2, 5, 10, 15, 30, 60 minut -->
    </div>
    <label class="toggle-switch">
      <input type="checkbox" id="tracking-toggle">
      <span>Zapnuto</span>
    </label>
    <p class="info-text">Záznamy se odesílají i při zamknutém telefonu.</p>
  </div>
  ```

### `app/ui.js`
- [ ] Přidat `updateTrackingBadge(enabled, intervalMin)`:
  - Pokud enabled: zobrazí pulsující zelený badge ve status baru „⬤ Tracking · Xmin"
  - Pokud disabled: skryje badge
- [ ] Badge element přidat do `#status-bar` v HTML

### `app.js`
- [ ] Import `tracking.js` modulu
- [ ] Volat `initTracking()` při startu aplikace (po GPS init)
- [ ] Event listener: `#btn-tracking` → `openTrackingDialog()`

---

## Fáze 4 — Mapa

### `map/shared.js`
- [ ] Nová track ikona — malý modrý filled circle `divIcon`:
  ```javascript
  const trackIcon = L.divIcon({
    className: "",
    html: '<div class="track-dot"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  ```
- [ ] CSS pro `.track-dot`: `width:10px; height:10px; border-radius:50%; background:#3b82f6; border:2px solid #fff; box-shadow:0 0 3px rgba(0,0,0,0.4);`

### `map/data.js`
- [ ] V `buildMarkerGroups()` nebo nová deduplikační funkce `deduplicateTrackPoints(points)`:
  - Filtruje pouze body s `entry_type === "track"`
  - Řadí sestupně dle času
  - Pro každý bod zkontroluje haversine vzdálenost od ostatních
  - Pokud existuje novější bod do 50m → aktuální bod se přeskočí (nezobrazí)
  - Výsledek: vždy jen nejnovější bod v každé 50m buňce
- [ ] `createTrackMarker(point)` — nová funkce:
  - Použije `trackIcon`
  - Minimalistická popup:
    ```
    HH:MM  🔋XX%
    XX.X km/h  ↑XXXXm
    🌡️ XX°C  ±XXm
    ```
  - Žádné audio/foto tlačítka
  - Žádná orbit expanze
- [ ] Track body **nevstupují** do `buildMarkerGroups()` multi-pin logiky — zpracovány odděleně
- [ ] V hlavní `renderMarkers()` funkci: separátní průchod pro track body

---

## Fáze 5 — Build a synchronizace

- [ ] `scripts/copy-www.js` — přidat `tracking.js` a `runner.js` do kopírovacího skriptu
- [ ] `npm install` — nainstalovat Background Runner plugin
- [ ] `cap sync android` — synchronizovat nativní plugin
- [ ] Rebuild APK a otestovat

---

## Klíčové závislosti mezi soubory

```
shared/note-records.ts
  ↓ (TrackPayload, createTrackPayload)
app/tracking.js
  ↓ (sendTrackPoint → directPost/enqueue)
app/api.ts (directPost — beze změny)
app/queue.ts (enqueue — beze změny)
  ↓
appscript.js (doPost rozšíření)
  ↓
map/data.js (zobrazení track bodů)
```

## GPS Accuracy — technická poznámka

Capacitor `@capacitor/geolocation` vrací `coords.accuracy` v metrech (horizontal accuracy).
Dostupné v `watchPosition` callback jako `position.coords.accuracy`.
V `app/gps.js` je již cachováno jako `lastGpsAccuracy` — stačí ho číst a posílat v TrackPayload.

## Offline fronta — chování

Track záznamy vstupují do **stejné** IndexedDB fronty jako ostatní typy.
`flushQueue()` a SW Background Sync je zpracují identicky.
Žádné speciální chování potřeba.

## Stav implementace

- [ ] Fáze 1: Datový model a backend
- [ ] Fáze 2: Tracking engine
- [ ] Fáze 3: UI
- [ ] Fáze 4: Mapa
- [ ] Fáze 5: Build
