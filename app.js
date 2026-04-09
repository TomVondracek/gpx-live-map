// ── Konfigurace ───────────────────────────────────────────────────────────────
const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec";

const DB_NAME = "beh-poznamky-db";
const STORE_NAME = "queue";

// ── Capacitor Plugins ─────────────────────────────────────────────────────────
// V Capacitor WebView jsou pluginy dostupné přes globální Capacitor.Plugins
// Nepoužíváme ES modules / import, protože nemáme bundler.
function getCapacitorPlugin(name) {
  if (typeof Capacitor !== "undefined" && Capacitor.Plugins) {
    return Capacitor.Plugins[name] || null;
  }
  return null;
}

// ── Stav aplikace ────────────────────────────────────────────────────────────
let isRecording = false;
let currentTranscript = "";
let batteryLevel = null;
let isOnline = true;
let voskReady = false;
let voskLoading = false;
let isFlushing = false;
let googleSttAvailable = false;  // zda je Google STT k dispozici na zařízení
let activeEngine = null;          // "google" | "vosk" | null — který engine právě nahrává
let userStoppedRecording = false; // true = uživatel stiskl STOP → neprovádět auto-restart

// ── IndexedDB ─────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function enqueue(payload) {
  const db = await openDB();
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url: SHEET_URL,
    payload,
    createdAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(record);
    req.onsuccess = () => resolve(record.id);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getQueueCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = resolve;
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAllFromQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── GPS (Capacitor Geolocation) ──────────────────────────────────────────────
async function getPosition() {
  const Geolocation = getCapacitorPlugin("Geolocation");
  if (!Geolocation) {
    throw new Error("Geolocation plugin není dostupný");
  }
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000,
  });
  return pos;
}

// ── Baterie (Capacitor Device) ────────────────────────────────────────────────
async function initBattery() {
  const Device = getCapacitorPlugin("Device");
  if (!Device) return;
  try {
    const info = await Device.getBatteryInfo();
    batteryLevel = Math.round((info.batteryLevel || 0) * 100);
    // Capacitor Device nemá real-time battery listener,
    // budeme aktualizovat při každém sendNote
  } catch {
    // Battery API nedostupná
  }
}

async function refreshBattery() {
  const Device = getCapacitorPlugin("Device");
  if (!Device) return;
  try {
    const info = await Device.getBatteryInfo();
    batteryLevel = Math.round((info.batteryLevel || 0) * 100);
  } catch {
    // ignorovat
  }
}

// ── Network (Capacitor Network) ──────────────────────────────────────────────
async function initNetwork() {
  const Network = getCapacitorPlugin("Network");
  if (!Network) {
    // Fallback na navigator.onLine
    isOnline = navigator.onLine;
    window.addEventListener("online", () => {
      isOnline = true;
      onNetworkChange();
    });
    window.addEventListener("offline", () => {
      isOnline = false;
      onNetworkChange();
    });
    return;
  }

  try {
    const status = await Network.getStatus();
    isOnline = status.connected;
  } catch {
    isOnline = navigator.onLine;
  }

  Network.addListener("networkStatusChange", (status) => {
    isOnline = status.connected;
    onNetworkChange();
  });
}

async function onNetworkChange() {
  await updateStatus();
  if (isOnline) {
    // Při přechodu do online: vyprázdnit offline frontu
    await flushQueue();
  }
}

