// ── Konfigurace ───────────────────────────────────────────────────────────────
const APP_CONFIG = (typeof window !== "undefined" && window.RUN_NOTES_CONFIG) || {};
const SHEET_URL =
  APP_CONFIG.sheetUrl ||
  "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec";
const WRITE_TOKEN = APP_CONFIG.writeToken || APP_CONFIG.apiToken || "";
const READ_TOKEN = APP_CONFIG.readToken || APP_CONFIG.mapToken || "";

const DB_NAME = "beh-poznamky-db";
const STORE_NAME = "queue";
const MAX_AUDIO_DURATION_MS = 30000;
const MAX_AUDIO_SIZE_BYTES = 5 * 1024 * 1024;
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

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
let userStoppedRecording = false;
let pendingAudioNote = null;
let pendingPhoto = null;
let pendingAudioObjectUrl = "";
let audioStopTimer = null;
let audioDurationInterval = null;
let audioRecordingStartedAt = 0;

let currentTranscript = "";
let googleSttAvailable = false;
let voskReady = false;
let voskLoading = false;
let activeEngine = null;
let activeCaptureMode = null;
let isOnline = true;
let batteryLevel = null;
let isFlushing = false;
let mediaStream = null;
let mediaRecorder = null;
let mediaChunks = [];
let mediaMimeType = null;
let wakeLock = null;
let lastGpsAccuracy = null;   // přesnost posledního GPS fixu v metrech
let lastGpsCoords = null;     // cache posledního GPS fixu { lat, lon, speed, altitude, ts }
let gpsWatchId = null;        // ID watcheru pro zastavení

// ── Haptická odezva ───────────────────────────────────────────────────────────
async function vibrate(type = "light") {
  const Haptics = getCapacitorPlugin("Haptics");
  if (!Haptics) return;
  try {
    if (type === "success") await Haptics.notification({ type: "SUCCESS" });
    else if (type === "error") await Haptics.notification({ type: "ERROR" });
    else if (type === "medium") await Haptics.impact({ style: "MEDIUM" });
    else await Haptics.impact({ style: "LIGHT" });
  } catch {}
}

// ── Wake Lock (udržení rozsvíceného displeje) ─────────────────────────────────
async function keepScreenOn() {
  if (!("wakeLock" in navigator)) return;
  if (wakeLock) return; // již aktivní
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
    console.log("Wake lock aktivován");
  } catch (e) {
    console.warn("Wake lock nelze aktivovat:", e.message);
  }
}

async function allowScreenOff() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
    wakeLock = null;
    console.log("Wake lock uvolněn");
  } catch {}
}

// ── Zvuková signalizace (Pípnutí) ─────────────────────────────────────────────
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function beep(type = "start") {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "start") {
      // Jedno krátké vysoké pípnutí (800 Hz, 120 ms)
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "stop") {
      // Sestupný tón (600 Hz → 400 Hz, 240 ms)
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.setValueAtTime(400, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.24);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.24);
    }
  } catch {}
}

function normalizeTranscriptWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeOfflineTranscript(text) {
  return String(text || "")
    .replace(/\s*\[unk\]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uppercaseFirstLetter(text) {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    if (/\p{L}/u.test(chars[i])) {
      chars[i] = chars[i].toLocaleUpperCase("cs-CZ");
      break;
    }
  }
  return chars.join("");
}

function formatFinalSegment(text, options = {}) {
  let formatted = options.filterUnknownTokens
    ? sanitizeOfflineTranscript(text)
    : normalizeTranscriptWhitespace(text);
  if (!formatted) return "";

  formatted = uppercaseFirstLetter(formatted);

  // Pokud Google STT už vrátí interpunkci, zachováme ji.
  if (!/[.!?:…]$/.test(formatted)) {
    formatted += ".";
  }

  return formatted;
}

function formatPartialSegment(text, options = {}) {
  let formatted = options.filterUnknownTokens
    ? sanitizeOfflineTranscript(text)
    : normalizeTranscriptWhitespace(text);
  if (!formatted) return "";

  if (!currentTranscript || /[.!?…]\s*$/.test(currentTranscript)) {
    formatted = uppercaseFirstLetter(formatted);
  }

  return formatted;
}

function renderTranscriptWithPartial(partialText = "", options = {}) {
  const partial = formatPartialSegment(partialText, options);
  document.getElementById("transcript").value =
    currentTranscript + (currentTranscript && partial ? " " : "") + partial;
  autoResize();
}

function appendFinalTranscriptSegment(text, options = {}) {
  const formatted = formatFinalSegment(text, options);
  if (!formatted) return;

  currentTranscript += (currentTranscript ? " " : "") + formatted;
  document.getElementById("transcript").value = currentTranscript;
  autoResize();
}

function supportsMediaRecording() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

async function ensureMicrophonePermission() {
  const GoogleSTT = getCapacitorPlugin("GoogleSTT");
  if (!GoogleSTT) return true;

  try {
    if (typeof GoogleSTT.checkMicrophonePermission === "function") {
      const status = await GoogleSTT.checkMicrophonePermission();
      if (status && status.granted) {
        return true;
      }
    }

    if (typeof GoogleSTT.requestMicrophonePermission === "function") {
      const result = await GoogleSTT.requestMicrophonePermission();
      return Boolean(result && result.granted);
    }
  } catch (error) {
    console.warn("Vyžádání mikrofonu přes plugin selhalo:", error);
  }

  return true;
}

function pickSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  for (const mimeType of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "";
}

function formatAudioDuration(durationSec) {
  const totalSeconds = Math.max(1, Math.round(Number(durationSec) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes}:${String(seconds).padStart(2, "0")} min`;
}

function getAudioFileExtension(mimeType) {
  if (String(mimeType || "").includes("mp4")) return "m4a";
  if (String(mimeType || "").includes("ogg")) return "ogg";
  return "webm";
}

function clearPendingAudioPreview() {
  if (pendingAudioObjectUrl) {
    URL.revokeObjectURL(pendingAudioObjectUrl);
    pendingAudioObjectUrl = null;
  }
  pendingAudioNote = null;

  const preview = document.getElementById("audio-preview");
  const player = document.getElementById("audio-player");
  const meta = document.getElementById("audio-preview-meta");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  if (meta) {
    meta.textContent = "čekám na nahrávku…";
  }
  if (preview) {
    preview.classList.add("hidden");
  }
}

function clearPendingPhotoPreview() {
  pendingPhoto = null;
  const container = document.getElementById("photo-preview");
  const img = document.getElementById("photo-preview-img");
  if (container && img) {
    img.src = "";
    container.classList.add("hidden");
  }
}

function showAudioPreview(audioNote) {
  const preview = document.getElementById("audio-preview");
  const player = document.getElementById("audio-player");
  const meta = document.getElementById("audio-preview-meta");
  if (!preview || !player || !meta) return;

  clearPendingAudioPreview();
  pendingAudioNote = audioNote;
  pendingAudioObjectUrl = URL.createObjectURL(audioNote.blob);

  player.src = pendingAudioObjectUrl;
  player.load();
  meta.textContent = `Délka: ${formatAudioDuration(audioNote.durationSec)}`;
  preview.classList.remove("hidden");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function serializePayloadForPost(payload) {
  if (!payload || payload.entry_type !== "audio" || !payload.audioBlob) {
    return payload;
  }

  return {
    ...payload,
    audio_base64: await blobToBase64(payload.audioBlob),
    audio_mime: payload.audioMime || payload.audioBlob.type || "audio/webm",
    audio_duration_sec: payload.audioDurationSec ?? null,
    audio_filename: payload.audioFileName || "",
    audioBlob: undefined,
    audioMime: undefined,
    audioDurationSec: undefined,
    audioFileName: undefined,
  };
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────
// DB verze 2: přidán store "config" pro sdílení konfigurace se Service Workerem.
const DB_VERSION = 2;
const CONFIG_STORE = "config";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      // Verze 2: store pro sdílenou konfiguraci (token, url) se Service Workerem
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// Uloží konfigurační hodnotu do IDB config store (přístupná ze Service Workeru).
async function saveConfig(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readwrite");
    tx.objectStore(CONFIG_STORE).put({ key, value });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
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

// Spustí kontinuální sledování GPS pro cache přesnosti a urychlení odesílání.
// Používá nízkou frekvenci (minimumUpdateInterval) pro šetření baterie.
async function startGpsWatch() {
  const Geolocation = getCapacitorPlugin("Geolocation");
  if (!Geolocation || gpsWatchId !== null) return;
  try {
    gpsWatchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 15000,
        // minimumUpdateInterval je Android-specific Capacitor rozšíření (ms).
        // Velká hodnota = méně probuzení GPS chipu = šetří baterii.
        minimumUpdateInterval: 10000,
      },
      (pos, err) => {
        if (err || !pos) return;
        const c = pos.coords;
        lastGpsAccuracy = c.accuracy != null ? Math.round(c.accuracy) : null;
        lastGpsCoords = {
          lat: c.latitude,
          lon: c.longitude,
          speed: (c.speed !== null && c.speed >= 0) ? Math.round(c.speed * 3.6 * 10) / 10 : null,
          altitude: c.altitude !== null ? Math.round(c.altitude) : null,
          ts: Date.now(),
        };
        updateStatus();
      }
    );
  } catch (e) {
    console.warn("GPS watch nelze spustit:", e);
  }
}

async function stopGpsWatch() {
  const Geolocation = getCapacitorPlugin("Geolocation");
  if (!Geolocation || gpsWatchId === null) return;
  try {
    await Geolocation.clearWatch({ id: gpsWatchId });
  } catch (_) {}
  gpsWatchId = null;
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
        await directPost(record.payload, record.url);
        await deleteFromQueue(record.id);
        console.log(`Odesláno z fronty: ${record.id}`);
      } catch (error) {
        if (error && (error.code === "UNAUTHORIZED" || error.code === "CONFIG")) {
          console.log("Flush queue: neplatná autorizace, frontu ponechávám beze změny");
          break;
        }
        // Síť stále nedostupná — přestat, zkusíme znovu příště
        console.log("Flush queue: síť nedostupná, zkusíme později", error);
        break;
      }
    }

    await updateStatus();
  } finally {
    isFlushing = false;
  }
}

// ── Service Worker & Background Sync ─────────────────────────────────────────

// Registruje Service Worker (jednou při startu).
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    console.log("Service Worker zaregistrován.");
  } catch (e) {
    console.warn("Service Worker registrace selhala:", e);
  }
}

// Uloží WRITE_TOKEN a SHEET_URL do IDB config store, aby je mohl číst SW.
async function saveConfigForSW() {
  try {
    await Promise.all([
      saveConfig("WRITE_TOKEN", WRITE_TOKEN),
      saveConfig("SHEET_URL", SHEET_URL),
    ]);
  } catch (e) {
    console.warn("Nepodařilo se uložit konfiguraci pro SW:", e);
  }
}

// Zaregistruje Background Sync tag — OS spustí SW jakmile bude síť dostupná.
// Pokud Background Sync API není podporováno, tiše selže (pojistka je visibilitychange).
async function swSyncRegister() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.sync) {
      await reg.sync.register("flush-queue");
      console.log("Background sync tag zaregistrován.");
    }
  } catch (e) {
    console.warn("Background sync registrace selhala (není kritická):", e);
  }
}

// ── Queue UI (správa čekající fronty) ─────────────────────────────────────────
function formatQueueItemLabel(record) {
  const type = record.payload && record.payload.entry_type;
  if (type === "audio") {
    const dur = record.payload.audioDurationSec || record.payload.audio_duration_sec;
    const durText = dur ? ` · ${formatAudioDuration(dur)}` : "";
    return { icon: "🎙", label: "Hlasová poznámka" + durText };
  }
  if (type === "photo") {
    return { icon: "📷", label: "Fotografie" };
  }
  // text (default)
  const note = String(record.payload && record.payload.note || "").trim();
  const preview = note.length > 40 ? note.slice(0, 40) + "…" : (note || "Textová poznámka");
  return { icon: "📝", label: preview };
}

function formatQueueItemDate(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleString("cs-CZ", {
      day: "numeric", month: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

async function openQueuePanel() {
  const records = await getAllFromQueue();

  const list = document.getElementById("queue-list");
  const empty = document.getElementById("queue-empty");
  list.innerHTML = "";

  if (records.length === 0) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    records.forEach((record) => {
      const { icon, label } = formatQueueItemLabel(record);
      const dateText = formatQueueItemDate(record.createdAt);

      const li = document.createElement("li");
      li.className = "queue-item";
      li.innerHTML = `
        <span class="queue-item-icon">${icon}</span>
        <div class="queue-item-body">
          <div class="queue-item-label">${label}</div>
          <div class="queue-item-meta">${dateText}</div>
        </div>
        <button class="queue-item-delete" data-id="${record.id}">Smazat</button>
      `;
      list.appendChild(li);
    });

    list.querySelectorAll(".queue-item-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        vibrate("light");
        await deleteFromQueue(btn.dataset.id);
        await updateStatus();
        await openQueuePanel();
      });
    });
  }

  document.getElementById("queue-overlay").classList.remove("hidden");
  document.getElementById("queue-panel").classList.remove("hidden");
}

function closeQueuePanel() {
  document.getElementById("queue-overlay").classList.add("hidden");
  document.getElementById("queue-panel").classList.add("hidden");
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
      appendFinalTranscriptSegment(event.text || "");
    } else {
      renderTranscriptWithPartial(event.text || "");
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

  // Naslouchej výsledkům rozpoznávání
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
      activeCaptureMode = null;
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
  } catch {
    // already stopped
  }

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
    // Pokud nic nebylo nadiktováno a není nahráno audio, rovnou schováme
    transcript.classList.add("hidden");
  }
}

function setRecordingUI(active) {
  const btn = document.getElementById("btn-record");
  const audioBtn = document.getElementById("btn-audio");
  const photoBtn = document.getElementById("btn-photo");
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
    indicator.classList.remove("hidden");
    label.textContent = "Nahrávám diktování";
  } else if (active && activeCaptureMode === "audio") {
    btn.textContent = "TEXT";
    btn.classList.remove("recording");
    btn.disabled = true;
    audioBtn.textContent = "STOP";
    audioBtn.classList.add("recording");
    audioBtn.disabled = false;
    photoBtn.disabled = true;
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
    indicator.classList.add("hidden");
    label.textContent = "Nahrávám";
  }
}

function stopAudioStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function clearAudioRecordingTimer() {
  if (audioStopTimer) {
    clearTimeout(audioStopTimer);
    audioStopTimer = null;
  }
  if (audioDurationInterval) {
    clearInterval(audioDurationInterval);
    audioDurationInterval = null;
  }
}

async function finalizeAudioRecording() {
  clearAudioRecordingTimer();

  const blob = new Blob(mediaChunks, { type: mediaMimeType || "audio/webm" });
  mediaChunks = [];
  stopAudioStream();
  mediaRecorder = null;

  if (!blob.size) {
    pendingAudioNote = null;
    showError("Hlasová poznámka je prázdná. Zkus nahrávání znovu.");
    finishRecording();
    return;
  }

  if (blob.size > MAX_AUDIO_SIZE_BYTES) {
    pendingAudioNote = null;
    showError("Hlasová poznámka je příliš velká. Zkus kratší záznam.");
    finishRecording();
    return;
  }

  const durationSec = Math.max(
    1,
    Math.round((Date.now() - audioRecordingStartedAt) / 1000),
  );

  showAudioPreview({
    blob,
    durationSec,
    mimeType: blob.type || mediaMimeType || "audio/webm",
    fileName: `hlasova-poznamka-${Date.now()}.${getAudioFileExtension(blob.type || mediaMimeType)}`,
  });
  showSuccess("Hlasová poznámka připravena k odeslání.");
  finishRecording();
}

async function startAudioRecording() {
  if (!supportsMediaRecording()) {
    showError("Nahrávání zvuku není v tomto zařízení podporováno.");
    return;
  }

  discardNote({ keepMessages: true });
  document.getElementById("transcript").readOnly = true;
  document.getElementById("transcript").classList.add("hidden");
  document.getElementById("section-error").classList.add("hidden");

  try {
    const permissionGranted = await ensureMicrophonePermission();
    if (!permissionGranted) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
      document.getElementById("transcript").readOnly = false;
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaMimeType = pickSupportedAudioMimeType();
    mediaChunks = [];
    audioRecordingStartedAt = Date.now();

    mediaRecorder = mediaMimeType
      ? new MediaRecorder(mediaStream, { mimeType: mediaMimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        mediaChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      finalizeAudioRecording().catch((error) => {
        console.error("Finalizace audio záznamu selhala:", error);
        showError("Nepodařilo se dokončit hlasovou poznámku.");
        finishRecording();
      });
    }, { once: true });

    isRecording = true;
    activeCaptureMode = "audio";
    userStoppedRecording = false;
    setRecordingUI(true);
    vibrate("medium");
    keepScreenOn();
    beep("start");

    mediaRecorder.start();
    audioDurationInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - audioRecordingStartedAt) / 1000);
      const label = document.getElementById("recording-label");
      if (label) {
        label.textContent = `Nahrávám hlasovou poznámku (${formatAudioDuration(elapsedSec)})`;
      }
    }, 1000);

    audioStopTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, MAX_AUDIO_DURATION_MS);
  } catch (error) {
    stopAudioStream();
    mediaRecorder = null;
    mediaChunks = [];
    activeCaptureMode = null;
    isRecording = false;
    setRecordingUI(false);
    allowScreenOff();
    if (error && /permission/i.test(error.message || "")) {
      showError("Přístup k mikrofonu byl zamítnut. Povol oprávnění v nastavení aplikace.");
    } else {
      showError("Nelze spustit nahrávání zvuku: " + (error.message || error));
    }
  }
}

async function stopAudioRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    finishRecording();
    return;
  }

  isRecording = false;
  userStoppedRecording = true;
  clearAudioRecordingTimer();
  beep("stop");
  mediaRecorder.stop();
}

// ── Odeslání poznámky ─────────────────────────────────────────────────────────
async function buildBasePayload() {
  // Aktualizovat baterii
  await refreshBattery();

  let lat = null;
  let lon = null;
  let speed = null;
  let altitude = null;

  // Použij cached GPS fix z watchPosition (max 30 s starý) — vyhne se čekání na GPS.
  // Pokud cache chybí nebo je moc stará, padneme zpět na přímé getCurrentPosition().
  const CACHE_MAX_AGE_MS = 30000;
  const cacheAge = lastGpsCoords ? (Date.now() - lastGpsCoords.ts) : Infinity;

  if (lastGpsCoords && cacheAge <= CACHE_MAX_AGE_MS) {
    lat = lastGpsCoords.lat;
    lon = lastGpsCoords.lon;
    speed = lastGpsCoords.speed;
    altitude = lastGpsCoords.altitude;
  } else {
    // Fallback: přímý dotaz (pomalejší, ale bezpečný)
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
    time: new Date().toISOString(),
    lat,
    lon,
    battery: batteryLevel,
    speed,
    altitude,
  };
}

async function sendNote() {
  if (!WRITE_TOKEN) {
    showError("Chybí write token v runtime-config.js.");
    return;
  }

  const note = document.getElementById("transcript").value.trim();
  const hasTextNote = Boolean(note);
  const hasAudioNote = Boolean(pendingAudioNote);
  const hasPhotoNote = Boolean(pendingPhoto);
  if (!hasTextNote && !hasAudioNote && !hasPhotoNote) return;

  document.getElementById("btn-send").disabled = true;
  document.getElementById("btn-send").textContent = "Odesílám…";

  try {
    const basePayload = await buildBasePayload();
    let payload;
    
    if (hasPhotoNote) {
      payload = {
        ...basePayload,
        entry_type: "photo",
        note: "",
        photo_base64: pendingPhoto.base64,
        photo_mime: pendingPhoto.mimeType,
      };
    } else if (hasAudioNote) {
      payload = {
        ...basePayload,
        entry_type: "audio",
        note: "",
        audioBlob: pendingAudioNote.blob,
        audioMime: pendingAudioNote.mimeType,
        audioDurationSec: pendingAudioNote.durationSec,
        audioFileName: pendingAudioNote.fileName,
      };
    } else {
      payload = {
        ...basePayload,
        entry_type: "text",
        note,
      };
    }

    if (isOnline) {
      // Online: pošli přímo, při selhání ulož do fronty
      try {
        await directPost(payload);
        if (hasPhotoNote) {
          showSuccess("Fotka odeslána!");
        } else {
          showSuccess(hasAudioNote ? "Hlasová poznámka odeslána!" : "Odesláno!");
        }
      } catch (postError) {
        if (postError && (postError.code === "UNAUTHORIZED" || postError.code === "CONFIG")) {
          throw postError;
        }
        console.log("Přímé odeslání selhalo, ukládám do fronty:", postError);
        // Serializovat Blob → base64 před uložením (SW/background nemá přístup k Blob)
        const serialized = await serializePayloadForPost(payload);
        await enqueue(serialized);
        await swSyncRegister();
        showSuccess(hasAudioNote
          ? "Audio se teď nepodařilo odeslat, zkusí se znovu automaticky."
          : "Odeslání selhalo, zkusí se znovu automaticky.");
      }
    } else {
      // Offline: serializovat Blob → base64 před uložením do fronty
      const serialized = await serializePayloadForPost(payload);
      await enqueue(serialized);
      await swSyncRegister();
      showSuccess(hasAudioNote
        ? "Offline — hlasová poznámka se odešle automaticky při signálu."
        : "Offline — odešle se automaticky při signálu.");
    }

    discardNote({ keepMessages: true });
    await updateStatus();
  } catch (e) {
    showError("Chyba při ukládání: " + e.message);
  } finally {
    document.getElementById("btn-send").disabled = false;
    document.getElementById("btn-send").textContent = "Odeslat";
  }
}

async function directPost(payload, url = SHEET_URL) {
  if (!WRITE_TOKEN) {
    const error = new Error("Chybí write token v runtime-config.js.");
    error.code = "CONFIG";
    throw error;
  }

  const postBody = await serializePayloadForPost(payload);
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      ...postBody,
      token: WRITE_TOKEN,
    }),
    // bez Content-Type → "text/plain" → simple request → žádný CORS preflight
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("HTTP chyba při odesílání na server:", res.status, text);
    throw new Error(`HTTP ${res.status}`);
  }

  if (!text) return;

  try {
    const data = JSON.parse(text);
    if (data && data.ok === false) {
      const error = new Error(data.error || "Neautorizovaný požadavek.");
      error.code = data.error === "unauthorized" ? "UNAUTHORIZED" : "API";
      throw error;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      return;
    }
    throw e;
  }
}

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

    // Sestavit GPS badge HTML
    let gpsBadgeHtml = "";
    if (lastGpsAccuracy !== null) {
      let gpsClass = "gps-badge-bad";
      if (lastGpsAccuracy <= 10) gpsClass = "gps-badge-good";
      else if (lastGpsAccuracy <= 30) gpsClass = "gps-badge-ok";
      gpsBadgeHtml = `  ·  <span id="gps-badge" class="${gpsClass}">GPS: ~${lastGpsAccuracy} m</span>`;
    }

    // Sestavit queue badge HTML
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

// ── Foto záznam ──────────────────────────────────────────────────────────────
async function takePhoto() {
  const Camera = getCapacitorPlugin("Camera");
  if (!Camera) {
    return showError("Fotoaparát není dostupný.");
  }

  try {
    const image = await Camera.getPhoto({
      quality: 60,
      allowEditing: false,
      resultType: "base64",
      saveToGallery: true,
      width: 1200,
      source: "CAMERA"
    });

    discardNote({ keepMessages: true });

    pendingPhoto = {
      base64: image.base64String,
      mimeType: `image/${image.format || 'jpeg'}`
    };
    vibrate("medium");

    // Zobrazení náhledu
    const container = document.getElementById("photo-preview");
    const img = document.getElementById("photo-preview-img");
    img.src = `data:${pendingPhoto.mimeType};base64,${pendingPhoto.base64}`;
    container.classList.remove("hidden");

    // Skrýt textový přepis a audio
    document.getElementById("transcript").classList.add("hidden");
    document.getElementById("audio-preview").classList.add("hidden");

    // Zobrazit potvrzovací tlačítka
    document.getElementById("section-confirm").classList.remove("hidden");

  } catch (error) {
    if (error.message && error.message.includes("User cancelled")) {
      // Uživatel jen zavřel foťák
      return;
    }
    console.error("Chyba při focení:", error);
    showError("Nepodařilo se pořídit fotku.");
  }
}

// ── Inicializace ──────────────────────────────────────────────────────────────
async function init() {
  // Inicializace Capacitor pluginů
  await initNetwork();
  await initBattery();

  // Zaregistrování tlačítek ihned, aby UI reagovalo i během načítání STT
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

  // Auto-resize textarea při ruční editaci
  document.getElementById("transcript").addEventListener("input", autoResize);

  // Queue panel — zavření
  document.getElementById("queue-panel-close").addEventListener("click", () => {
    vibrate("light");
    closeQueuePanel();
  });
  document.getElementById("queue-overlay").addEventListener("click", closeQueuePanel);

  configureMapLinks();

  // Inicializujeme STT neblokujícím způsobem, aby uživatel nečekal
  initSpeech().then(() => {
    updateStatus();
    if (!isRecording) setRecordingUI(false);
  });
  
  await updateStatus();

  // Pokus o flush fronty při startu (pokud jsme online)
  if (isOnline) {
    flushQueue();
  }

  // Spustit GPS watcher pro průběžnou aktualizaci přesnosti a cache polohy
  startGpsWatch();

  // Service Worker + Background Sync: registrace a uložení tokenu do IDB
  registerServiceWorker();
  saveConfigForSW();

  // Pojistka: uvolni wake lock při zavření/přepnutí aplikace
  window.addEventListener("beforeunload", () => { allowScreenOff(); stopGpsWatch(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      allowScreenOff();
    } else if (document.visibilityState === "visible" && isOnline) {
      // Pojistka pro případ, že SW nestačil odeslat frontu na pozadí
      flushQueue();
    }
    // GPS watch necháme běžet i na pozadí — OS ho může omezit sám
  });
}

document.addEventListener("DOMContentLoaded", init);
