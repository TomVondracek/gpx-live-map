const SHEET_URL = PROJECT_CONFIG.sheetUrl;
const GPX_URL = PROJECT_CONFIG.gpxUrl;
const MAP_TOKEN_STORAGE_KEY = PROJECT_CONFIG.mapTokenStorageKey;
const isNativeApp = typeof window !== "undefined"
  && typeof window.Capacitor !== "undefined"
  && typeof window.Capacitor.isNativePlatform === "function"
  && window.Capacitor.isNativePlatform();

const map = L.map("map").setView([49.8, 18.27], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

let markers = [];
let markerByPointKey = new Map();
let multiPinGroups = new Map();
let expandedMultiPin = null;
let firstFitDone = false;
let gpxPoints = [];
let activePointKey = null;
let hasShownInitialLatestPopup = false;
let isRefreshingMarkers = false;
let suppressActivePointReset = false;
let notesPolyline = null;
let arrowMarkers = [];
let userScrolled = false;

// Inkrementální synchronizace
let lastTimestamp = null;   // ISO string posledního načteného záznamu (null = full load)
let allPoints = [];         // kumulativní seznam všech validních bodů (s lat/lon)
let allRecords = [];        // všechny záznamy včetně těch bez GPS

const WEATHER_ICONS = {
  0: "☀️",
  1: "🌤️", 2: "⛅", 3: "🌥️",
  45: "🌫️", 48: "🌫️",
  51: "🌧️", 53: "🌧️", 55: "🌧️", 56: "🌧️", 57: "🌧️", 61: "🌧️", 63: "🌧️", 65: "🌧️", 66: "🌧️", 67: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "🌨️", 77: "🌨️",
  80: "🌦️", 81: "🌦️", 82: "🌦️",
  95: "⛈️", 96: "⛈️", 99: "⛈️"
};

const redIcon = L.icon({
  iconUrl: "./vendor/leaflet-color-markers/marker-icon-2x-red.png",
  shadowUrl: "./vendor/leaflet/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Ikona pro auto-tracking body — malý modrý kruh
const trackIcon = L.divIcon({
  className: "",
  html: '<div class="track-dot"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -8],
});

const audioBlobUrlCache = new Map();
const audioFetchPromises = new Map();

async function downloadOrShareGpx(event) {
  event.preventDefault();

  const downloadLink = document.getElementById("map-download-gpx");
  const originalLabel = downloadLink ? downloadLink.textContent : "";

  try {
    if (downloadLink) {
      downloadLink.textContent = "Připravuji GPX…";
    }

    const response = await fetch(GPX_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    // Zkusit Web Share API (funguje na mobilu i desktopu kde je podporováno).
    // Pokud uživatel share sheet zavře (AbortError) nebo API není dostupné,
    // fallback na klasický <a download>.
    const file = new File([blob], "trasa.gpx", {
      type: blob.type || "application/gpx+xml",
      lastModified: Date.now(),
    });

    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: "trasa.gpx",
          text: "GPX trasa z UltraLogu",
        });
        return;
      } catch (shareErr) {
        // AbortError = uživatel zavřel share sheet → fallback na download
        // Ostatní chyby také fallback
        console.warn("navigator.share selhalo, používám fallback download:", shareErr);
      }
    }

    // Fallback: stažení přes dočasný <a download>
    const blobUrl = URL.createObjectURL(blob);
    const tempLink = document.createElement("a");
    tempLink.href = blobUrl;
    tempLink.download = "trasa.gpx";
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    console.error("Stažení GPX trasy selhalo:", error);
    window.alert("GPX trasu se nepodařilo připravit ke stažení.");
  } finally {
    if (downloadLink) {
      downloadLink.textContent = originalLabel;
    }
  }
}