// ── Offline fronta — flush (nahrazuje Service Worker Background Sync) ────────
async function flushQueue() {
  // Mutex — zajistí, že běží max jedna instance současně
  if (isFlushing) {
    console.log("Flush queue: již probíhá, přeskakuji");
    return;
  }
  isFlushing = true;

  try {
    const records = await getAllFromQueue();
    if (records.length === 0) return;

    console.log(`Flush queue: ${records.length} čekajících záznamů`);

    for (const record of records) {
      try {
        const res = await fetch(record.url, {
          method: "POST",
          body: JSON.stringify(record.payload),
          // bez Content-Type → "text/plain" → simple request → žádný CORS preflight
        });

        if (res.ok) {
          await deleteFromQueue(record.id);
          console.log(`Odesláno z fronty: ${record.id}`);
        }
      } catch {
        // Síť stále nedostupná — přestat, zkusíme znovu příště
        console.log("Flush queue: síť nedostupná, zkusíme později");
        break;
      }
    }

    await updateStatus();
  } finally {
    isFlushing = false;
  }
}

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

  // Naslouchej výsledkům — stejný formát jako Vosk
  GoogleSTT.addListener("result", (event) => {
    // Google STT posílá partial results jako CELÝ text (ne jen delta),
    // takže pro partial nahradíme celý zobrazený text
    if (activeEngine !== "google") return;

    if (event.isFinal) {
      const text = event.text || "";
      if (text) {
        currentTranscript += (currentTranscript ? " " : "") + text;
        document.getElementById("transcript").value = currentTranscript;
        autoResize();
      }
    } else {
      const partial = event.text || "";
      document.getElementById("transcript").value =
        currentTranscript + (currentTranscript && partial ? " " : "") + partial;
      autoResize();
    }
  });

  GoogleSTT.addListener("stopped", (event) => {
    console.log("Google STT stopped:", event.reason);
    if (!isRecording || activeEngine !== "google") return;

    // Pokud uživatel ručně nezastavil a STT skončilo samo (ticho / end of speech)
    // → auto-restart session, aby nahrávání pokračovalo bez přerušení
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

  // Naslouchej výsledkům rozpoznávání
  VoskSTT.addListener("result", (event) => {
    if (activeEngine !== "vosk") return;

    if (event.isFinal) {
      const text = event.text || "";
      if (text) {
        currentTranscript += (currentTranscript ? " " : "") + text;
        document.getElementById("transcript").value = currentTranscript;
        autoResize();
      }
    } else {
      const partial = event.text || "";
      document.getElementById("transcript").value =
        currentTranscript + (currentTranscript && partial ? " " : "") + partial;
      autoResize();
    }
  });

  VoskSTT.addListener("stopped", (event) => {
    console.log("Vosk stopped:", event.reason);
    if (!isRecording || activeEngine !== "vosk") return;

    // Pokud uživatel ručně nezastavil a Vosk skončilo samo (detekce ticha)
    // → auto-restart session, aby nahrávání pokračovalo bez přerušení
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
      setRecordingUI(false);
      showError("Chyba rozpoznávání (Vosk): " + event.message);
    }
  });

  await updateStatus();
}

// ── Inicializace obou STT enginů ─────────────────────────────────────────────
async function initSpeech() {
  // Inicializuj oba enginy paralelně
  await Promise.all([initGoogleSTT(), initVosk()]);

  // Pokud ani jeden engine není k dispozici, zablokuj tlačítko
  if (!googleSttAvailable && !voskReady) {
    document.getElementById("btn-record").disabled = true;
    showError("Žádný STT engine není dostupný.");
  }

  await updateStatus();
}

/**
 * Vrátí engine, který se má použít pro nahrávání.
 * Online + Google dostupný → "google"
 * Jinak → "vosk" (pokud je ready)
 * Jinak → null
 */
function chooseEngine() {
  if (isOnline && googleSttAvailable) return "google";
  if (voskReady) return "vosk";
  return null;
}

function getSpeechStatusText() {
  if (voskLoading) return "STT: načítám Vosk…";

  const engine = chooseEngine();
  if (engine === "google") return "STT: online (Google)";
  if (engine === "vosk") return "STT: offline (Vosk)";
  return "STT: nedostupné";
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
    // UI zůstane beze změny (indikátor nahrávání svítí dál)
  } catch (e) {
    console.error("Restart STT selhal:", e.message);
    // Restart selhal → ukončíme normálně
    isRecording = false;
    activeEngine = null;
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

  currentTranscript = "";
  const transcript = document.getElementById("transcript");
  transcript.value = "";
  transcript.readOnly = true;
  autoResize();
  document.getElementById("section-confirm").classList.add("hidden");
  document.getElementById("section-error").classList.add("hidden");

  isRecording = true;
  activeEngine = engine;
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
  } catch (e) {
    isRecording = false;
    activeEngine = null;
    if (e.message && e.message.includes("permission")) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
    } else {
      showError("Nelze spustit nahrávání: " + e.message);
    }
  }
}

async function stopRecording() {
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
  } catch {
    // already stopped
  }

  activeEngine = null;
  finishRecording();
}

/**
 * Společná logika po ukončení nahrávání (ať už manuálně nebo auto-stop).
 * Zobrazí potvrzovací sekci, pokud je rozpoznaný text.
 */
