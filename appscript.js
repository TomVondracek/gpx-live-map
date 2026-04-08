function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.time,
    data.lat,
    data.lon,
    data.note,
    data.battery ?? "",
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
    battery: row[4] !== "" && row[4] !== null ? parseInt(row[4], 10) : null,
  }));

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
