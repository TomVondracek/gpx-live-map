// ── Network (Capacitor Network) ──────────────────────────────────────────────
async function initNetwork() {
  const Network = getCapacitorPlugin("Network");
  if (!Network) {
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
    await flushQueue();
  }
}
