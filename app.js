// ── Konfigurace ───────────────────────────────────────────────────────────────
const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec";

const DB_NAME = "beh-poznamky-db";
const STORE_NAME = "queue";
const SYNC_TAG = "sync-notes";
const SPEECH_LANG = "cs-CZ";

// ── Stav aplikace ────────────────────────────────────────────────────────────
let recognition = null;
let isRecording = false;
let currentTranscript = "";
let batteryLevel = null;
let speechRecognitionCtor = null;
let speechMode = "unavailable";
let onDeviceAvailability = "unknown";

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
async function initSpeech() {
  speechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!speechRecognitionCtor) {
    document.getElementById("btn-record").disabled = true;
    showError(
      "Hlasové rozpoznávání není podporováno. Použij Chrome na Androidu."
    );
    speechMode = "unavailable";
    return;
  }

  recognition = new speechRecognitionCtor();
  recognition.lang = SPEECH_LANG;
  recognition.continuous = false;   // jednorázový režim — žádné duplicity
  recognition.interimResults = true;
  recognition.processLocally = false;

  recognition.onaudiostart = () => {
    setRecordingUI(true);
  };

  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = 0; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += t;
      } else {
        interim += t;
      }
    }
    // Zobraz pouze výsledky aktuální session — bez akumulace přes restarty
    document.getElementById("transcript").textContent =
      currentTranscript + (final || interim);
    if (final) currentTranscript += final;
  };

  recognition.onerror = (event) => {
    isRecording = false;
    setRecordingUI(false);
    if (event.error === "language-not-supported") {
      speechMode = navigator.onLine ? "cloud" : "local-missing";
      showError(
        "Offline čeština není v zařízení dostupná. Připoj telefon k internetu, klepni znovu na Mluvit a aplikace se pokusí jazykový balíček stáhnout."
      );
    } else if (event.error === "network") {
      showError(
        "STT v síťovém režimu selhalo. Pokud má zařízení podporu offline češtiny, připoj telefon jednou k internetu a zkus znovu stáhnout jazykový balíček."
      );
    } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showError(
        "Přístup k mikrofonu byl zamítnut. Otevři Nastavení Chrome → Oprávnění webu → Mikrofon a povol přístup pro tuto stránku."
      );
    } else if (event.error === "no-speech") {
      stopRecording();
    } else {
      showError(`Chyba rozpoznávání: ${event.error}`);
    }
  };

  recognition.onend = () => {
    // continuous=false: session skončila přirozeně (pauza v řeči)
    // Zastavíme nahrávání a zobrazíme výsledek
    if (isRecording) {
      stopRecording();
    }
  };
  await probeOnDeviceSpeech();
  await updateStatus();
}

async function probeOnDeviceSpeech() {
  onDeviceAvailability = "unknown";

  if (!recognition || !speechRecognitionCtor) {
    speechMode = "unavailable";
    return;
  }

  const supportsOnDevice =
    "processLocally" in recognition &&
    typeof speechRecognitionCtor.available === "function" &&
    typeof speechRecognitionCtor.install === "function";

  if (!supportsOnDevice) {
    speechMode = navigator.onLine ? "cloud" : "cloud-offline-blocked";
    return;
  }

  try {
    onDeviceAvailability = await speechRecognitionCtor.available({
      langs: [SPEECH_LANG],
      processLocally: true,
    });
  } catch {
    speechMode = navigator.onLine ? "cloud" : "cloud-offline-blocked";
    return;
  }

  if (onDeviceAvailability === "available") {
    speechMode = "local-ready";
  } else if (
    onDeviceAvailability === "downloadable" ||
    onDeviceAvailability === "downloading"
  ) {
    speechMode = navigator.onLine ? "local-installable" : "local-pending-download";
  } else {
    speechMode = navigator.onLine ? "cloud" : "cloud-offline-blocked";
  }
}

async function ensureSpeechReady() {
  await probeOnDeviceSpeech();

  if (!recognition) {
    return false;
  }

  if (onDeviceAvailability === "available") {
    recognition.processLocally = true;
    speechMode = "local-ready";
    return true;
  }

  if (
    (onDeviceAvailability === "downloadable" ||
      onDeviceAvailability === "downloading") &&
    navigator.onLine &&
    typeof speechRecognitionCtor.install === "function"
  ) {
    document.getElementById("btn-record").disabled = true;
    document.getElementById("btn-record").textContent = "STAHUJI…";
    showError("Stahuji češtinu pro offline diktování. Chvilku strpení…");

    try {
      const installed = await speechRecognitionCtor.install({
        langs: [SPEECH_LANG],
      });

      await probeOnDeviceSpeech();

      if (installed && onDeviceAvailability === "available") {
        recognition.processLocally = true;
        speechMode = "local-ready";
        document.getElementById("section-error").classList.add("hidden");
        return true;
      }

      showError(
        "Čeština pro offline diktování se nepodařila nainstalovat. Zkus to znovu online, případně ověř podporu v aktuální verzi Chrome."
      );
      return false;
    } catch (e) {
      showError("Stažení offline češtiny selhalo: " + e.message);
      return false;
    } finally {
      document.getElementById("btn-record").disabled = false;
      setRecordingUI(false);
      await updateStatus();
    }
  }

  recognition.processLocally = false;
  if (!navigator.onLine) {
    speechMode = "cloud-offline-blocked";
    showError(
      "Offline diktování není na tomto zařízení zatím připravené. Připoj telefon k internetu a spusť diktování jednou online, aby šlo případně stáhnout češtinu pro lokální rozpoznávání."
    );
    return false;
  }

  speechMode = "cloud";
  return true;
}

