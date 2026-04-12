/**
 * Ambient deklarace cross-file globálů pro TypeScript.
 *
 * Tyto proměnné a funkce jsou definovány v app/*.js a shared/*.ts souborech
 * a v module:None kontextu jsou dostupné globálně (script-tag architektura,
 * žádné ES modules / bundler).
 *
 * Soubor se NEdistribuuje do www/ — slouží pouze pro typovou kontrolu (tsc).
 */

// ── Konfigurace z app/shared.js ───────────────────────────────────────────────
declare const SHEET_URL: string;
declare const WRITE_TOKEN: string;
declare const READ_TOKEN: string;
declare const DB_NAME: string;
declare const STORE_NAME: string;
declare const MAX_AUDIO_DURATION_MS: number;
declare const MAX_AUDIO_SIZE_BYTES: number;
declare const AUDIO_MIME_CANDIDATES: string[];

// ── Stav aplikace z app/shared.js ────────────────────────────────────────────
declare let isRecording: boolean;
declare let userStoppedRecording: boolean;
declare let pendingAudioNote: AudioDraft | null;
declare let pendingPhoto: PhotoDraft | null;
declare let pendingAudioObjectUrl: string;
declare let audioStopTimer: ReturnType<typeof setTimeout> | null;
declare let audioDurationInterval: ReturnType<typeof setInterval> | null;
declare let audioRecordingStartedAt: number;
declare let currentTranscript: string;
declare let googleSttAvailable: boolean;
declare let voskReady: boolean;
declare let voskLoading: boolean;
declare let activeEngine: string | null;
declare let activeCaptureMode: string | null;
declare let isOnline: boolean;
declare let batteryLevel: number | null;
declare let isFlushing: boolean;
declare let mediaStream: MediaStream | null;
declare let mediaRecorder: MediaRecorder | null;
declare let mediaChunks: BlobPart[];
declare let mediaMimeType: string | null;
declare let wakeLock: WakeLockSentinel | null;
declare let lastGpsAccuracy: number | null;
declare let lastGpsCoords: {
  lat: number;
  lon: number;
  speed: number | null;
  altitude: number | null;
  ts: number;
} | null;
declare let gpsWatchId: string | null;
declare let gloveMode: boolean;

// ── Funkce z app/shared.js ────────────────────────────────────────────────────
declare function vibrate(type?: "light" | "medium" | "success" | "error"): Promise<void>;
declare function keepScreenOn(): Promise<void>;
declare function allowScreenOff(): Promise<void>;
declare function beep(type?: "start" | "stop"): void;
declare function normalizeTranscriptWhitespace(text: string): string;
declare function sanitizeOfflineTranscript(text: string): string;
declare function uppercaseFirstLetter(text: string): string;
declare function formatFinalSegment(text: string, options?: { filterUnknownTokens?: boolean }): string;
declare function formatPartialSegment(text: string, options?: { filterUnknownTokens?: boolean }): string;
declare function renderTranscriptWithPartial(partialText?: string, options?: { filterUnknownTokens?: boolean }): void;
declare function appendFinalTranscriptSegment(text: string, options?: { filterUnknownTokens?: boolean }): void;
declare function supportsMediaRecording(): boolean;
declare function ensureMicrophonePermission(): Promise<boolean>;
declare function pickSupportedAudioMimeType(): string;
declare function formatAudioDuration(durationSec: number): string;
declare function getAudioFileExtension(mimeType: string): string;
declare function clearPendingAudioPreview(): void;
declare function clearPendingPhotoPreview(): void;
declare function showAudioPreview(audioNote: AudioDraft & { blob: Blob; durationSec: number }): void;
declare function blobToBase64(blob: Blob): Promise<string>;
declare function serializePayloadForPost(payload: AnyNotePayload | SerializedPayload): Promise<SerializedPayload>;
declare function getCapacitorPlugin(name: string): Record<string, unknown> | null;

// ── Funkce z app/ui.js ────────────────────────────────────────────────────────
declare function discardNote(options?: { keepMessages?: boolean }): void;
declare function autoResize(): void;
declare function showError(msg: string): void;
declare function showSuccess(msg: string): void;
declare function getMapPageHref(): string;
declare function getMapLinkTarget(): string;
declare function configureMapLinks(): void;
declare function updateStatus(): Promise<void>;
declare function setGloveMode(active: boolean): void;
declare function getSpeechStatusText(): string;
declare function updateDiagnostics(): void;

// ── Funkce z app/gps.js ───────────────────────────────────────────────────────
declare function getPosition(): Promise<GeolocationPosition>;
declare function startGpsWatch(): Promise<void>;
declare function stopGpsWatch(): Promise<void>;
declare function initBattery(): Promise<void>;
declare function refreshBattery(): Promise<void>;

// ── Funkce z shared/note-records.ts ──────────────────────────────────────────
declare function inferEntryType(record: Partial<AnyNotePayload> & Record<string, unknown>): NoteEntryType;
declare function createTextPayload(basePayload: BaseNotePayload, noteText: string): TextPayload;
declare function createAudioPayload(basePayload: BaseNotePayload, audioDraft: AudioDraft): AudioPayload;
declare function createPhotoPayload(basePayload: BaseNotePayload, photoDraft: PhotoDraft): PhotoPayload;
