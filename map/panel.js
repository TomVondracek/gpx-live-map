// ── Panel zpráv ───────────────────────────────────────────────────────────────
const notesList = document.getElementById("notes-list");
notesList.addEventListener("scroll", () => {
  userScrolled = notesList.scrollTop > 40;
}, { passive: true });

function renderNotesList(validPoints) {
  const list = document.getElementById("notes-list");
  const empty = document.getElementById("notes-empty");
  const countBadge = document.getElementById("notes-count");
  const fabCount = document.getElementById("fab-count");

  const reversed = [...validPoints].reverse();

  countBadge.textContent = reversed.length;
  fabCount.textContent = reversed.length;

  if (reversed.length === 0) {
    empty.style.display = "block";
    Array.from(list.querySelectorAll(".note-item")).forEach((el) => el.remove());
    return;
  }

  empty.style.display = "none";
  Array.from(list.querySelectorAll(".note-item")).forEach((el) => el.remove());

  reversed.forEach((point) => {
    const hasGps = point.lat !== null && point.lat !== "" && point.lon !== null && point.lon !== "";
    const pointKey = getPointKey(point);
    const entryType = getEntryType(point);

    const item = document.createElement("div");
    item.className = "note-item" + (hasGps ? "" : " no-gps");
    item.dataset.pointKey = pointKey;
    if (activePointKey === pointKey) item.classList.add("active");

    const timeEl = document.createElement("div");
    timeEl.className = "note-time";
    timeEl.textContent = formatTimeShort(point.time) || "—";

    const textEl = document.createElement("div");
    const noteText = (point.note ?? "").trim();
    if (entryType === "audio") {
      textEl.className = "note-text audio";
      textEl.textContent = "▶ Hlasová poznámka";
    } else if (entryType === "photo") {
      textEl.className = "note-text photo";
      textEl.textContent = "📷 Fotografie";
    } else if (entryType === "track") {
      textEl.className = "note-text";
      textEl.textContent = "📍 Auto-tracking";
    } else {
      textEl.className = "note-text" + (noteText ? "" : " empty");
      textEl.textContent = noteText || "bez textu";
    }

    item.appendChild(timeEl);
    item.appendChild(textEl);

    if (entryType === "audio") {
      item.appendChild(createAudioPlayControl(point, { compact: true }));
    } else if (entryType === "photo") {
      const img = document.createElement("img");
      img.src = `https://drive.google.com/thumbnail?id=${point.photo_file_id}&sz=w800`;
      img.style.width = "100%";
      img.style.maxHeight = "120px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "6px";
      img.style.marginTop = "6px";
      img.style.cursor = "pointer";
      img.onclick = (e) => { e.stopPropagation(); window.openLightbox(point); };
      item.appendChild(img);
    }

    const metaParts = [];
    if (point.weather_code != null) {
      const emoji = getWeatherEmoji(point.weather_code);
      const temp = point.weather_temp != null ? ` ${Math.round(point.weather_temp)}°C` : "";
      metaParts.push(`${emoji}${temp}`);
    }
    if (entryType === "audio" && point.audio_duration_sec != null) {
      metaParts.push(`🎙 ${formatAudioDuration(point.audio_duration_sec)}`);
    }
    if (entryType === "track" && point.gps_accuracy != null) {
      metaParts.push(`± ${point.gps_accuracy} m`);
    }
    if (point.speed != null) metaParts.push(`⚡ ${point.speed} km/h`);
    if (point.altitude != null) metaParts.push(`▲ ${point.altitude} m`);

    if (hasGps && gpxPoints.length > 0) {
      const routeKm = findRouteKm(Number(point.lat), Number(point.lon));
      if (routeKm != null) {
        metaParts.push(`📍 km ${routeKm}`);
      }
      point._routeKm = routeKm;
    }

    if (metaParts.length > 0) {
      const metaEl = document.createElement("div");
      metaEl.className = "note-meta";
      metaEl.style.fontSize = "0.75rem";
      metaEl.style.color = "var(--muted)";
      metaEl.style.marginTop = "6px";
      metaEl.textContent = metaParts.join("  ·  ");
      item.appendChild(metaEl);
    }

    if (hasGps) {
      item.addEventListener("click", () => {
        const lat = Number(point.lat);
        const lon = Number(point.lon);
        activePointKey = pointKey;
        syncActiveNoteUI();

        map.setView([lat, lon], 15, { animate: true });
        const marker = markerByPointKey.get(pointKey);
        if (marker) {
          marker.openPopup();
        }

        if (window.innerWidth <= 768) {
          closeMobilePanel();
        }
      });
    }

    list.appendChild(item);
  });

  if (!userScrolled) {
    list.scrollTop = 0;
  }
}

// ── Mobilní panel – otevření/zavření ────────────────────────────────────────
const panel = document.getElementById("notes-panel");
const fab = document.getElementById("notes-fab");
const closeBtn = document.getElementById("notes-close");
const backBtn = document.getElementById("map-back");
const downloadGpxBtn = document.getElementById("map-download-gpx");

function getMainScreenUrl() {
  const path = window.location.pathname || "";
  return path.endsWith("/map.html") || path.endsWith("\\map.html")
    ? "./index.html"
    : "./app.html";
}

function goBackToMainScreen() {
  const sameOriginReferrer = document.referrer && document.referrer.startsWith(window.location.origin);
  if (sameOriginReferrer && window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = getMainScreenUrl();
}

function openMobilePanel() {
  panel.classList.add("open");
  userScrolled = false;
}

function closeMobilePanel() {
  panel.classList.remove("open");
}

function toggleMobilePanel() {
  if (panel.classList.contains("open")) {
    closeMobilePanel();
  } else {
    openMobilePanel();
  }
}

fab.addEventListener("click", toggleMobilePanel);
closeBtn.addEventListener("click", closeMobilePanel);
backBtn.addEventListener("click", goBackToMainScreen);
downloadGpxBtn.addEventListener("click", downloadOrShareGpx);

map.on("click", () => {
  if (window.innerWidth <= 768) {
    closeMobilePanel();
  }
});
