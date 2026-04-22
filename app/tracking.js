// ── Auto-Tracking Engine ──────────────────────────────────────────────────────
// Periodicky odesílá GPS polohu jako TrackPayload (entry_type="track").
// Na Androidu běží přes foreground service, mimo Android přes Background Runner.
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

function isNativeAndroidPlatform() {
  return typeof Capacitor !== "undefined"
    && typeof Capacitor.getPlatform === "function"
    && Capacitor.getPlatform() === "android";
}

function getNativeTrackingPlugin() {
  if (!isNativeAndroidPlatform()) {
    return null;
  }
  return getCapacitorPlugin("TrackingService");
}

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
    // Pro tracking akceptujeme GPS cache až 5 minut — telefon leží bez pohybu
    const CACHE_MAX_AGE_MS = 5 * 60 * 1000;

    const cacheAge = lastGpsCoords ? (Date.now() - lastGpsCoords.ts) : Infinity;
    if (lastGpsCoords && cacheAge <= CACHE_MAX_AGE_MS) {
      lat = lastGpsCoords.lat;
      lon = lastGpsCoords.lon;
      speed = lastGpsCoords.speed;
      altitude = lastGpsCoords.altitude;
      console.log("Auto-tracking: GPS z cache, stáří:", Math.round(cacheAge / 1000), "s");
    } else {
      // Fallback: jednorázové získání polohy
      console.log("Auto-tracking: GPS cache stará/chybí, volám getCurrentPosition...");
      try {
        const Geolocation = getCapacitorPlugin("Geolocation");
        if (Geolocation) {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
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
          console.log("Auto-tracking: GPS získána:", lat, lon);
        }
      } catch (gpsErr) {
        // GPS selhala — odešleme bod bez polohy (aspoň baterie/čas se zaznamená)
        console.warn("Auto-tracking: GPS nedostupná, odesílám bez polohy:", gpsErr);
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
    console.log("Auto-tracking: odesílám payload:", JSON.stringify({
      entry_type: payload.entry_type,
      time: payload.time,
      lat: payload.lat,
      lon: payload.lon,
      battery: payload.battery,
      gps_accuracy: payload.gps_accuracy,
    }));

    if (isOnline) {
      try {
        await directPost(payload);
        console.log("Auto-tracking: bod úspěšně odeslán", payload.time);
        showSuccess("Tracking: bod odeslán");
      } catch (postErr) {
        const err = postErr;
        if (err && (err.code === "UNAUTHORIZED" || err.code === "CONFIG")) {
          console.error("Auto-tracking: neautorizováno, tracking zastaven:", err.message);
          showError("Tracking zastaven: " + err.message);
          stopTracking();
          return;
        }
        // Síťová chyba → fronta
        console.warn("Auto-tracking: přímé odeslání selhalo, ukládám do fronty:", postErr);
        await enqueue(payload);
        swSyncRegister();
        showSuccess("Tracking: bod zařazen do fronty");
      }
    } else {
      await enqueue(payload);
      swSyncRegister();
      console.log("Auto-tracking: offline, bod zařazen do fronty");
      showSuccess("Tracking offline: bod ve frontě");
    }
  } catch (err) {
    console.error("Auto-tracking: neočekávaná chyba při odesílání bodu:", err);
    showError("Tracking chyba: " + err.message);
  }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

async function startTracking(intervalMin) {
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

  const nativePlugin = getNativeTrackingPlugin();
  if (nativePlugin) {
    const started = await _startNativeTrackingService(nativePlugin, validInterval);
    if (!started) {
      _trackingEnabled = false;
      saveTrackingSettings(false, validInterval);
      updateTrackingBadge(false, validInterval);
      updateTrackingDialogUI();
      return false;
    }
    // Nativní foreground service převzala tracking — Background Runner musí
    // být explicitně zastaven, aby neposílal duplicitní body.
    _stopBackgroundRunner();
  } else {
    const intervalMs = validInterval * 60 * 1000;
    _trackingTimerId = setInterval(sendTrackPoint, intervalMs);
    sendTrackPoint();
    // Na non-Android platformách používáme Background Runner jako zálohu.
    _startBackgroundRunner(validInterval);
  }

  _trackingEnabled = true;
  _trackingIntervalMin = validInterval;
  saveTrackingSettings(true, validInterval);

  updateTrackingBadge(true, validInterval);
  updateTrackingDialogUI();

  console.log(`Auto-tracking spuštěn, interval: ${validInterval} min`);
  return true;
}

function stopTracking() {
  if (_trackingTimerId !== null) {
    clearInterval(_trackingTimerId);
    _trackingTimerId = null;
  }

  const nativePlugin = getNativeTrackingPlugin();
  if (nativePlugin && typeof nativePlugin.stopService === "function") {
    nativePlugin.stopService().catch((e) => console.warn("TrackingService stopService selhalo:", e));
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
    const BackgroundRunner = getCapacitorPlugin("CapacitorBackgroundRunner");
    if (!BackgroundRunner) return;
    BackgroundRunner.dispatchEvent({
      label: "cz.behpoznamky.app.background",
      event: "startTracking",
      details: {
        intervalMin,
        sheetUrl: SHEET_URL || "",
        writeToken: WRITE_TOKEN || "",
      },
    }).catch((e) => console.warn("BackgroundRunner dispatchEvent selhalo:", e));
  } catch (e) {
    console.warn("BackgroundRunner nedostupný:", e);
  }
}

function _stopBackgroundRunner() {
  try {
    const BackgroundRunner = getCapacitorPlugin("CapacitorBackgroundRunner");
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

async function initTracking() {
  const settings = getTrackingSettings();
  _trackingIntervalMin = settings.intervalMin;

  updateTrackingBadge(settings.enabled, settings.intervalMin);

  if (settings.enabled) {
    console.log("Auto-tracking: obnovuji tracking po restartu aplikace");
    await startTracking(settings.intervalMin);
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
    toggle.addEventListener("change", async () => {
      if (toggle.checked) {
        const started = await startTracking(_trackingIntervalMin);
        if (!started) {
          toggle.checked = false;
        }
      } else {
        stopTracking();
      }
    });
  }

  // Interval tlačítka
  TRACKING_INTERVALS_MIN.forEach((min) => {
    const btn = document.getElementById(`tracking-interval-${min}`);
    if (btn) {
      btn.addEventListener("click", async () => {
        _trackingIntervalMin = min;
        saveTrackingSettings(_trackingEnabled, min);
        updateTrackingDialogUI();
        // Pokud je tracking zapnutý, restartovat s novým intervalem
        if (_trackingEnabled) {
          const started = await startTracking(min);
          if (!started) {
            const toggle = document.getElementById("tracking-toggle");
            if (toggle) toggle.checked = false;
          }
        }
      });
    }
  });

  const closeBtn = document.getElementById("tracking-dialog-close");
  if (closeBtn) closeBtn.addEventListener("click", closeTrackingDialog);

  const overlay = document.getElementById("tracking-overlay");
  if (overlay) overlay.addEventListener("click", closeTrackingDialog);
}

async function _startNativeTrackingService(plugin, intervalMin) {
  try {
    if (typeof plugin.checkTrackingPermissions !== "function"
      || typeof plugin.requestTrackingPermissions !== "function"
      || typeof plugin.startService !== "function") {
      console.warn("TrackingService plugin nemá očekávané metody, padám zpět na JS tracking");
      return false;
    }

    let permissions = await plugin.checkTrackingPermissions();
    if (!permissions || permissions.canStart !== true) {
      permissions = await plugin.requestTrackingPermissions();
    }

    if (!permissions || permissions.canStart !== true) {
      showError("Tracking potřebuje povolenou polohu na pozadí. V Android dialogu prosím povol \"Vždy\".");
      return false;
    }

    await plugin.startService({
      intervalMin,
      sheetUrl: SHEET_URL || "",
      writeToken: WRITE_TOKEN || "",
    });

    console.log(`TrackingService spuštěn nativně, interval: ${intervalMin} min`);
    return true;
  } catch (err) {
    console.error("TrackingService start selhal:", err);
    showError("Nepodařilo se spustit nativní tracking službu: " + (err && err.message ? err.message : err));
    return false;
  }
}
