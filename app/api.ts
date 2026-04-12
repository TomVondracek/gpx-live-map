// ── Odeslání poznámky ─────────────────────────────────────────────────────────
async function buildBasePayload(): Promise<BaseNotePayload> {
  await refreshBattery();

  let lat: number | null = null;
  let lon: number | null = null;
  let speed: number | null = null;
  let altitude: number | null = null;

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
    entry_id: "",   // factory funkce (createTextPayload atd.) entry_id přepíše
    time: new Date().toISOString(),
    lat,
    lon,
    battery: batteryLevel,
    speed,
    altitude,
  };
}

async function sendNote(): Promise<void> {
  if (!WRITE_TOKEN) {
    showError("Chybí write token v runtime-config.js.");
    return;
  }

  const transcriptEl = document.getElementById("transcript") as HTMLTextAreaElement;
  const note = transcriptEl.value.trim();
  const hasTextNote = Boolean(note);
  const hasAudioNote = Boolean(pendingAudioNote);
  const hasPhotoNote = Boolean(pendingPhoto);
  if (!hasTextNote && !hasAudioNote && !hasPhotoNote) return;

  const btnSend = document.getElementById("btn-send") as HTMLButtonElement;
  btnSend.disabled = true;
  btnSend.textContent = "Odesílám…";

  try {
    const basePayload = await buildBasePayload();
    let payload: AnyNotePayload;

    if (hasPhotoNote) {
      payload = createPhotoPayload(basePayload, pendingPhoto!);
    } else if (hasAudioNote) {
      payload = createAudioPayload(basePayload, pendingAudioNote!);
    } else {
      payload = createTextPayload(basePayload, note);
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
        const err = postError as { code?: string };
        if (err && (err.code === "UNAUTHORIZED" || err.code === "CONFIG")) {
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
    showError("Chyba při ukládání: " + (e as Error).message);
  } finally {
    btnSend.disabled = false;
    btnSend.textContent = "Odeslat";
  }
}

async function directPost(payload: AnyNotePayload | SerializedPayload, url: string = SHEET_URL): Promise<void> {
  if (!WRITE_TOKEN) {
    const error = Object.assign(new Error("Chybí write token v runtime-config.js."), { code: "CONFIG" });
    throw error;
  }

  const postBody = await serializePayloadForPost(payload as AnyNotePayload);
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
    const data = JSON.parse(text) as { ok?: boolean; error?: string } | null;
    if (data && data.ok === false) {
      const error = Object.assign(
        new Error(data.error || "Neautorizovaný požadavek."),
        { code: data.error === "unauthorized" ? "UNAUTHORIZED" : "API" }
      );
      throw error;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      return;
    }
    throw e;
  }
}
