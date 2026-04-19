// ── Auto-Tracking Engine ──────────────────────────────────────────────────────
// Periodicky odesílá GPS polohu jako TrackPayload (entry_type="track").
// Funguje i při zamknutém telefonu přes Background Runner plugin.
//
// Závislosti (globální proměnné z ostatních modulů):
//   lastGpsCoords, lastGpsAccuracy, batteryLevel  — z app/gps.js + app/shared.js
//   isOnline                                       — z app/network.js
//   directPost, buildBasePayload                   — z app/api.ts
//   enqueue, swSyncRegister                        — z app/queue.ts
//   createTrackPayload                             — z shared/note-records.js
//   showError                                      — z app/ui.js
//   refreshBattery, getCapacitorPlugin             — z app/gps.js + app/shared.js

const TRACKING_SETTINGS_KEY = "tracking-settings";
const TRACKING_INTERVALS_MIN = [1, 2, 5, 10, 15, 30, 60];
const TRACKING_DEFAULT_INTERVAL_MIN = 5;

// Interní stav
let _trackingTimerId = null;
let _trackingEnabled = false;
let _trackingIntervalMin = TRACKING_DEFAULT_INTERVAL_MIN;

// ── Nastavení ─────────────────────────────────────────────────────────────────

function getTrackingSettings() {
  try {
    const raw = localStorage.getItem(TRACKING_SETTINGS_KEY);
    if (!raw) return { enabled: false, intervalMin: TRACKING_DEFAULT_INTERVAL_MIN };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      intervalMin: TRACKING_INTERVALS_MIN.includes(parsed.intervalMin)
        ? parsed.intervalMin
        : TRACKING_DEFAULT_INTERVAL_MIN,
    };
  } catch {
    return { enabled: false, intervalMin: TRACKING_DEFAULT_INTERVAL_MIN };
  }
}

function saveTrackingSettings(enabled, intervalMin) {
  try {
    localStorage.setItem(TRACKING_SETTINGS_KEY, JSON.stringify({ enabled, intervalMin }));
  } catch {}
}

// ── Odeslání jednoho track bodu ───────────────────────────────────────────────

