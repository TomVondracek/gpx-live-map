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

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!isAuthorized_(data.token, "write")) {
      return jsonOutput_({ ok: false, error: "unauthorized" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
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

    sheet.appendRow([
      data.time,
      data.lat,
      data.lon,
      neutralizeSpreadsheetFormula_(data.note),
      data.battery ?? "",
      data.speed ?? "",
      data.altitude ?? "",
      temp,
      wcode
    ]);

    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: "invalid_request" });
  }
}

function doGet(e) {
  try {
    const token = e && e.parameter ? e.parameter.token : "";
    if (!isAuthorized_(token, "read")) {
      return jsonOutput_({ ok: false, error: "unauthorized" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = sheet.getDataRange().getValues();
    const rows = data.slice(1);

    const result = rows.map((row) => ({
      time: row[0],
      lat: parseFloat(row[1]),
      lon: parseFloat(row[2]),
      note: row[3],
      battery: row[4] !== "" && row[4] != null ? parseInt(row[4], 10) : null,
      speed: row[5] !== "" && row[5] != null ? parseFloat(row[5]) : null,
      altitude: row[6] !== "" && row[6] != null ? parseInt(row[6], 10) : null,
      weather_temp: row[7] !== "" && row[7] != null ? parseFloat(row[7]) : null,
      weather_code: row[8] !== "" && row[8] != null ? parseInt(row[8], 10) : null,
    }));

    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "server_error" });
  }
}
