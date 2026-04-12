function getAudioDataUrl(fileId) {
  const token = getMapToken();
  if (!token || !fileId) return null;

  const url = new URL(SHEET_URL);
  url.searchParams.set("token", token);
  url.searchParams.set("audioFileId", fileId);
  return url.toString();
}

async function fetchAudioBlobUrl(fileId) {
  if (audioBlobUrlCache.has(fileId)) {
    return audioBlobUrlCache.get(fileId);
  }

  if (audioFetchPromises.has(fileId)) {
    return audioFetchPromises.get(fileId);
  }

  const promise = (async () => {
    const url = getAudioDataUrl(fileId);
    if (!url) {
      throw new Error("missing_audio_token");
    }

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data || data.ok === false || !data.audioBase64) {
      throw new Error(data && data.error ? data.error : "audio_unavailable");
    }

    const blobUrl = base64ToBlobUrl(data.audioBase64, data.mimeType);
    audioBlobUrlCache.set(fileId, blobUrl);
    return blobUrl;
  })().finally(() => {
    audioFetchPromises.delete(fileId);
  });

  audioFetchPromises.set(fileId, promise);
  return promise;
}

function createAudioPlayControl(point, options = {}) {
  const container = document.createElement("div");
  container.className = options.compact ? "note-audio-row" : "popup-audio";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-audio-button";
  button.textContent = point.audio_duration_sec
    ? `▶ Přehrát (${formatAudioDuration(point.audio_duration_sec)})`
    : "▶ Přehrát";

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.style.display = "none";

  if (!point.audio_file_id) {
    button.disabled = true;
    button.textContent = "Audio chybí";
  } else {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Načítám…";

      try {
        const blobUrl = await fetchAudioBlobUrl(point.audio_file_id);
        audio.src = blobUrl;
        audio.style.display = "block";
        button.textContent = "▶ Přehrát znovu";
        await audio.play().catch(() => {});
      } catch (error) {
        console.error("Načtení audia selhalo:", error);
        button.textContent = "▶ Nelze přehrát";
      } finally {
        button.disabled = false;
        if (button.textContent === "Načítám…") {
          button.textContent = originalLabel;
        }
      }
    });
  }

  container.appendChild(button);
  container.appendChild(audio);
  return container;
}

function buildPopupContent(point, weatherLine, metaParts) {
  const wrapper = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = formatTime(point.time);
  wrapper.appendChild(title);

  if (weatherLine) {
    const weather = document.createElement("span");
    weather.textContent = ` · ${weatherLine}`;
    wrapper.appendChild(weather);
  }

  wrapper.appendChild(document.createElement("br"));

  const entryType = getEntryType(point);

  if (entryType === "audio") {
    wrapper.appendChild(createAudioPlayControl(point));
  } else if (entryType === "photo") {
    const img = document.createElement("img");
    img.src = `https://drive.google.com/thumbnail?id=${point.photo_file_id}&sz=w800`;
    img.style.width = "100%";
    img.style.maxWidth = "240px";
    img.style.borderRadius = "8px";
    img.style.marginTop = "8px";
    img.style.objectFit = "contain";
    img.style.cursor = "pointer";
    img.onclick = (e) => { e.stopPropagation(); window.openLightbox(point); };

    wrapper.appendChild(img);
  } else {
    const note = document.createElement("div");
    note.textContent = point.note ?? "";
    wrapper.appendChild(note);
  }

  if (metaParts.length > 0) {
    wrapper.appendChild(document.createElement("br"));
    const meta = document.createElement("small");
    meta.style.color = "#888";
    meta.textContent = metaParts.join(" · ");
    wrapper.appendChild(meta);
  }

  return wrapper;
}
