if (typeof window !== "undefined") {
  window.RUN_NOTES_CONFIG = window.RUN_NOTES_CONFIG || {};
}

const PROJECT_RUNTIME_CONFIG = (typeof window !== "undefined" && window.RUN_NOTES_CONFIG) || {};

const PROJECT_DEFAULT_CONFIG = {
  sheetUrl: "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec",
  gpxUrl: "./trasa.gpx",
  mapTokenStorageKey: "beh-poznamky-map-token",
};

const PROJECT_CONFIG = {
  sheetUrl: PROJECT_RUNTIME_CONFIG.sheetUrl || PROJECT_DEFAULT_CONFIG.sheetUrl,
  writeToken: PROJECT_RUNTIME_CONFIG.writeToken || PROJECT_RUNTIME_CONFIG.apiToken || "",
  readToken: PROJECT_RUNTIME_CONFIG.readToken || PROJECT_RUNTIME_CONFIG.mapToken || "",
  gpxUrl: PROJECT_RUNTIME_CONFIG.gpxUrl || PROJECT_DEFAULT_CONFIG.gpxUrl,
  mapTokenStorageKey: PROJECT_RUNTIME_CONFIG.mapTokenStorageKey || PROJECT_DEFAULT_CONFIG.mapTokenStorageKey,
};
