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
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

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

// ── Offline fronta — flush (nahrazuje Service Worker Background Sync) ────────
async function flushQueue() {
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
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    console.log("Service Worker zaregistrován.");
  } catch (e) {
    console.warn("Service Worker registrace selhala:", e);
  }
}

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