function finishRecording() {
  isRecording = false;
  activeEngine = null;
  setRecordingUI(false);

  const transcript = document.getElementById("transcript");
  transcript.readOnly = false;
  const text = transcript.value.trim();
  if (text) {
    document.getElementById("section-confirm").classList.remove("hidden");
  }
}

function setRecordingUI(active) {
  const btn = document.getElementById("btn-record");
  const indicator = document.getElementById("recording-indicator");
  if (active) {
    btn.textContent = "STOP";
    btn.classList.add("recording");
    indicator.classList.remove("hidden");
  } else {
    btn.textContent = "MLUVIT";
    btn.classList.remove("recording");
    indicator.classList.add("hidden");
  }
}

// ── Odeslání poznámky ─────────────────────────────────────────────────────────
async function sendNote() {
  const note = document.getElementById("transcript").value.trim();
  if (!note) return;

  document.getElementById("btn-send").disabled = true;
  document.getElementById("btn-send").textContent = "Odesílám…";

  // Aktualizovat baterii
  await refreshBattery();

  let lat = null;
  let lon = null;
  let speed = null;
  let altitude = null;

  try {
    const pos = await getPosition();
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
    
    if (pos.coords.speed !== null && pos.coords.speed >= 0) {
      speed = Math.round(pos.coords.speed * 3.6 * 10) / 10;
    }
    if (pos.coords.altitude !== null) {
      altitude = Math.round(pos.coords.altitude);
    }
  } catch {
    // GPS nedostupná — odešleme bez souřadnic
    showError("GPS nedostupná — poznámka uložena bez polohy.");
  }

  const now = new Date();
  const payload = {
    time: now.toISOString(),
    lat,
    lon,
    note,
    battery: batteryLevel,
    speed,
    altitude,
  };

  try {
    if (isOnline) {
      // Online: pošli přímo, při selhání ulož do fronty
      try {
        await directPost(payload);
        showSuccess("Odesláno!");
      } catch (postError) {
        console.log("Přímé odeslání selhalo, ukládám do fronty:", postError);
        await enqueue(payload);
        showSuccess("Odeslání selhalo, zkusí se znovu automaticky.");
      }
    } else {
      // Offline: ulož do fronty
      await enqueue(payload);
      showSuccess("Offline — odešle se automaticky při signálu.");
    }

    document.getElementById("transcript").value = "";
    autoResize();
    document.getElementById("section-confirm").classList.add("hidden");
    currentTranscript = "";
    await updateStatus();
  } catch (e) {
    showError("Chyba při ukládání: " + e.message);
  } finally {
    document.getElementById("btn-send").disabled = false;
    document.getElementById("btn-send").textContent = "Odeslat";
  }
}

async function directPost(payload) {
  const res = await fetch(SHEET_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    // bez Content-Type → "text/plain" → simple request → žádný CORS preflight
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function discardNote() {
  document.getElementById("transcript").value = "";
  autoResize();
  document.getElementById("section-confirm").classList.add("hidden");
  currentTranscript = "";
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
}

function showSuccess(msg) {
  const el = document.getElementById("section-success");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

async function updateStatus() {
  const queueCount = await getQueueCount();
  const onlineText = isOnline ? "Online" : "Offline";
  const batteryText = batteryLevel !== null ? `Baterie: ${batteryLevel}%` : "";
  const queueText = queueCount > 0 ? `Čekají: ${queueCount}` : "";
  const speechText = getSpeechStatusText();

  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (dot) dot.classList.toggle("offline", !isOnline);
  if (text) text.textContent = [onlineText, speechText, batteryText, queueText].filter(Boolean).join("  ·  ");
  updateDiagnostics();
}

// ── Inicializace ──────────────────────────────────────────────────────────────
async function init() {
  // Inicializace Capacitor pluginů
  await initNetwork();
  await initBattery();
  await initSpeech();
  await updateStatus();

  // Pokus o flush fronty při startu (pokud jsme online)
  if (isOnline) {
    flushQueue();
  }

  // Tlačítka
  document.getElementById("btn-record").addEventListener("click", async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  });

  document.getElementById("btn-send").addEventListener("click", sendNote);
  document.getElementById("btn-discard").addEventListener("click", discardNote);

  // Auto-resize textarea při ruční editaci
  document.getElementById("transcript").addEventListener("input", autoResize);
}

document.addEventListener("DOMContentLoaded", init);
