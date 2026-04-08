const CACHE_NAME = "beh-poznamky-v1";
const SYNC_TAG = "sync-notes";
const DB_NAME = "beh-poznamky-db";
const STORE_NAME = "queue";

// ── Instalace: cache app shellu ──────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(["./app.html", "./app.js", "./manifest.json"])
    )
  );
  self.skipWaiting();
});

// ── Aktivace: vyčisti staré cache ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: slouž z cache, fallback na síť ────────────────────────────────────
self.addEventListener("fetch", (event) => {
  // Pouze GET requesty cachujeme; POST (odesílání poznámek) nikdy
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ── Background Sync: odeslání čekající fronty ────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

// ── Otevření IndexedDB ───────────────────────────────────────────────────────
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

// ── Odeslání všech čekajících záznamů ────────────────────────────────────────
async function flushQueue() {
  const db = await openDB();

  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });

  for (const record of records) {
    try {
      const res = await fetch(record.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record.payload),
      });

      if (res.ok) {
        // Úspěch → smaž ze fronty
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const req = tx.objectStore(STORE_NAME).delete(record.id);
          req.onsuccess = resolve;
          req.onerror = (e) => reject(e.target.error);
        });

        // Informuj otevřené okno aplikace
        const clients = await self.clients.matchAll();
        clients.forEach((client) =>
          client.postMessage({ type: "NOTE_SENT", id: record.id })
        );
      }
    } catch {
      // Síť stále nedostupná → zůstane v bufferu, zkusí se znovu
    }
  }
}
