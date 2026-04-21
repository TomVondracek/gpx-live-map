// ── IndexedDB ─────────────────────────────────────────────────────────────────
// DB verze 2: přidán store "config" pro sdílení konfigurace se Service Workerem.
const DB_VERSION = 2;
const CONFIG_STORE = "config";

interface QueueRecord {
  id: string;
  url: string;
  payload: SerializedPayload;
  createdAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function saveConfig(key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readwrite");
    tx.objectStore(CONFIG_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

async function enqueue(payload: SerializedPayload): Promise<string> {
  const db = await openDB();
  const record: QueueRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url: SHEET_URL,
    payload,
    createdAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(record);
    req.onsuccess = () => resolve(record.id);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

async function getQueueCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = (e) => resolve((e.target as IDBRequest<number>).result);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

async function deleteFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

async function getAllFromQueue(): Promise<QueueRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve((e.target as IDBRequest<QueueRecord[]>).result);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

// ── Offline fronta — flush (nahrazuje Service Worker Background Sync) ────────
async function flushQueue(): Promise<void> {
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
        const err = error as { code?: string };
        if (err && (err.code === "UNAUTHORIZED" || err.code === "CONFIG")) {
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
async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    console.log("Service Worker zaregistrován.");
  } catch (e) {
    console.warn("Service Worker registrace selhala:", e);
  }
}

async function saveConfigForSW(): Promise<void> {
  try {
    await Promise.all([
      saveConfig("WRITE_TOKEN", WRITE_TOKEN),
      saveConfig("SHEET_URL", SHEET_URL),
    ]);
  } catch (e) {
    console.warn("Nepodařilo se uložit konfiguraci pro SW:", e);
  }

}

async function swSyncRegister(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Background Sync API není součástí standardní TypeScript DOM lib
    const syncReg = reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
    if (syncReg.sync) {
      await syncReg.sync.register("flush-queue");
      console.log("Background sync tag zaregistrován.");
    }
  } catch (e) {
    console.warn("Background sync registrace selhala (není kritická):", e);
  }
}

// ── Queue UI (správa čekající fronty) ─────────────────────────────────────────
interface QueueItemLabel {
  icon: string;
  label: string;
}

function formatQueueItemLabel(record: QueueRecord): QueueItemLabel {
  const type = inferEntryType(record && record.payload as Partial<AnyNotePayload> & Record<string, unknown>);
  if (type === ENTRY_TYPE_AUDIO) {
    const payload = record.payload as SerializedAudioPayload;
    const dur = payload.audio_duration_sec;
    const durText = dur ? ` · ${formatAudioDuration(dur)}` : "";
    return { icon: "🎙", label: "Hlasová poznámka" + durText };
  }
  if (type === ENTRY_TYPE_PHOTO) {
    return { icon: "📷", label: "Fotografie" };
  }
  if (type === ENTRY_TYPE_TRACK) {
    const payload = record.payload as TrackPayload;
    const accuracyText = payload.gps_accuracy != null ? ` · ±${payload.gps_accuracy} m` : "";
    return { icon: "📍", label: "Tracking bod" + accuracyText };
  }
  const note = String(record.payload && (record.payload as TextPayload).note || "").trim();
  const preview = note.length > 40 ? note.slice(0, 40) + "…" : (note || "Textová poznámka");
  return { icon: "📝", label: preview };
}

function formatQueueItemDate(isoString: string | undefined): string {
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

async function openQueuePanel(): Promise<void> {
  const records = await getAllFromQueue();

  const list = document.getElementById("queue-list") as HTMLUListElement;
  const empty = document.getElementById("queue-empty") as HTMLElement;
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
        await deleteFromQueue((btn as HTMLElement).dataset.id!);
        await updateStatus();
        await openQueuePanel();
      });
    });
  }

  (document.getElementById("queue-overlay") as HTMLElement).classList.remove("hidden");
  (document.getElementById("queue-panel") as HTMLElement).classList.remove("hidden");
}

function closeQueuePanel(): void {
  (document.getElementById("queue-overlay") as HTMLElement).classList.add("hidden");
  (document.getElementById("queue-panel") as HTMLElement).classList.add("hidden");
}
