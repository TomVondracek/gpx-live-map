// ── Konstanty typů poznámek ───────────────────────────────────────────────────
const ENTRY_TYPE_TEXT = "text" as const;
const ENTRY_TYPE_AUDIO = "audio" as const;
const ENTRY_TYPE_PHOTO = "photo" as const;

type NoteEntryType = typeof ENTRY_TYPE_TEXT | typeof ENTRY_TYPE_AUDIO | typeof ENTRY_TYPE_PHOTO;

const NOTE_ENTRY_TYPES: readonly NoteEntryType[] = Object.freeze([
  ENTRY_TYPE_TEXT,
  ENTRY_TYPE_AUDIO,
  ENTRY_TYPE_PHOTO,
]);

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Společný základ všech payloadů poznámek. entry_id se generuje jednou při
 *  vytvoření payloadu a putuje nezměněné přes serializaci i retry — slouží
 *  k deduplication na serveru. */
interface BaseNotePayload {
  entry_id: string;
  time: string;
  lat: number | null;
  lon: number | null;
  battery: number | null;
  speed: number | null;
  altitude: number | null;
}

/** Surová audio nahrávka před serializací (Blob není JSON-serializovatelný). */
interface AudioDraft {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  fileName: string;
}

/** Fotografie zachycená kamerou. */
interface PhotoDraft {
  base64: string;
  mimeType: string;
}

// ── Odvozené payload typy ─────────────────────────────────────────────────────

interface TextPayload extends BaseNotePayload {
  entry_type: typeof ENTRY_TYPE_TEXT;
  note: string;
}

interface AudioPayload extends BaseNotePayload {
  entry_type: typeof ENTRY_TYPE_AUDIO;
  note: "";
  audioBlob: Blob;
  audioMime: string;
  audioDurationSec: number;
  audioFileName: string;
}

interface PhotoPayload extends BaseNotePayload {
  entry_type: typeof ENTRY_TYPE_PHOTO;
  note: "";
  photo_base64: string;
  photo_mime: string;
}

type AnyNotePayload = TextPayload | AudioPayload | PhotoPayload;

/** Serializovaná podoba audio payloadu (Blob převeden na base64, určeno pro IndexedDB a POST). */
interface SerializedAudioPayload extends BaseNotePayload {
  entry_type: typeof ENTRY_TYPE_AUDIO;
  note: "";
  audio_base64: string;
  audio_mime: string;
  audio_duration_sec: number | null;
  audio_filename: string;
}

type SerializedPayload = TextPayload | SerializedAudioPayload | PhotoPayload;

// ── Pomocné funkce ────────────────────────────────────────────────────────────

function normalizeEntryType(value: unknown): NoteEntryType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ((NOTE_ENTRY_TYPES as readonly string[]).includes(normalized)) {
    return normalized as NoteEntryType;
  }
  return ENTRY_TYPE_TEXT;
}

function inferEntryType(record: Partial<AnyNotePayload> & Record<string, unknown>): NoteEntryType {
  const explicitType = normalizeEntryType(record.entry_type);
  if (explicitType !== ENTRY_TYPE_TEXT) {
    return explicitType;
  }
  if ("audio_file_id" in record && record.audio_file_id) return ENTRY_TYPE_AUDIO;
  if ("audio_base64" in record && record.audio_base64) return ENTRY_TYPE_AUDIO;
  if ("audioBlob" in record && record.audioBlob) return ENTRY_TYPE_AUDIO;
  if ("photo_file_id" in record && record.photo_file_id) return ENTRY_TYPE_PHOTO;
  if ("photo_base64" in record && record.photo_base64) return ENTRY_TYPE_PHOTO;
  return ENTRY_TYPE_TEXT;
}

function getEntryType(record: Partial<AnyNotePayload> & Record<string, unknown>): NoteEntryType {
  return inferEntryType(record);
}

function isAudioEntry(record: Partial<AnyNotePayload> & Record<string, unknown>): boolean {
  return inferEntryType(record) === ENTRY_TYPE_AUDIO;
}

function isPhotoEntry(record: Partial<AnyNotePayload> & Record<string, unknown>): boolean {
  return inferEntryType(record) === ENTRY_TYPE_PHOTO;
}

function isTextEntry(record: Partial<AnyNotePayload> & Record<string, unknown>): boolean {
  return inferEntryType(record) === ENTRY_TYPE_TEXT;
}

// ── Factory funkce pro vytváření payloadů ─────────────────────────────────────

function createTextPayload(basePayload: BaseNotePayload, noteText: string): TextPayload {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_TEXT,
    note: String(noteText ?? "").trim(),
  };
}

function createAudioPayload(basePayload: BaseNotePayload, audioDraft: AudioDraft): AudioPayload {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_AUDIO,
    note: "",
    audioBlob: audioDraft.blob,
    audioMime: audioDraft.mimeType,
    audioDurationSec: audioDraft.durationSec,
    audioFileName: audioDraft.fileName,
  };
}

function createPhotoPayload(basePayload: BaseNotePayload, photoDraft: PhotoDraft): PhotoPayload {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_PHOTO,
    note: "",
    photo_base64: photoDraft.base64,
    photo_mime: photoDraft.mimeType,
  };
}

// ── Klíč pro UI deduplication (zobrazení na mapě) ────────────────────────────

/** Vrátí klíč pro deduplication zobrazených bodů na mapě.
 *  Nesouvisí se server-side dedup — k tomu slouží entry_id. */
function getPointKey(point: Partial<SerializedPayload> & Record<string, unknown>): string {
  return [
    (point.time ?? ""),
    (point.lat ?? ""),
    (point.lon ?? ""),
    (point.note ?? ""),
    normalizeEntryType(point.entry_type),
    ("audio_file_id" in point ? point.audio_file_id ?? "" : ""),
    ("photo_file_id" in point ? point.photo_file_id ?? "" : ""),
  ].join("|");
}
