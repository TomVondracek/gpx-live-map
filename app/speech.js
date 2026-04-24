// ── Google STT (online rozpoznávání) ─────────────────────────────────────────
async function initGoogleSTT() {
  const GoogleSTT = getCapacitorPlugin("GoogleSTT");
  if (!GoogleSTT) {
    console.log("GoogleSTT plugin není dostupný");
    return;
  }

  try {
    const result = await GoogleSTT.isAvailable();
    googleSttAvailable = result.available;
    console.log("Google STT dostupný:", googleSttAvailable);
  } catch (e) {
    console.log("Google STT kontrola selhala:", e.message);
    googleSttAvailable = false;
  }

  if (!googleSttAvailable) return;

  GoogleSTT.addListener("result", (event) => {
    if (activeEngine !== "google") return;

    if (event.isFinal) {
      appendFinalTranscriptSegment(event.text || "");
    } else {
      renderTranscriptWithPartial(event.text || "");
    }
  });

  GoogleSTT.addListener("stopped", (event) => {
    console.log("Google STT stopped:", event.reason);
    if (!isRecording || activeEngine !== "google") return;

    if (!userStoppedRecording) {
      console.log("Google STT auto-restart po silence/end_of_speech");
      restartCurrentEngine();
    } else {
      finishRecording();
    }
  });

  GoogleSTT.addListener("error", (event) => {
    console.error("Google STT error:", event.message);
    if (isRecording && activeEngine === "google") {
      isRecording = false;
      activeEngine = null;
      activeCaptureMode = null;
      setRecordingUI(false);
      showError("Chyba rozpoznávání (Google): " + event.message);
    }
  });
}

// ── Vosk Speech Recognition (offline fallback) ──────────────────────────────
async function initVosk() {
  const VoskSTT = getCapacitorPlugin("VoskSTT");
  if (!VoskSTT) {
    console.log("VoskSTT plugin není dostupný");
    return;
  }

  voskLoading = true;
  await updateStatus();

  try {
    await VoskSTT.initialize();
    voskReady = true;
    voskLoading = false;
    console.log("Vosk model načten");
  } catch (e) {
    voskLoading = false;
    voskReady = false;
    console.error("Nepodařilo se načíst Vosk model:", e.message);
  }

  VoskSTT.addListener("result", (event) => {
    if (activeEngine !== "vosk") return;

    if (event.isFinal) {
      appendFinalTranscriptSegment(event.text || "", { filterUnknownTokens: true });
    } else {
      renderTranscriptWithPartial(event.text || "", { filterUnknownTokens: true });
    }
  });

  VoskSTT.addListener("stopped", (event) => {
    console.log("Vosk stopped:", event.reason);
    if (!isRecording || activeEngine !== "vosk") return;

    if (!userStoppedRecording) {
      console.log("Vosk auto-restart po silence");
      restartCurrentEngine();
    } else {
      finishRecording();
    }
  });

  VoskSTT.addListener("error", (event) => {
    console.error("Vosk error:", event.message);
    if (isRecording && activeEngine === "vosk") {
      isRecording = false;
      activeEngine = null;
      activeCaptureMode = null;
      setRecordingUI(false);
      showError("Chyba rozpoznávání (Vosk): " + event.message);
    }
  });

  await updateStatus();
}

// ── Inicializace obou STT enginů ─────────────────────────────────────────────
async function initSpeech() {
  await Promise.all([initGoogleSTT(), initVosk()]);

  if (!googleSttAvailable && !voskReady) {
    document.getElementById("btn-record").disabled = true;
    showError("Žádný STT engine není dostupný.");
  }

  await updateStatus();
}

function chooseEngine() {
  if (isOnline && googleSttAvailable) return "google";
  if (voskReady) return "vosk";
  return null;
}

function getSpeechStatusText() {
  if (voskLoading) return "Načítám přepis…";
  const engine = chooseEngine();
  if (engine === "google" || engine === "vosk") return "";
  return "Přepis nedostupný";
}

function updateDiagnostics() {
  const engineEl = document.getElementById("diag-engine");
  const modelEl = document.getElementById("diag-model");
  const statusEl = document.getElementById("diag-status");
  const modeEl = document.getElementById("diag-mode");
  const hintEl = document.getElementById("diag-hint");

  if (!engineEl || !modelEl || !statusEl || !modeEl || !hintEl) return;

  const engine = chooseEngine();

  if (voskLoading) {
    engineEl.textContent = "Vosk (offline)";
    modelEl.textContent = "vosk-model-small-cs";
    statusEl.textContent = "načítání…";
    modeEl.textContent = "inicializace";
    hintEl.textContent = "Model se načítá, chvilku strpení.";
  } else if (engine === "google") {
    engineEl.textContent = "Google STT (online)";
    modelEl.textContent = "—";
    statusEl.textContent = "připraven";
    modeEl.textContent = "online rozpoznávání";
    hintEl.textContent = "Vysoká kvalita přes internet. Offline fallback: Vosk.";
  } else if (engine === "vosk") {
    engineEl.textContent = "Vosk (offline)";
    modelEl.textContent = "vosk-model-small-cs";
    statusEl.textContent = "připraven";
    modeEl.textContent = "offline rozpoznávání";
    hintEl.textContent = "Diktování funguje i bez internetu.";
  } else {
    engineEl.textContent = "—";
    modelEl.textContent = "—";
    statusEl.textContent = "chyba";
    modeEl.textContent = "nedostupné";
    hintEl.textContent = "Zkus restartovat aplikaci.";
  }
}

