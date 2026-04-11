/**
 * Service Worker pro Background Sync odesílání fronty.
 *
 * Princip:
 *   1. App uloží serializované záznamy (bez Blob) do IndexedDB store "queue".
 *   2. App uloží WRITE_TOKEN a SHEET_URL do IDB store "config".
 *   3. App zaregistruje sync tag "flush-queue" (Background Sync API).
 *   4. OS spustí tento SW, jakmile je síť dostupná — i pokud je app na pozadí.
 *   5. SW přečte frontu z IDB, odešle záznamy a smazané úspěšné.
 *
 * SW sdílí přesně stejnou IDB s hlavní aplikací (stejný DB_NAME + DB_VERSION).
 */

const DB_NAME = "beh-poznamky-db";
const DB_VERSION = 2;
const STORE_NAME = "queue";
const CONFIG_STORE = "config";
const SYNC_TAG = "flush-queue";

// ── IDB helpers ───────────────────────────────────────────────────────────────

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

function getAllFromQueue(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function deleteFromQueue(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = resolve;
    req.onerror = (e) => reject(e.target.error);
  });
}

function getConfig(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, "readonly");
    const req = tx.objectStore(CONFIG_STORE).get(key);
    req.onsuccess = (e) => resolve(e.target.result ? e.target.result.value : null);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── Flush logika ──────────────────────────────────────────────────────────────

async function flushQueue() {
  const db = await openDB();

  const [records, writeToken, sheetUrl] = await Promise.all([
    getAllFromQueue(db),
    getConfig(db, "WRITE_TOKEN"),
    getConfig(db, "SHEET_URL"),
  ]);

  if (!records || records.length === 0) {
    console.log("[SW] Fronta je prázdná, není co odesílat.");
    return;
  }

  if (!writeToken || !sheetUrl) {
    console.warn("[SW] Chybí WRITE_TOKEN nebo SHEET_URL v IDB config — nelze odeslat.");
    return;
  }

  console.log(`[SW] Odesílám ${records.length} záznamů z fronty.`);

  for (const record of records) {
    try {
      const body = { ...record.payload, token: writeToken };
      const res = await fetch(sheetUrl, {
        method: "POST",
        body: JSON.stringify(body),
        // Bez Content-Type → simple request → žádný CORS preflight
      });

      if (!res.ok) {
        console.error(`[SW] HTTP chyba ${res.status} pro záznam ${record.id}`);
        // Transientní HTTP chyba — přestat, zkusit příště
        break;
      }

      // Zkontroluj odpověď serveru
      const text = await res.text();
      if (text) {
        try {
          const data = JSON.parse(text);
          if (data && data.ok === false) {
            const errCode = data.error === "unauthorized" ? "UNAUTHORIZED" : "API";
            console.error(`[SW] Server vrátil chybu (${errCode}) pro záznam ${record.id}:`, data.error);
            if (errCode === "UNAUTHORIZED") {
              // Autorizační chyba — nemá smysl zkoušet další záznamy
              break;
            }
          }
        } catch (_) {
          // Odpověď není JSON — považujeme za úspěch
        }
      }

      await deleteFromQueue(db, record.id);
      console.log(`[SW] Odesláno a smazáno z fronty: ${record.id}`);

    } catch (err) {
      console.log(`[SW] Síťová chyba při odesílání záznamu ${record.id}:`, err);
      // Síť stále nedostupná — přestat, OS znovu spustí sync event až bude síť
      break;
    }
  }
}

// ── Service Worker lifecycle ──────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  console.log("[SW] Instalace dokončena.");
  // skipWaiting zajistí okamžitou aktivaci nové verze SW
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Aktivace dokončena.");
  // Převzít kontrolu nad všemi klienty okamžitě
  event.waitUntil(self.clients.claim());
});

// ── Background Sync ───────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    console.log("[SW] Background sync spuštěn:", SYNC_TAG);
    event.waitUntil(flushQueue());
  }
});
