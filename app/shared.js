// ── Konfigurace ───────────────────────────────────────────────────────────────
const SHEET_URL = PROJECT_CONFIG.sheetUrl;
const WRITE_TOKEN = PROJECT_CONFIG.writeToken;
const READ_TOKEN = PROJECT_CONFIG.readToken;

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
    const plugins = Capacitor.Plugins;
    if (plugins[name]) {
      return plugins[name];
    }
    if (name === "BackgroundRunner") {
      return plugins.CapacitorBackgroundRunner || null;
    }
    if (name === "CapacitorBackgroundRunner") {
      return plugins.BackgroundRunner || null;
    }
  }
  return null;
}

// ── Stav aplikace ─────────────────────────────────────────────────────────────
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
let lastGpsAccuracy = null;
let lastGpsCoords = null;
let gpsWatchId = null;
let photoCameraFacing = "rear";

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
  if (wakeLock) return;
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
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "stop") {
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