/**
 * Interní restart STT session po auto-stop (ticho/pomlka).
 * Zachová currentTranscript a stav UI — uživatel si nevšimne přerušení.
 */
async function restartCurrentEngine() {
  if (!isRecording || userStoppedRecording) return;

  const engine = activeEngine;
  if (!engine) return;

  console.log("Restartuji STT engine:", engine);

  try {
    if (engine === "google") {
      const GoogleSTT = getCapacitorPlugin("GoogleSTT");
      if (GoogleSTT) await GoogleSTT.startListening();
    } else if (engine === "vosk") {
      const VoskSTT = getCapacitorPlugin("VoskSTT");
      if (VoskSTT) await VoskSTT.startListening();
    }
  } catch (e) {
    console.error("Restart STT selhal:", e.message);
    isRecording = false;
    activeEngine = null;
    activeCaptureMode = null;
    userStoppedRecording = true;
    setRecordingUI(false);
    const transcript = document.getElementById("transcript");
    transcript.readOnly = false;
    const text = transcript.value.trim();
    if (text) {
      document.getElementById("section-confirm").classList.remove("hidden");
    }
  }
}

// ── Ovládání nahrávání ────────────────────────────────────────────────────────
async function startRecording() {
  const engine = chooseEngine();

  if (!engine) {
    showError("STT není inicializováno.");
    return;
  }

  discardNote({ keepMessages: true });
  currentTranscript = "";
  const transcript = document.getElementById("transcript");
  transcript.classList.remove("hidden");
  transcript.readOnly = true;
  document.getElementById("section-error").classList.add("hidden");

  isRecording = true;
  activeEngine = engine;
  activeCaptureMode = "speech";
  userStoppedRecording = false;

  try {
    if (engine === "google") {
      const GoogleSTT = getCapacitorPlugin("GoogleSTT");
      await GoogleSTT.startListening();
      console.log("Nahrávání spuštěno (Google STT)");
    } else {
      const VoskSTT = getCapacitorPlugin("VoskSTT");
      await VoskSTT.startListening();
      console.log("Nahrávání spuštěno (Vosk)");
    }
    setRecordingUI(true);
    vibrate("medium");
    keepScreenOn();
    beep("start");
  } catch (e) {
    isRecording = false;
    activeEngine = null;
    activeCaptureMode = null;
    setRecordingUI(false);
    if (e.message && e.message.includes("permission")) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
    } else {
      showError("Nelze spustit nahrávání: " + e.message);
    }
  }
}

async function stopRecording() {
  if (activeCaptureMode === "audio") {
    await stopAudioRecording();
    return;
  }

  isRecording = false;
  userStoppedRecording = true;

  try {
    if (activeEngine === "google") {
      const GoogleSTT = getCapacitorPlugin("GoogleSTT");
      if (GoogleSTT) await GoogleSTT.stopListening();
    } else if (activeEngine === "vosk") {
      const VoskSTT = getCapacitorPlugin("VoskSTT");
      if (VoskSTT) await VoskSTT.stopListening();
    }
  } catch {}

  activeEngine = null;
  beep("stop");
  finishRecording();
}

/**
 * Společná logika po ukončení nahrávání (ať už manuálně nebo auto-stop).
 * Zobrazí potvrzovací sekci, pokud je rozpoznaný text.
 */
function finishRecording() {
  isRecording = false;
  activeEngine = null;
  activeCaptureMode = null;
  setRecordingUI(false);
  vibrate("medium");
  allowScreenOff();

  const transcript = document.getElementById("transcript");
  transcript.readOnly = false;
  const text = transcript.value.trim();
  if (text || pendingAudioNote) {
    document.getElementById("section-confirm").classList.remove("hidden");
  } else {
    transcript.classList.add("hidden");
  }
}

function setRecordingUI(active) {
  const btn = document.getElementById("btn-record");
  const audioBtn = document.getElementById("btn-audio");
  const photoBtn = document.getElementById("btn-photo");
  const photoCameraToggleBtn = document.getElementById("btn-photo-camera-toggle");
  const indicator = document.getElementById("recording-indicator");
  const label = document.getElementById("recording-label");

  if (active && activeCaptureMode === "speech") {
    btn.textContent = "STOP";
    btn.classList.add("recording");
    btn.disabled = false;
    audioBtn.textContent = "ZVUK";
    audioBtn.classList.remove("recording");
    audioBtn.disabled = true;
    photoBtn.disabled = true;
    photoCameraToggleBtn.disabled = true;
    indicator.classList.remove("hidden");
    label.textContent = "Diktování";
  } else if (active && activeCaptureMode === "audio") {
    btn.textContent = "TEXT";
    btn.classList.remove("recording");
    btn.disabled = true;
    audioBtn.textContent = "STOP";
    audioBtn.classList.add("recording");
    audioBtn.disabled = false;
    photoBtn.disabled = true;
    photoCameraToggleBtn.disabled = true;
    indicator.classList.remove("hidden");
    label.textContent = "Nahrávám hlasovou poznámku";
  } else {
    btn.textContent = "TEXT";
    btn.classList.remove("recording");
    btn.disabled = !chooseEngine();
    audioBtn.textContent = "ZVUK";
    audioBtn.classList.remove("recording");
    audioBtn.disabled = !supportsMediaRecording();
    photoBtn.disabled = false;
    photoCameraToggleBtn.disabled = false;
    indicator.classList.add("hidden");
    label.textContent = "Nahrávám";
  }
}
