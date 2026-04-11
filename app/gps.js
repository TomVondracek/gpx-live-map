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
  } catch {}
}

async function refreshBattery() {
  const Device = getCapacitorPlugin("Device");
  if (!Device) return;
  try {
    const info = await Device.getBatteryInfo();
    batteryLevel = Math.round((info.batteryLevel || 0) * 100);
  } catch {}
}
