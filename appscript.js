const SHEET_HEADERS_ = [
  "time",
  "lat",
  "lon",
  "note",
  "battery",
  "speed",
  "altitude",
  "weather_temp",
  "weather_code",
  "entry_type",
  "audio_file_id",
  "audio_mime",
  "audio_duration_sec",
  "photo_file_id",
];

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
  if (row[9]) return String(row[9]);
  if (row[10]) return "audio";
  if (row[13]) return "photo";
  return "text";
}

function isKnownAudioFileId_(sheet, fileId) {
  const lastRow = sheet.getLastRow();
  if (!fileId || lastRow < 2) return false;

  const values = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
  return values.some((row) => String(row[0] || "") === String(fileId));
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

    const weather = getWeatherSnapshot_(data);
    let entryType = "text";
    if (String(data.entry_type) === "audio") entryType = "audio";
    else if (String(data.entry_type) === "photo") entryType = "photo";

    let audioFileId = "";
    let audioMime = "";
    let audioDurationSec = "";
    let photoFileId = "";

    if (entryType === "audio") {
      const audioFile = createAudioFile_(data);
      audioFileId = audioFile.getId();
      audioMime = String(data.audio_mime || audioFile.getMimeType() || "");
      audioDurationSec = data.audio_duration_sec != null ? data.audio_duration_sec : "";
    } else if (entryType === "photo") {
      const photoFile = createPhotoFile_(data);
      photoFileId = photoFile.getId();
      photoFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }

    sheet.appendRow([
      data.time || new Date().toISOString(),
      data.lat != null ? data.lat : "",
      data.lon != null ? data.lon : "",
      (entryType === "audio" || entryType === "photo") ? "" : neutralizeSpreadsheetFormula_(data.note),
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
    ]);

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
    const rows = data.slice(1);

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
    }));

    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "server_error" });
  }
}
