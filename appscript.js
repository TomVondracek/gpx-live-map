const SHEET_HEADERS_ = [
  "time",           // col 1  (index 0)
  "lat",            // col 2  (index 1)
  "lon",            // col 3  (index 2)
  "note",           // col 4  (index 3)
  "battery",        // col 5  (index 4)
  "speed",          // col 6  (index 5)
  "altitude",       // col 7  (index 6)
  "weather_temp",   // col 8  (index 7)
  "weather_code",   // col 9  (index 8)
  "entry_type",     // col 10 (index 9)
  "audio_file_id",  // col 11 (index 10)
  "audio_mime",     // col 12 (index 11)
  "audio_duration_sec", // col 13 (index 12)
  "photo_file_id",  // col 14 (index 13)
  "entry_id",       // col 15 (index 14) — klientské UUID pro deduplication
  "gps_accuracy",   // col 16 (index 15) — přesnost GPS v metrech (pouze entry_type=track)
];

const ENTRY_TYPE_TEXT_ = "text";
const ENTRY_TYPE_AUDIO_ = "audio";
const ENTRY_TYPE_PHOTO_ = "photo";
const ENTRY_TYPE_TRACK_ = "track";

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getExpectedToken_(mode) {
  const props = PropertiesService.getScriptProperties();
  if (mode === "read") {
    return props.getProperty("READ_TOKEN") || props.getProperty("API_TOKEN") || "";
  }
  if (mode === "write") {
    return props.getProperty("WRITE_TOKEN") || props.getProperty("API_TOKEN") || "";
  }
  return "";
}

function getPublicReadEnabled_() {
  const props = PropertiesService.getScriptProperties();
  const value = props.getProperty("PUBLIC_READ_ENABLED") || props.getProperty("ALLOW_PUBLIC_READ") || "";
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function secureEquals_(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized_(providedToken, mode) {
  if (mode === "read" && getPublicReadEnabled_()) {
    return true;
  }

  const expectedToken = getExpectedToken_(mode);
  if (!expectedToken || !providedToken) return false;
  return secureEquals_(String(providedToken), expectedToken);
}

function neutralizeSpreadsheetFormula_(value) {
  if (value == null) return "";

  const text = String(value);
  if (/^[=+\-@]/.test(text)) {
    return "'" + text;
  }
  return text;
}

function parseFloatOrNull_(value) {
  if (value === "" || value == null) return null;
  const num = parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

function parseIntOrNull_(value) {
  if (value === "" || value == null) return null;
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? null : num;
}

function ensureHeaders_(sheet) {
  const range = sheet.getRange(1, 1, 1, SHEET_HEADERS_.length);
  const existing = range.getValues()[0];
  const next = existing.slice();
  let changed = false;

  SHEET_HEADERS_.forEach((header, index) => {
    if (!next[index]) {
      next[index] = header;
      changed = true;
    }
  });

  if (changed) {
    range.setValues([next]);
  }
}

function sortSheetByTime_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return;

  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({
    column: 1,
    ascending: true,
  });
}

function compareRowsByTime_(left, right) {
  const leftTime = String(left && left[0] || "");
  const rightTime = String(right && right[0] || "");
  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }

  const leftEntryId = String(left && left[14] || "");
  const rightEntryId = String(right && right[14] || "");
  if (leftEntryId === rightEntryId) return 0;
  return leftEntryId < rightEntryId ? -1 : 1;
}

function resolveAudioFolder_() {
  const folderId = PropertiesService.getScriptProperties().getProperty("AUDIO_FOLDER_ID");
  if (folderId) {
    return DriveApp.getFolderById(folderId);
  }
  return DriveApp.getRootFolder();
}

function getAudioExtension_(mimeType) {
  switch (mimeType) {
    case "audio/webm":
    case "audio/webm;codecs=opus":
      return "webm";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    default:
      return "bin";
  }
}

function createAudioFile_(data) {
  if (!data.audio_base64) {
    throw new Error("missing_audio_data");
  }

  const mimeType = String(data.audio_mime || "audio/webm");
  const extension = getAudioExtension_(mimeType);
  const bytes = Utilities.base64Decode(data.audio_base64);
  const safeTimestamp = String(data.time || new Date().toISOString()).replace(/[^\dTZ-]/g, "");
  const fileName = data.audio_filename || `hlasova-poznamka-${safeTimestamp}.${extension}`;
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  return resolveAudioFolder_().createFile(blob);
}

function createPhotoFile_(data) {
  if (!data.photo_base64) {
    throw new Error("missing_photo_data");
  }

  const mimeType = String(data.photo_mime || "image/jpeg");
  const bytes = Utilities.base64Decode(data.photo_base64);
  const safeTimestamp = String(data.time || new Date().toISOString()).replace(/[^\dTZ-]/g, "");
  const fileName = `foto-poznamka-${safeTimestamp}.jpg`;
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  return resolveAudioFolder_().createFile(blob);
}

function entryTypeFromRow_(row) {
  if (row[9]) return normalizeEntryType_(row[9]);
  if (row[10]) return ENTRY_TYPE_AUDIO_;
  if (row[13]) return ENTRY_TYPE_PHOTO_;
  return ENTRY_TYPE_TEXT_;
}
function normalizeEntryType_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === ENTRY_TYPE_AUDIO_ || normalized === ENTRY_TYPE_PHOTO_ || normalized === ENTRY_TYPE_TRACK_) {
    return normalized;
  }
  return ENTRY_TYPE_TEXT_;
}

function isKnownAudioFileId_(sheet, fileId) {
  const lastRow = sheet.getLastRow();
  if (!fileId || lastRow < 2) return false;

  const values = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
  return values.some((row) => String(row[0] || "") === String(fileId));
}

