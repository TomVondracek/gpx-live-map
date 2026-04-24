// ── Inicializace ──────────────────────────────────────────────────────────────
async function init() {
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
  configureMapShareButton();

  initSpeech().then(() => {
    updateStatus();
    if (!isRecording) setRecordingUI(false);
  });

  await updateStatus();

  if (isOnline) {
    flushQueue();
  }

  startGpsWatch();

  // Inicializovat auto-tracking (obnoví tracking pokud byl zapnutý před restartem)
  initTracking();

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
