const ENTRY_TYPE_TEXT = "text";
const ENTRY_TYPE_AUDIO = "audio";
const ENTRY_TYPE_PHOTO = "photo";
const ENTRY_TYPE_TRACK = "track";
const ENTRY_TYPE_VISITOR_MESSAGE = "visitor_message";

const NOTE_ENTRY_TYPES = Object.freeze([
  ENTRY_TYPE_TEXT,
  ENTRY_TYPE_AUDIO,
  ENTRY_TYPE_PHOTO,
  ENTRY_TYPE_TRACK,
  ENTRY_TYPE_VISITOR_MESSAGE,
]);

/**
 * @typedef {Object} BaseNotePayload
 * @property {string} entry_id  - Klientem generované UUID; slouží k deduplication při retry/offline flush
 * @property {string} time
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {number|null} battery
 * @property {number|null} speed
 * @property {number|null} altitude
 */

/**
 * @typedef {Object} AudioDraft
 * @property {Blob} blob
 * @property {string} mimeType
 * @property {number} durationSec
 * @property {string} fileName
 */

/**
 * @typedef {Object} PhotoDraft
 * @property {string} base64
 * @property {string} mimeType
 */

function normalizeEntryType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (NOTE_ENTRY_TYPES.includes(normalized)) {
    return normalized;
  }
  return ENTRY_TYPE_TEXT;
}

function inferEntryType(record) {
  const explicitType = normalizeEntryType(record && record.entry_type);
  if (explicitType === ENTRY_TYPE_TRACK) return ENTRY_TYPE_TRACK;
  if (explicitType !== ENTRY_TYPE_TEXT) {
    return explicitType;
  }
  if (record && (record.audio_file_id || record.audio_base64 || record.audioBlob)) {
    return ENTRY_TYPE_AUDIO;
  }
  if (record && (record.photo_file_id || record.photo_base64)) {
    return ENTRY_TYPE_PHOTO;
  }
  return ENTRY_TYPE_TEXT;
}

function getEntryType(record) {
  return inferEntryType(record);
}

function isAudioEntry(record) {
  return inferEntryType(record) === ENTRY_TYPE_AUDIO;
}

function isPhotoEntry(record) {
  return inferEntryType(record) === ENTRY_TYPE_PHOTO;
}

function isTextEntry(record) {
  return inferEntryType(record) === ENTRY_TYPE_TEXT;
}

function isTrackEntry(record) {
  return inferEntryType(record) === ENTRY_TYPE_TRACK;
}

/**
 * @param {BaseNotePayload} basePayload
 * @param {string} noteText
 */
function createTextPayload(basePayload, noteText) {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_TEXT,
    note: String(noteText || "").trim(),
  };
}

/**
 * @param {BaseNotePayload} basePayload
 * @param {AudioDraft} audioDraft
 */
function createAudioPayload(basePayload, audioDraft) {
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

/**
 * @param {BaseNotePayload} basePayload
 * @param {PhotoDraft} photoDraft
 */
function createPhotoPayload(basePayload, photoDraft) {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_PHOTO,
    note: "",
    photo_base64: photoDraft.base64,
    photo_mime: photoDraft.mimeType,
  };
}

/**
 * @param {BaseNotePayload} basePayload
 * @param {number|null} gpsAccuracy  - Přesnost GPS v metrech (coords.accuracy)
 */
function createTrackPayload(basePayload, gpsAccuracy) {
  return {
    ...basePayload,
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_TRACK,
    gps_accuracy: gpsAccuracy != null ? gpsAccuracy : null,
  };
}

function createVisitorMessagePayload(senderName, noteText, visitorId, honeypot = "") {
  return {
    entry_id: crypto.randomUUID(),
    entry_type: ENTRY_TYPE_VISITOR_MESSAGE,
    time: new Date().toISOString(),
    lat: null,
    lon: null,
    battery: null,
    speed: null,
    altitude: null,
    sender_name: String(senderName || "").trim(),
    visitor_id: String(visitorId || "").trim(),
    website: String(honeypot || "").trim(),
    note: String(noteText || "").trim(),
  };
}

function getPointKey(point) {
  return [
    point.time ?? "",
    point.lat ?? "",
    point.lon ?? "",
    point.note ?? "",
    normalizeEntryType(point.entry_type ?? ""),
    point.sender_name ?? "",
    point.audio_file_id ?? "",
    point.photo_file_id ?? ""
  ].join("|");
}
