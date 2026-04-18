const SHEET_URL = PROJECT_CONFIG.sheetUrl;
const GPX_URL = PROJECT_CONFIG.gpxUrl;
const MAP_TOKEN_STORAGE_KEY = PROJECT_CONFIG.mapTokenStorageKey;

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

const audioBlobUrlCache = new Map();
const audioFetchPromises = new Map();
