function discardNote(options = {}) {
  document.getElementById("transcript").value = "";
  document.getElementById("transcript").classList.add("hidden");
  autoResize();
  document.getElementById("section-confirm").classList.add("hidden");
  currentTranscript = "";
  clearPendingAudioPreview();
  clearPendingPhotoPreview();
  if (!options.keepMessages) {
    document.getElementById("section-error").classList.add("hidden");
    document.getElementById("section-success").classList.add("hidden");
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
/** Auto-resize textarea to fit content (JS fallback for field-sizing: content) */
function autoResize() {
  const el = document.getElementById("transcript");
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function showError(msg) {
  const el = document.getElementById("section-error");
  el.textContent = msg;
  el.classList.remove("hidden");
  document.getElementById("section-success").classList.add("hidden");
  vibrate("error");
}

function showSuccess(msg) {
  const el = document.getElementById("section-success");
  el.textContent = msg;
  el.classList.remove("hidden");
  document.getElementById("section-error").classList.add("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
  vibrate("success");
}

function getMapPageHref() {
  const path = window.location.pathname || "";
  if (path.endsWith("/index.html") || path.endsWith("\\index.html")) {
    return "./map.html";
  }
  return "./index.html";
}

function getMapLinkTarget() {
  const baseHref = getMapPageHref();
  if (!READ_TOKEN) {
    return baseHref;
  }
  return `${baseHref}#token=${encodeURIComponent(READ_TOKEN)}`;
}

function configureMapLinks() {
  const links = document.querySelectorAll("[data-map-link]");
  if (!links.length) return;

  links.forEach((link) => {
    const target = getMapLinkTarget();
    link.setAttribute("href", target);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.assign(target);
    });
  });
}

async function updateStatus() {
  const queueCount = await getQueueCount();
  const onlineText = isOnline ? "Online" : "Offline";
  const batteryText = batteryLevel !== null ? `Baterie: ${batteryLevel}%` : "";
  const speechText = getSpeechStatusText();

  const dot = document.getElementById("status-dot");
  const textEl = document.getElementById("status-text");
  if (dot) dot.classList.toggle("offline", !isOnline);

  if (textEl) {
    const parts = [onlineText, speechText, batteryText].filter(Boolean).join("  ·  ");

    let gpsBadgeHtml = "";
    if (lastGpsAccuracy !== null) {
      let gpsClass = "gps-badge-bad";
      if (lastGpsAccuracy <= 10) gpsClass = "gps-badge-good";
      else if (lastGpsAccuracy <= 30) gpsClass = "gps-badge-ok";
      gpsBadgeHtml = `  ·  <span id="gps-badge" class="${gpsClass}">GPS: ~${lastGpsAccuracy} m</span>`;
    }

    let queueBadgeHtml = "";
    if (queueCount > 0) {
      queueBadgeHtml = `  ·  <button id="queue-badge">Čekají: ${queueCount}</button>`;
    }

    if (gpsBadgeHtml || queueBadgeHtml) {
      textEl.innerHTML = `${parts}${gpsBadgeHtml}${queueBadgeHtml}`;
      const badge = document.getElementById("queue-badge");
      if (badge) badge.addEventListener("click", () => { vibrate("light"); openQueuePanel(); });
    } else {
      textEl.textContent = parts;
    }
  }
  updateDiagnostics();
}