async function sendTrackPoint() {
  try {
    await refreshBattery();

    let lat = null;
    let lon = null;
    let speed = null;
    let altitude = null;
    const CACHE_MAX_AGE_MS = 60000; // pro tracking akceptujeme cache až 60s

    const cacheAge = lastGpsCoords ? (Date.now() - lastGpsCoords.ts) : Infinity;
    if (lastGpsCoords && cacheAge <= CACHE_MAX_AGE_MS) {
      lat = lastGpsCoords.lat;
      lon = lastGpsCoords.lon;
      speed = lastGpsCoords.speed;
      altitude = lastGpsCoords.altitude;
    } else {
      // Fallback: jednorázové získání polohy
      try {
        const Geolocation = getCapacitorPlugin("Geolocation");
        if (Geolocation) {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          if (pos.coords.speed !== null && pos.coords.speed >= 0) {
            speed = Math.round(pos.coords.speed * 3.6 * 10) / 10;
          }
          if (pos.coords.altitude !== null) {
            altitude = Math.round(pos.coords.altitude);
          }
          if (pos.coords.accuracy != null) {
            lastGpsAccuracy = Math.round(pos.coords.accuracy);
          }
        }
      } catch (gpsErr) {
        console.warn("Auto-tracking: GPS nedostupná, bod vynechán:", gpsErr);
        return; // bod bez GPS nemá smysl odesílat
      }
    }

    const base = {
      entry_id: "",
      time: new Date().toISOString(),
      lat,
      lon,
      battery: batteryLevel,
      speed,
      altitude,
    };

    const payload = createTrackPayload(base, lastGpsAccuracy);

    if (isOnline) {
      try {
        await directPost(payload);
        console.log("Auto-tracking: bod odeslán", payload.time);
      } catch (postErr) {
        const err = postErr;
        if (err && (err.code === "UNAUTHORIZED" || err.code === "CONFIG")) {
          console.error("Auto-tracking: neautorizováno, tracking zastaven");
          stopTracking();
          return;
        }
        // Síťová chyba → fronta
        await enqueue(payload);
        swSyncRegister();
        console.log("Auto-tracking: bod zařazen do fronty");
      }
    } else {
      await enqueue(payload);
      swSyncRegister();
      console.log("Auto-tracking: offline, bod zařazen do fronty");
    }
  } catch (err) {
    console.error("Auto-tracking: chyba při odesílání bodu:", err);
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

function startTracking(intervalMin) {
  const validInterval = TRACKING_INTERVALS_MIN.includes(intervalMin)
    ? intervalMin
    : TRACKING_DEFAULT_INTERVAL_MIN;

  // Pokud je tracking již zapnutý se stejným intervalem, nic neděláme
  if (_trackingEnabled && _trackingIntervalMin === validInterval && _trackingTimerId !== null) {
    return;
  }

  // Zastavit případný předchozí timer
  if (_trackingTimerId !== null) {
    clearInterval(_trackingTimerId);
    _trackingTimerId = null;
  }

  _trackingEnabled = true;
  _trackingIntervalMin = validInterval;
  saveTrackingSettings(true, validInterval);

  const intervalMs = validInterval * 60 * 1000;
  _trackingTimerId = setInterval(sendTrackPoint, intervalMs);

  // Okamžitě odeslat první bod
  sendTrackPoint();

  // Spustit Background Runner pro pozadí
  _startBackgroundRunner(validInterval);

  updateTrackingBadge(true, validInterval);
  updateTrackingDialogUI();

  console.log(`Auto-tracking spuštěn, interval: ${validInterval} min`);
}

function stopTracking() {
  if (_trackingTimerId !== null) {
    clearInterval(_trackingTimerId);
    _trackingTimerId = null;
  }

  _trackingEnabled = false;
  saveTrackingSettings(false, _trackingIntervalMin);

  // Zastavit Background Runner
  _stopBackgroundRunner();

  updateTrackingBadge(false, _trackingIntervalMin);
  updateTrackingDialogUI();

  console.log("Auto-tracking zastaven");
}

// ── Background Runner (Capacitor) ─────────────────────────────────────────────

function _startBackgroundRunner(intervalMin) {
  try {
    const BackgroundRunner = getCapacitorPlugin("BackgroundRunner");
    if (!BackgroundRunner) return;
    BackgroundRunner.dispatchEvent({
      label: "cz.behpoznamky.app.background",
      event: "startTracking",
      details: { intervalMin },
    }).catch((e) => console.warn("BackgroundRunner dispatchEvent selhalo:", e));
  } catch (e) {
    console.warn("BackgroundRunner nedostupný:", e);
  }
}

function _stopBackgroundRunner() {
  try {
    const BackgroundRunner = getCapacitorPlugin("BackgroundRunner");
    if (!BackgroundRunner) return;
    BackgroundRunner.dispatchEvent({
      label: "cz.behpoznamky.app.background",
      event: "stopTracking",
      details: {},
    }).catch((e) => console.warn("BackgroundRunner stop selhalo:", e));
  } catch (e) {
    console.warn("BackgroundRunner nedostupný:", e);
  }
}

// ── Inicializace (voláno z app.js při startu) ─────────────────────────────────

function initTracking() {
  const settings = getTrackingSettings();
  _trackingIntervalMin = settings.intervalMin;

  if (settings.enabled) {
    console.log("Auto-tracking: obnovuji tracking po restartu aplikace");
    startTracking(settings.intervalMin);
  }

  // Inicializovat dialog UI
  _bindTrackingDialog();
}

// ── Dialog nastavení ──────────────────────────────────────────────────────────

function openTrackingDialog() {
  updateTrackingDialogUI();
  const dialog = document.getElementById("tracking-dialog");
  const overlay = document.getElementById("tracking-overlay");
  if (dialog) dialog.classList.remove("hidden");
  if (overlay) overlay.classList.remove("hidden");
}

function closeTrackingDialog() {
  const dialog = document.getElementById("tracking-dialog");
  const overlay = document.getElementById("tracking-overlay");
  if (dialog) dialog.classList.add("hidden");
  if (overlay) overlay.classList.add("hidden");
}

function updateTrackingDialogUI() {
  const toggle = document.getElementById("tracking-toggle");
  if (toggle) toggle.checked = _trackingEnabled;

  // Zvýraznit aktivní interval
  TRACKING_INTERVALS_MIN.forEach((min) => {
    const btn = document.getElementById(`tracking-interval-${min}`);
    if (btn) {
      btn.classList.toggle("active", min === _trackingIntervalMin);
    }
  });
}

function _bindTrackingDialog() {
  const toggle = document.getElementById("tracking-toggle");
  if (toggle) {
    toggle.addEventListener("change", () => {
      if (toggle.checked) {
        startTracking(_trackingIntervalMin);
      } else {
        stopTracking();
      }
    });
  }

  // Interval tlačítka
  TRACKING_INTERVALS_MIN.forEach((min) => {
    const btn = document.getElementById(`tracking-interval-${min}`);
    if (btn) {
      btn.addEventListener("click", () => {
        _trackingIntervalMin = min;
        saveTrackingSettings(_trackingEnabled, min);
        updateTrackingDialogUI();
        // Pokud je tracking zapnutý, restartovat s novým intervalem
        if (_trackingEnabled) {
          startTracking(min);
        }
      });
    }
  });

  const closeBtn = document.getElementById("tracking-dialog-close");
  if (closeBtn) closeBtn.addEventListener("click", closeTrackingDialog);

  const overlay = document.getElementById("tracking-overlay");
  if (overlay) overlay.addEventListener("click", closeTrackingDialog);
}
