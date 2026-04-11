// ── Odeslání poznámky ─────────────────────────────────────────────────────────
async function buildBasePayload() {
  await refreshBattery();

  let lat = null;
  let lon = null;
  let speed = null;
  let altitude = null;

  const CACHE_MAX_AGE_MS = 30000;
  const cacheAge = lastGpsCoords ? (Date.now() - lastGpsCoords.ts) : Infinity;

  if (lastGpsCoords && cacheAge <= CACHE_MAX_AGE_MS) {
    lat = lastGpsCoords.lat;
    lon = lastGpsCoords.lon;
    speed = lastGpsCoords.speed;
    altitude = lastGpsCoords.altitude;
  } else {
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      lastGpsAccuracy = pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null;
      if (pos.coords.speed !== null && pos.coords.speed >= 0) {
        speed = Math.round(pos.coords.speed * 3.6 * 10) / 10;
      }
      if (pos.coords.altitude !== null) {
        altitude = Math.round(pos.coords.altitude);
      }
    } catch {
      showError("GPS nedostupná — záznam bude uložen bez polohy.");
    }
  }

  return {
    time: new Date().toISOString(),
    lat,
    lon,
    battery: batteryLevel,
    speed,
    altitude,
  };
}

async function sendNote() {
  if (!WRITE_TOKEN) {
    showError("Chybí write token v runtime-config.js.");
    return;
  }

  const note = document.getElementById("transcript").value.trim();
  const hasTextNote = Boolean(note);
  const hasAudioNote = Boolean(pendingAudioNote);
  const hasPhotoNote = Boolean(pendingPhoto);
  if (!hasTextNote && !hasAudioNote && !hasPhotoNote) return;

  document.getElementById("btn-send").disabled = true;
  document.getElementById("btn-send").textContent = "Odesílám…";

  try {
    const basePayload = await buildBasePayload();
    let payload;

    if (hasPhotoNote) {
      payload = {
        ...basePayload,
        entry_type: "photo",
        note: "",
        photo_base64: pendingPhoto.base64,
        photo_mime: pendingPhoto.mimeType,
      };
    } else if (hasAudioNote) {
      payload = {
        ...basePayload,
        entry_type: "audio",
        note: "",
        audioBlob: pendingAudioNote.blob,
        audioMime: pendingAudioNote.mimeType,
        audioDurationSec: pendingAudioNote.durationSec,
        audioFileName: pendingAudioNote.fileName,
      };
    } else {
      payload = {
        ...basePayload,
        entry_type: "text",
        note,
      };
    }

    if (isOnline) {
      try {
        await directPost(payload);
        if (hasPhotoNote) {
          showSuccess("Fotka odeslána!");
        } else {
          showSuccess(hasAudioNote ? "Hlasová poznámka odeslána!" : "Odesláno!");
        }
      } catch (postError) {
        if (postError && (postError.code === "UNAUTHORIZED" || postError.code === "CONFIG")) {
          throw postError;
        }
        console.log("Přímé odeslání selhalo, ukládám do fronty:", postError);
        const serialized = await serializePayloadForPost(payload);
        await enqueue(serialized);
        swSyncRegister();
        showSuccess(hasAudioNote
          ? "Audio se teď nepodařilo odeslat, zkusí se znovu automaticky."
          : "Odeslání selhalo, zkusí se znovu automaticky.");
      }
    } else {
      const serialized = await serializePayloadForPost(payload);
      await enqueue(serialized);
      swSyncRegister();
      showSuccess(hasAudioNote
        ? "Offline — hlasová poznámka se odešle automaticky při signálu."
        : "Offline — odešle se automaticky při signálu.");
    }

    discardNote({ keepMessages: true });
    await updateStatus();
  } catch (e) {
    showError("Chyba při ukládání: " + e.message);
  } finally {
    document.getElementById("btn-send").disabled = false;
    document.getElementById("btn-send").textContent = "Odeslat";
  }
}

async function directPost(payload, url = SHEET_URL) {
  if (!WRITE_TOKEN) {
    const error = new Error("Chybí write token v runtime-config.js.");
    error.code = "CONFIG";
    throw error;
  }

  const postBody = await serializePayloadForPost(payload);
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      ...postBody,
      token: WRITE_TOKEN,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("HTTP chyba při odesílání na server:", res.status, text);
    throw new Error(`HTTP ${res.status}`);
  }

  if (!text) return;

  try {
    const data = JSON.parse(text);
    if (data && data.ok === false) {
      const error = new Error(data.error || "Neautorizovaný požadavek.");
      error.code = data.error === "unauthorized" ? "UNAUTHORIZED" : "API";
      throw error;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      return;
    }
    throw e;
  }
}
