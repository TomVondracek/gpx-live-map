function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

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
    data.note,
    data.battery ?? "",
    data.speed ?? "",
    data.altitude ?? "",
    temp,
    wcode
  ]);

  return ContentService.createTextOutput("OK").setMimeType(
    ContentService.MimeType.TEXT,
  );
}

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();

  const headers = data[0];
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

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
