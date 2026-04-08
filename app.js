// ── Konfigurace ───────────────────────────────────────────────────────────────
const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec";

const DB_NAME = "beh-poznamky-db";
const STORE_NAME = "queue";
const SYNC_TAG = "sync-notes";

// ── Stav aplikace ────────────────────────────────────────────────────────────
let recognition = null;
let isRecording = false;
let currentTranscript = "";
let batteryLevel = null;

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

// ── GPS ───────────────────────────────────────────────────────────────────────
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolokace není podporována"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    });
  });
}

// ── Baterie ───────────────────────────────────────────────────────────────────
async function initBattery() {
  if (!navigator.getBattery) return;
  try {
    const battery = await navigator.getBattery();
    batteryLevel = Math.round(battery.level * 100);
    battery.addEventListener("levelchange", () => {
      batteryLevel = Math.round(battery.level * 100);
      updateStatus();
    });
  } catch {
    // Battery API nedostupná — nevadí
  }
}

// ── Speech Recognition ────────────────────────────────────────────────────────
function initSpeech() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    document.getElementById("btn-record").disabled = true;
    showError(
      "Hlasové rozpoznávání není podporováno. Použij Chrome na Androidu."
    );
    setStatusNote("STT: nepodporováno");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "cs-CZ";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onaudiostart = () => {
    // Mikrofon skutečně začal přijímat zvuk — bezpečné zobrazit UI
    setRecordingUI(true);
  };

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }
    if (final) currentTranscript += final;
    document.getElementById("transcript").textContent =
      currentTranscript + interim;
  };

  recognition.onerror = (event) => {
    isRecording = false;
    setRecordingUI(false);
    if (event.error === "network") {
      showError(
        "STT nefunguje offline. Stáhni český offline jazykový balíček:\nNastavení Androidu → Správa obecná → Jazyk a zadávání → Hlasový vstup Google → Stáhnout jazyky → Čeština."
      );
    } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showError(
        "Přístup k mikrofonu byl zamítnut. Otevři Nastavení Chrome → Oprávnění webu → Mikrofon a povol přístup pro tuto stránku."
      );
    } else if (event.error === "no-speech") {
      // Žádný zvuk — tiché zastavení, ne chyba
      stopRecording();
    } else {
      showError(`Chyba rozpoznávání: ${event.error}`);
    }
  };

  recognition.onend = () => {
    // Pokud jsme zastavili ručně (isRecording = false), nic neděláme.
    // Pokud skončilo samo (Chrome timeout ~60s), restartujeme.
    if (isRecording) {
      try {
        recognition.start();
      } catch {
        // recognition již běží nebo byla zrušena — ignorujeme
      }
    }
  };

  setStatusNote("STT připraven");
}

// ── Ovládání nahrávání ────────────────────────────────────────────────────────
async function startRecording() {
  if (!recognition) {
    showError("STT není inicializováno. Použij Chrome na Androidu.");
    return;
  }

  // Explicitní check oprávnění mikrofonu před spuštěním
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: "microphone" });
      if (perm.state === "denied") {
        showError(
          "Přístup k mikrofonu byl trvale zamítnut. Otevři Nastavení Chrome → Oprávnění webu → Mikrofon a povol přístup."
        );
        return;
      }
    } catch {
      // permissions API nedostupné — pokračujeme, recognition.onerror to zachytí
    }
  }

  currentTranscript = "";
  document.getElementById("transcript").textContent = "";
  document.getElementById("section-confirm").classList.add("hidden");
  document.getElementById("section-error").classList.add("hidden");

  // isRecording = true PŘED start() — předchází race condition s onend
  isRecording = true;

  try {
    recognition.start();
    // UI se zobrazí až v onaudiostart (potvrzení že mikrofon skutečně nahrává)
    // Mezitím ukážeme "čekám" stav
    document.getElementById("btn-record").textContent = "…";
  } catch (e) {
    isRecording = false;
    showError("Nelze spustit nahrávání: " + e.message);
  }
}

function stopRecording() {
  if (!recognition) return;
  isRecording = false;
  try {
    recognition.stop();
  } catch {
    // already stopped
  }
  setRecordingUI(false);

  const text = document.getElementById("transcript").textContent.trim();
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
  const note = document.getElementById("transcript").textContent.trim();
  if (!note) return;

  document.getElementById("btn-send").disabled = true;
  document.getElementById("btn-send").textContent = "Odesílám…";

  let lat = null;
  let lon = null;

  try {
    const pos = await getPosition();
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch {
    // GPS nedostupná — odešleme bez souřadnic (backend to přijme, mapa ignoruje)
    showError("GPS nedostupná — poznámka uložena bez polohy.");
  }

  const now = new Date();
  const payload = {
    time: now.toISOString(),
    lat,
    lon,
    note,
    battery: batteryLevel,
  };

  try {
    // Nejdřív ulož do fronty
    await enqueue(payload);

    // Pokud online, zkus Background Sync nebo přímý POST
    if (navigator.onLine) {
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register(SYNC_TAG);
      } else {
        // Fallback: přímý POST
        await directPost(payload);
      }
    }

    showSuccess(navigator.onLine ? "Odesláno!" : "Uloženo offline, odešle se při signálu.");
    document.getElementById("transcript").textContent = "";
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function discardNote() {
  document.getElementById("transcript").textContent = "";
  document.getElementById("section-confirm").classList.add("hidden");
  currentTranscript = "";
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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

// Dočasná poznámka ve status baru (přepíše se při příštím updateStatus)
function setStatusNote(msg) {
  document.getElementById("status-bar").textContent = msg;
}

async function updateStatus() {
  const queueCount = await getQueueCount();
  const onlineText = navigator.onLine ? "Online" : "Offline";
  const batteryText = batteryLevel !== null ? `Baterie: ${batteryLevel}%` : "";
  const queueText = queueCount > 0 ? `Čekají: ${queueCount}` : "";

  document.getElementById("status-bar").textContent =
    [onlineText, batteryText, queueText].filter(Boolean).join("  ·  ");
}

// ── Service Worker zprávy ─────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (event.data?.type === "NOTE_SENT") {
      await updateStatus();
    }
  });
}

// ── Inicializace ──────────────────────────────────────────────────────────────
async function init() {
  // Registrace Service Workeru
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW registrace selhala:", e);
    }
  }

  await initBattery();
  initSpeech();
  await updateStatus();

  // Online/offline události
  window.addEventListener("online", async () => {
    await updateStatus();
    // Zkus odeslat frontu při obnovení spojení
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(SYNC_TAG);
    }
  });
  window.addEventListener("offline", updateStatus);

  // Tlačítka
  document.getElementById("btn-record").addEventListener("click", async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  document.getElementById("btn-send").addEventListener("click", sendNote);
  document.getElementById("btn-discard").addEventListener("click", discardNote);
}

document.addEventListener("DOMContentLoaded", init);