function getSpeechStatusText() {
  switch (speechMode) {
    case "local-ready":
      return "STT: offline";
    case "local-installable":
      return "STT: offline ke stažení";
    case "local-pending-download":
      return "STT: offline čeká na internet";
    case "cloud":
      return "STT: online";
    case "cloud-offline-blocked":
      return "STT: offline nedostupné";
    case "local-missing":
      return "STT: chybí čeština";
    case "unavailable":
      return "STT: nepodporováno";
    default:
      return "STT: zjišťuji";
  }
}

function getOnDeviceSupportText() {
  if (!recognition || !speechRecognitionCtor) return "ne";

  const supportsOnDevice =
    "processLocally" in recognition &&
    typeof speechRecognitionCtor.available === "function" &&
    typeof speechRecognitionCtor.install === "function";

  return supportsOnDevice ? "ano" : "ne";
}

function getAvailabilityText() {
  switch (onDeviceAvailability) {
    case "available":
      return "nainstalováno";
    case "downloadable":
      return "lze stáhnout";
    case "downloading":
      return "stahuje se";
    case "unavailable":
      return "není dostupná";
    case "unknown":
    default:
      return "neznámé";
  }
}

function getModeDetailText() {
  switch (speechMode) {
    case "local-ready":
      return "lokální rozpoznávání v zařízení";
    case "local-installable":
      return "offline balíček je dostupný ke stažení";
    case "local-pending-download":
      return "offline balíček čeká na internet";
    case "cloud":
      return "síťové rozpoznávání přes browser";
    case "cloud-offline-blocked":
      return "jen cloud, offline teď nepůjde";
    case "local-missing":
      return "on-device režim selhal kvůli chybějící češtině";
    case "unavailable":
      return "browser STT nepodporuje";
    default:
      return "zjišťuji";
  }
}

function getDiagnosticHint() {
  switch (speechMode) {
    case "local-ready":
      return "Můžeš přepnout telefon offline a diktovat dál.";
    case "local-installable":
      return "Klepni na Mluvit online; aplikace zkusí stáhnout češtinu.";
    case "local-pending-download":
      return "Připoj telefon k internetu a spusť diktování jednou online.";
    case "cloud":
      return "Diktování funguje, ale bez internetu nepoběží.";
    case "cloud-offline-blocked":
      return "Na tomto zařízení zatím není připravené offline STT.";
    case "local-missing":
      return "Zkus znovu online, aby šlo stáhnout český jazykový balíček.";
    case "unavailable":
      return "Použij novější Chrome na Androidu.";
    default:
      return "Probíhá detekce schopností zařízení.";
  }
}

function updateDiagnostics() {
  const apiEl = document.getElementById("diag-api");
  const onDeviceEl = document.getElementById("diag-ondevice");
  const langEl = document.getElementById("diag-lang");
  const modeEl = document.getElementById("diag-mode");
  const hintEl = document.getElementById("diag-hint");

  if (!apiEl || !onDeviceEl || !langEl || !modeEl || !hintEl) {
    return;
  }

  apiEl.textContent = speechRecognitionCtor ? "podporováno" : "nepodporováno";
  onDeviceEl.textContent = getOnDeviceSupportText();
  langEl.textContent = getAvailabilityText();
  modeEl.textContent = getModeDetailText();
  hintEl.textContent = getDiagnosticHint();
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

  const speechReady = await ensureSpeechReady();
  if (!speechReady) {
    await updateStatus();
    return;
  }

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
    // Vždy ulož do fronty jako záloha
    const id = await enqueue(payload);

    if (navigator.onLine) {
      try {
        // Online: odeslat přímo hned
        await directPost(payload);
        // Úspěch: smaž z fronty (už není potřeba)
        await deleteFromQueue(id);
        showSuccess("Odesláno!");
      } catch (postError) {
        // POST selhal i při online (timeout, chyba serveru…)
        // Nech v frontě, BackgroundSync to zkusí znovu
        scheduleBackgroundSync();
        showSuccess("Odeslání selhalo, zkusí se znovu automaticky.");
      }
    } else {
      // Offline: BackgroundSync odešle až bude signál
      scheduleBackgroundSync();
      showSuccess("Offline — odešle se automaticky při signálu.");
    }

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
    body: JSON.stringify(payload),
    // bez Content-Type → "text/plain" → simple request → žádný CORS preflight
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

function discardNote() {
  document.getElementById("transcript").textContent = "";
  document.getElementById("section-confirm").classList.add("hidden");
  currentTranscript = "";
}

async function scheduleBackgroundSync() {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(SYNC_TAG);
    } catch {
      // BackgroundSync nedostupný — nevadí, fronta čeká na příští online event
    }
  }
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

async function updateStatus() {
  const queueCount = await getQueueCount();
  const onlineText = navigator.onLine ? "Online" : "Offline";
  const batteryText = batteryLevel !== null ? `Baterie: ${batteryLevel}%` : "";
  const queueText = queueCount > 0 ? `Čekají: ${queueCount}` : "";
  const speechText = getSpeechStatusText();

  document.getElementById("status-bar").textContent =
    [onlineText, speechText, batteryText, queueText].filter(Boolean).join("  ·  ");
  updateDiagnostics();
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
  await initSpeech();
  await updateStatus();

  // Online/offline události
  window.addEventListener("online", async () => {
    await probeOnDeviceSpeech();
    await updateStatus();
    scheduleBackgroundSync();
  });
  window.addEventListener("offline", async () => {
    await probeOnDeviceSpeech();
    await updateStatus();
  });

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
