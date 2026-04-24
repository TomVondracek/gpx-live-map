// ── Typy konfigurace ──────────────────────────────────────────────────────────

interface ProjectConfig {
  sheetUrl: string;
  writeToken: string;
  readToken: string;
  gpxUrl: string;
  mapTokenStorageKey: string;
  publicMapBaseUrl: string;
  publicReadEnabled: boolean;
}

/** Částečná runtime konfigurace injektovaná přes runtime-config.js.
 *  Může obsahovat podmnožinu polí ProjectConfig + starší aliasy tokenů. */
interface RuntimeConfig extends Partial<ProjectConfig> {
  /** Starší alias pro writeToken (zpětná kompatibilita). */
  apiToken?: string;
  /** Starší alias pro readToken (zpětná kompatibilita). */
  mapToken?: string;
}

// V module:None kontextu nelze použít declare global — rozšíříme Window přes
// interface merging (funguje na top-level bez import/export).
interface Window {
  RUN_NOTES_CONFIG?: RuntimeConfig;
}

// ── Inicializace globálu ──────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.RUN_NOTES_CONFIG = window.RUN_NOTES_CONFIG ?? {};
}

// ── Sestavení konfigurace ─────────────────────────────────────────────────────
const PROJECT_RUNTIME_CONFIG: RuntimeConfig =
  (typeof window !== "undefined" && window.RUN_NOTES_CONFIG) ? window.RUN_NOTES_CONFIG : {};

const PROJECT_DEFAULT_CONFIG: ProjectConfig = {
  sheetUrl: "https://script.google.com/macros/s/AKfycbxZli-8aEpEKd6rV8pzFsC73EDI3h-dNIOmBBj4T967HKWxaL-a431b6C21QBOJpEWr/exec",
  writeToken: "",
  readToken: "",
  gpxUrl: "./trasa.gpx",
  mapTokenStorageKey: "beh-poznamky-map-token",
  publicMapBaseUrl: "https://tomvondracek.github.io/gpx-live-map/",
  publicReadEnabled: true,
};

const PROJECT_CONFIG: ProjectConfig = {
  sheetUrl:             PROJECT_RUNTIME_CONFIG.sheetUrl             || PROJECT_DEFAULT_CONFIG.sheetUrl,
  writeToken:           PROJECT_RUNTIME_CONFIG.writeToken           || PROJECT_RUNTIME_CONFIG.apiToken  || "",
  readToken:            PROJECT_RUNTIME_CONFIG.readToken            || PROJECT_RUNTIME_CONFIG.mapToken  || "",
  gpxUrl:               PROJECT_RUNTIME_CONFIG.gpxUrl               || PROJECT_DEFAULT_CONFIG.gpxUrl,
  mapTokenStorageKey:   PROJECT_RUNTIME_CONFIG.mapTokenStorageKey   || PROJECT_DEFAULT_CONFIG.mapTokenStorageKey,
  publicMapBaseUrl:     PROJECT_RUNTIME_CONFIG.publicMapBaseUrl     || PROJECT_DEFAULT_CONFIG.publicMapBaseUrl,
  publicReadEnabled:    PROJECT_RUNTIME_CONFIG.publicReadEnabled === true,
};
