function getWeatherEmoji(code) {
  if (code == null) return "";
  return WEATHER_ICONS[code] || "🌤️";
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Výpočet azimutu (bearing) mezi dvěma GPS body [lat, lon] → stupně (0° = sever, po směru hodinových ručiček)
function bearing(a, b) {
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function findRouteKm(lat, lon) {
  if (gpxPoints.length === 0) return null;
  let minDist = Infinity;
  let bestKm = null;
  for (let i = 0; i < gpxPoints.length; i++) {
    const pt = gpxPoints[i];
    const dist = getDistanceFromLatLonInMeters(lat, lon, pt.lat, pt.lon);
    if (dist < minDist) {
      minDist = dist;
      bestKm = pt.km;
    }
  }
  if (minDist <= 100) {
    return Math.round(bestKm * 10) / 10;
  }
  return null;
}

function formatTime(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTimeShort(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatAudioDuration(durationSec) {
  const totalSeconds = Math.max(1, Math.round(Number(durationSec) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes}:${String(seconds).padStart(2, "0")} min`;
}

function syncActiveNoteUI() {
  document.querySelectorAll(".note-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.pointKey === activePointKey);
  });
}

function base64ToBlobUrl(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/webm" }));
}
