// ── Background Runner Script ──────────────────────────────────────────────────
// Tento soubor běží v izolovaném JS prostředí Background Runner pluginu.
// Nemá přístup k DOM, window, ani jiným globálním proměnným hlavní WebView.
// Dostupné API: CapacitorGeolocation, CapacitorDevice, CapacitorKV, fetch
//
// Komunikace s hlavní app: CapacitorKV (key-value store sdílený s WebView)
// Konfigurace (SHEET_URL, WRITE_TOKEN) jsou uloženy přes CapacitorKV z app/queue.ts

addEventListener("startTracking", async (detail) => {
  // Uložit nastavení intervalu pro případné budoucí běhy
  const intervalMin = (detail && detail.intervalMin) ? Number(detail.intervalMin) : 5;
  await CapacitorKV.set({ key: "bg-tracking-interval", value: String(intervalMin) });
  await CapacitorKV.set({ key: "bg-tracking-enabled", value: "true" });
  console.log(`[runner] Auto-tracking spuštěn, interval: ${intervalMin} min`);
});

addEventListener("stopTracking", async () => {
  await CapacitorKV.set({ key: "bg-tracking-enabled", value: "false" });
  console.log("[runner] Auto-tracking zastaven");
});

addEventListener("trackPoint", async () => {
  // Zkontrolovat, zda je tracking stále zapnutý
  const enabledResult = await CapacitorKV.get({ key: "bg-tracking-enabled" });
  if (!enabledResult || enabledResult.value !== "true") {
    console.log("[runner] trackPoint přeskočen — tracking je vypnutý");
    return;
  }

  // Načíst konfiguraci uloženou hlavní app
  const sheetUrlResult = await CapacitorKV.get({ key: "sheet-url" });
  const writeTokenResult = await CapacitorKV.get({ key: "write-token" });

  const sheetUrl = sheetUrlResult && sheetUrlResult.value;
  const writeToken = writeTokenResult && writeTokenResult.value;

  if (!sheetUrl || !writeToken) {
    console.warn("[runner] Chybí sheet-url nebo write-token v CapacitorKV, bod vynechán");
    return;
  }

  // Získat GPS polohu
  let lat = null;
  let lon = null;
  let speed = null;
  let altitude = null;
  let gpsAccuracy = null;

  try {
    const pos = await CapacitorGeolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
    gpsAccuracy = pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null;
    if (pos.coords.speed !== null && pos.coords.speed >= 0) {
      speed = Math.round(pos.coords.speed * 3.6 * 10) / 10;
    }
    if (pos.coords.altitude !== null) {
      altitude = Math.round(pos.coords.altitude);
    }
  } catch (gpsErr) {
    console.warn("[runner] GPS nedostupná, bod vynechán:", String(gpsErr));
    return;
  }

  // Získat stav baterie
  let battery = null;
  try {
    const battInfo = await CapacitorDevice.getBatteryInfo();
    if (battInfo && battInfo.batteryLevel != null) {
      battery = Math.round(battInfo.batteryLevel * 100);
    }
  } catch {}

  // Sestavit payload
  const entryId = _generateUUID();
  const payload = {
    entry_id: entryId,
    entry_type: "track",
    time: new Date().toISOString(),
    lat,
    lon,
    battery,
    speed,
    altitude,
    gps_accuracy: gpsAccuracy,
    token: writeToken,
  };

  // Odeslat na server
  try {
    const res = await fetch(sheetUrl, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("[runner] Bod odeslán, status:", res.status, text.substring(0, 50));
  } catch (fetchErr) {
    // Uložit do offline fronty (CapacitorKV — jednoduchá fronta)
    console.warn("[runner] Odeslání selhalo, ukládám do BG fronty:", String(fetchErr));
    await _enqueueBackground(payload, sheetUrl);
  }

  // Pokusit se vyprázdnit BG frontu
  await _flushBackgroundQueue(sheetUrl, writeToken);
});

// ── Pomocné funkce ────────────────────────────────────────────────────────────

function _generateUUID() {
  // Jednoduchý UUID v4 bez crypto (Background Runner context)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function _enqueueBackground(payload, sheetUrl) {
  try {
    const queueRaw = await CapacitorKV.get({ key: "bg-queue" });
    const queue = queueRaw && queueRaw.value ? JSON.parse(queueRaw.value) : [];
    queue.push({ payload, url: sheetUrl, createdAt: new Date().toISOString() });
    // Omezit frontu na 200 záznamů
    const trimmed = queue.slice(-200);
    await CapacitorKV.set({ key: "bg-queue", value: JSON.stringify(trimmed) });
  } catch (e) {
    console.error("[runner] Chyba při ukládání do BG fronty:", String(e));
  }
}

async function _flushBackgroundQueue(sheetUrl, writeToken) {
  try {
    const queueRaw = await CapacitorKV.get({ key: "bg-queue" });
    if (!queueRaw || !queueRaw.value) return;

    const queue = JSON.parse(queueRaw.value);
    if (!queue || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      try {
        const res = await fetch(item.url || sheetUrl, {
          method: "POST",
          body: JSON.stringify({ ...item.payload, token: writeToken }),
        });
        if (!res.ok) {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
        break; // Při síťové chybě dál nezkoušet
      }
    }

    await CapacitorKV.set({ key: "bg-queue", value: JSON.stringify(remaining) });
  } catch (e) {
    console.error("[runner] Chyba při vyprazdňování BG fronty:", String(e));
  }
}