/**
 * Zkontroluje, zda entry_id již existuje v sheetu (posledních DEDUP_SCAN_ROWS řádků).
 * Vrací true pokud je záznam duplikát — POST lze bezpečně ignorovat.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} entryId
 * @returns {boolean}
 */
const DEDUP_SCAN_ROWS_ = 200;

function isDuplicateEntryId_(sheet, entryId) {
  if (!entryId) return false;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const startRow = Math.max(2, lastRow - DEDUP_SCAN_ROWS_ + 1);
  const numRows = lastRow - startRow + 1;

  // entry_id je ve sloupci 15 (index 14)
  const values = sheet.getRange(startRow, 15, numRows, 1).getValues();
  return values.some((row) => String(row[0] || "") === String(entryId));
}

function getWeatherSnapshot_(data) {
  let temp = "";
  let wcode = "";

  if (data.lat !== null && data.lon !== null) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${data.lat}&longitude=${data.lon}&current=temperature_2m,weather_code`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const wdata = JSON.parse(res.getContentText());
        if (wdata && wdata.current) {
          temp = wdata.current.temperature_2m;
          wcode = wdata.current.weather_code;
        }
      }
    } catch (err) {
      // Ignorovat chyby počasí
    }
  }

  return { temp, wcode };
}

function readAudioFile_(sheet, fileId) {
  if (!isKnownAudioFileId_(sheet, fileId)) {
    return jsonOutput_({ ok: false, error: "not_found" });
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return jsonOutput_({
      ok: true,
      audioBase64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      fileName: file.getName(),
    });
  } catch (err) {
    return jsonOutput_({ ok: false, error: "audio_unavailable" });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!isAuthorized_(data.token, "write")) {
      return jsonOutput_({ ok: false, error: "unauthorized" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    ensureHeaders_(sheet);

    // Deduplication: pokud entry_id již existuje, vrátit ok bez zápisu
    const entryId = String(data.entry_id || "");
    if (entryId && isDuplicateEntryId_(sheet, entryId)) {
      return jsonOutput_({ ok: true, duplicate: true });
    }

    const weather = getWeatherSnapshot_(data);
    const entryType = normalizeEntryType_(data.entry_type);

    let audioFileId = "";
    let audioMime = "";
    let audioDurationSec = "";
    let photoFileId = "";

    if (entryType === ENTRY_TYPE_AUDIO_) {
      const audioFile = createAudioFile_(data);
      audioFileId = audioFile.getId();
      audioMime = String(data.audio_mime || audioFile.getMimeType() || "");
      audioDurationSec = data.audio_duration_sec != null ? data.audio_duration_sec : "";
    } else if (entryType === ENTRY_TYPE_PHOTO_) {
      const photoFile = createPhotoFile_(data);
      photoFileId = photoFile.getId();
      photoFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    // ENTRY_TYPE_TRACK_ — žádné soubory na Drive, pouze data polohy

    const gpsAccuracy = (entryType === ENTRY_TYPE_TRACK_ && data.gps_accuracy != null)
      ? data.gps_accuracy
      : "";

    sheet.appendRow([
      data.time || new Date().toISOString(),
      data.lat != null ? data.lat : "",
      data.lon != null ? data.lon : "",
      (entryType === ENTRY_TYPE_AUDIO_ || entryType === ENTRY_TYPE_PHOTO_ || entryType === ENTRY_TYPE_TRACK_) ? "" : neutralizeSpreadsheetFormula_(data.note),
      data.battery ?? "",
      data.speed ?? "",
      data.altitude ?? "",
      weather.temp,
      weather.wcode,
      entryType,
      audioFileId,
      audioMime,
      audioDurationSec,
      photoFileId,
      entryId,
      gpsAccuracy,
    ]);
    sortSheetByTime_(sheet);

    return jsonOutput_({ ok: true, entryType, audioFileId });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message || "invalid_request") });
  }
}

function doGet(e) {
  try {
    const token = e && e.parameter ? e.parameter.token : "";
    if (!isAuthorized_(token, "read")) {
      return jsonOutput_({ ok: false, error: "unauthorized" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    ensureHeaders_(sheet);

    const audioFileId = e && e.parameter ? e.parameter.audioFileId : "";
    if (audioFileId) {
      return readAudioFile_(sheet, audioFileId);
    }

    const data = sheet.getDataRange().getValues();
    const allRows = data.slice(1).sort(compareRowsByTime_);

    // Inkrementální synchronizace: vrátit jen záznamy novější než ?since=<ISO>
    // ISO timestamps jsou lexikograficky srovnatelné — string porovnání funguje správně.
    const sinceParam = e && e.parameter ? String(e.parameter.since || "") : "";
    const rows = sinceParam
      ? allRows.filter((row) => String(row[0] || "") > sinceParam)
      : allRows;

    const result = rows.map((row) => ({
      time: row[0],
      lat: parseFloatOrNull_(row[1]),
      lon: parseFloatOrNull_(row[2]),
      note: row[3] || "",
      battery: parseIntOrNull_(row[4]),
      speed: parseFloatOrNull_(row[5]),
      altitude: parseIntOrNull_(row[6]),
      weather_temp: parseFloatOrNull_(row[7]),
      weather_code: parseIntOrNull_(row[8]),
      entry_type: entryTypeFromRow_(row),
      audio_file_id: row[10] || "",
      audio_mime: row[11] || "",
      audio_duration_sec: parseFloatOrNull_(row[12]),
      photo_file_id: row[13] || "",
      entry_id: row[14] || "",
      gps_accuracy: parseIntOrNull_(row[15]),
    }));

    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "server_error" });
  }
}
