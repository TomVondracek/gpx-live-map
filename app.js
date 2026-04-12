// ── Inicializace ──────────────────────────────────────────────────────────────
async function init() {
  // Glove mode — načíst z localStorage před prvním renderem
  try { gloveMode = localStorage.getItem("gloveMode") === "true"; } catch {}
  document.body.classList.toggle("glove", gloveMode);
  const gloveBtn = document.getElementById("btn-glove");
  if (gloveBtn) {
    gloveBtn.setAttribute("aria-pressed", String(gloveMode));
    gloveBtn.classList.toggle("glove-active", gloveMode);
    gloveBtn.addEventListener("click", () => {
      vibrate("light");
      setGloveMode(!gloveMode);
    });
  }

  await Promise.all([
    initNetwork(),
    initBattery(),
    registerServiceWorker().then(() => saveConfigForSW()),
  ]);

  setRecordingUI(false);
  document.getElementById("btn-record").addEventListener("click", async () => {
    vibrate("light");
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  });

  document.getElementById("btn-audio").addEventListener("click", async () => {
    vibrate("light");
    if (isRecording && activeCaptureMode === "audio") {
      await stopAudioRecording();
    } else if (!isRecording) {
      await startAudioRecording();
    }
  });

  document.getElementById("btn-photo").addEventListener("click", async () => {
    vibrate("light");
    if (!isRecording) {
      await takePhoto();
    }
  });

  document.getElementById("btn-send").addEventListener("click", sendNote);
  document.getElementById("btn-discard").addEventListener("click", discardNote);
  document.getElementById("transcript").addEventListener("input", autoResize);

  document.getElementById("queue-panel-close").addEventListener("click", () => {
    vibrate("light");
    closeQueuePanel();
  });
  document.getElementById("queue-overlay").addEventListener("click", closeQueuePanel);

  configureMapLinks();

  initSpeech().then(() => {
    updateStatus();
    if (!isRecording) setRecordingUI(false);
  });

  await updateStatus();

  if (isOnline) {
    flushQueue();
  }

  startGpsWatch();

  window.addEventListener("beforeunload", () => { allowScreenOff(); stopGpsWatch(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      allowScreenOff();
    } else if (document.visibilityState === "visible" && isOnline) {
      flushQueue();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
