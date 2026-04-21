// ── Background Runner Script ──────────────────────────────────────────────────
// Tento soubor běží v izolovaném JS prostředí Background Runner pluginu.
// Nemá přístup k DOM ani ke stavu hlavní WebView.
// Dostupné API: CapacitorGeolocation, CapacitorDevice, CapacitorKV, fetch, crypto

const TRACKING_ENABLED_KEY = "bg-tracking-enabled";
const TRACKING_INTERVAL_KEY = "bg-tracking-interval";
const TRACKING_LAST_POINT_AT_KEY = "bg-tracking-last-point-at";
const SHEET_URL_KEY = "sheet-url";
const WRITE_TOKEN_KEY = "write-token";
const BG_QUEUE_KEY = "bg-queue";
const ANDROID_BG_MIN_INTERVAL_MIN = 15;

addEventListener("startTracking", async (resolve, reject, args) => {
  try {
    const requestedInterval = Number(args && args.intervalMin);
    const intervalMin = Number.isFinite(requestedInterval) && requestedInterval > 0
      ? Math.round(requestedInterval)
      : 5;

    CapacitorKV.set(TRACKING_INTERVAL_KEY, String(intervalMin));
    CapacitorKV.set(TRACKING_ENABLED_KEY, "true");
    if (args && typeof args.sheetUrl === "string" && args.sheetUrl) {
      CapacitorKV.set(SHEET_URL_KEY, args.sheetUrl);
    }
    if (args && typeof args.writeToken === "string" && args.writeToken) {
      CapacitorKV.set(WRITE_TOKEN_KEY, args.writeToken);
    }

    console.log(`[runner] Auto-tracking spuštěn, cílový interval: ${intervalMin} min`);
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener("stopTracking", async (resolve, reject) => {
  try {
    CapacitorKV.set(TRACKING_ENABLED_KEY, "false");
    console.log("[runner] Auto-tracking zastaven");
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener("trackPoint", async (resolve, reject) => {
  try {
    const enabled = _getKv(TRACKING_ENABLED_KEY) === "true";
    const sheetUrl = _getKv(SHEET_URL_KEY);
    const writeToken = _getKv(WRITE_TOKEN_KEY);

    if (!sheetUrl || !writeToken) {
      console.warn("[runner] Chybí sheet-url nebo write-token, běh přeskočen");
      resolve();
      return;
    }

    if (!enabled) {
      await _flushBackgroundQueue(sheetUrl, writeToken);
      console.log("[runner] Tracking vypnutý, zkusil jsem flushnout BG frontu");
      resolve();
      return;
    }

    if (!_shouldCaptureTrackPointNow()) {
      console.log("[runner] Běh přeskočen — ještě neuplynul cílový interval");
      await _flushBackgroundQueue(sheetUrl, writeToken);
      resolve();
      return;
    }

    const payload = await _buildTrackPayload(writeToken);
    if (!payload) {
      resolve();
      return;
    }

    try {
      await _postPayload(sheetUrl, payload);
      console.log("[runner] Bod odeslán přímo na server");
    } catch (err) {
      console.warn("[runner] Odeslání selhalo, ukládám do BG fronty:", String(err));
      await _enqueueBackground(payload, sheetUrl);
    }

    CapacitorKV.set(TRACKING_LAST_POINT_AT_KEY, payload.time);
    await _flushBackgroundQueue(sheetUrl, writeToken);
    resolve();
  } catch (err) {
    reject(err);
  }
});

function _getKv(key) {
  const result = CapacitorKV.get(key);
  return result && typeof result.value === "string" ? result.value : "";
}

function _generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function _shouldCaptureTrackPointNow() {
  const intervalRaw = Number(_getKv(TRACKING_INTERVAL_KEY));
  const targetIntervalMin = Number.isFinite(intervalRaw) && intervalRaw > 0
    ? intervalRaw
    : ANDROID_BG_MIN_INTERVAL_MIN;

  const lastPointAt = _getKv(TRACKING_LAST_POINT_AT_KEY);
  if (!lastPointAt) {
    return true;
  }

  const lastPointMs = Date.parse(lastPointAt);
  if (!Number.isFinite(lastPointMs)) {
    return true;
  }

  return (Date.now() - lastPointMs) >= targetIntervalMin * 60 * 1000;
}

async function _buildTrackPayload(writeToken) {
  let position;
  try {
    position = await CapacitorGeolocation.getCurrentPosition();
  } catch (gpsErr) {
    console.warn("[runner] GPS nedostupná, bod vynechán:", String(gpsErr));
    return null;
  }

  let battery = null;
  try {
    const batteryStatus = CapacitorDevice.getBatteryStatus();
    if (batteryStatus && batteryStatus.batteryLevel != null) {
      battery = Math.round(batteryStatus.batteryLevel * 100);
    }
  } catch {}

  return {
    entry_id: _generateUUID(),
    entry_type: "track",
    time: new Date().toISOString(),
    lat: position.latitude,
    lon: position.longitude,
    battery,
    speed: (position.speed !== null && position.speed >= 0)
      ? Math.round(position.speed * 3.6 * 10) / 10
      : null,
    altitude: position.altitude !== null && position.altitude !== undefined
      ? Math.round(position.altitude)
      : null,
    gps_accuracy: position.accuracy != null ? Math.round(position.accuracy) : null,
    token: writeToken,
  };
}

async function _postPayload(sheetUrl, payload) {
  const res = await fetch(sheetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  if (!text) {
    return;
  }

  try {
    const data = JSON.parse(text);
    if (data && data.ok === false) {
      throw new Error(data.error || "api_error");
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      return;
    }
    throw err;
  }
}

async function _enqueueBackground(payload, sheetUrl) {
  try {
    const queueRaw = _getKv(BG_QUEUE_KEY);
    const queue = queueRaw ? JSON.parse(queueRaw) : [];
    queue.push({ payload, url: sheetUrl, createdAt: new Date().toISOString() });
    CapacitorKV.set(BG_QUEUE_KEY, JSON.stringify(queue.slice(-200)));
  } catch (err) {
    console.error("[runner] Chyba při ukládání do BG fronty:", String(err));
  }
}

async function _flushBackgroundQueue(sheetUrl, writeToken) {
  try {
    const queueRaw = _getKv(BG_QUEUE_KEY);
    if (!queueRaw) {
      return;
    }

    const queue = JSON.parse(queueRaw);
    if (!Array.isArray(queue) || queue.length === 0) {
      return;
    }

    const remaining = [];
    for (const item of queue) {
      try {
        await _postPayload(item.url || sheetUrl, {
          ...item.payload,
          token: writeToken,
        });
      } catch (err) {
        remaining.push(item);
        if (!String(err && err.message || err).startsWith("HTTP 4")) {
          break;
        }
      }
    }

    CapacitorKV.set(BG_QUEUE_KEY, JSON.stringify(remaining));
  } catch (err) {
    console.error("[runner] Chyba při vyprazdňování BG fronty:", String(err));
  }
}
