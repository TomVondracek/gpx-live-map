/**
 * upload-apk.js — Nahraje debug APK na Google Drive
 *
 * SETUP (jednorázový):
 * 1. V Google Cloud Console vytvoř Service Account:
 *    https://console.cloud.google.com/iam-admin/serviceaccounts
 *    - Projekt: libovolný (nebo vytvoř nový)
 *    - Role: není potřeba (přístup k Drive se dá přes sdílení složky)
 *    - Vygeneruj JSON klíč → ulož jako: C:\DEV\gpx-live-map\gdrive-service-account.json
 *
 * 2. Sdílej cílovou Google Drive složku se Service Accountem:
 *    - Otevři složku na drive.google.com
 *    - Sdílet → přidej email Service Accountu (z JSON pole "client_email")
 *    - Oprávnění: Editor
 *
 * 3. Spusť: node scripts/upload-apk.js
 *
 * BEZPEČNOST:
 *    gdrive-service-account.json je v .gitignore — nikdy nejde do repozitáře!
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const CREDENTIALS_PATH = path.join(__dirname, "..", "gdrive-service-account.json");
const APK_PATH = path.join(
  __dirname, "..",
  "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"
);
const DRIVE_FOLDER_ID = "1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj";
const APK_FILENAME = "UltraLog-debug.apk";

async function uploadApk() {
  // Zkontroluj existence souborů
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`\nChybí credentials soubor: ${CREDENTIALS_PATH}`);
    console.error("Viz komentář v upload-apk.js pro setup instrukce.");
    process.exit(1);
  }
  if (!fs.existsSync(APK_PATH)) {
    console.error(`\nAPK soubor nenalezen: ${APK_PATH}`);
    console.error("Nejprve proveď build: cd android && .\\gradlew assembleDebug");
    process.exit(1);
  }

  // Autentizace přes Service Account
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const apkSize = fs.statSync(APK_PATH).size;
  console.log(`Nahrávám ${APK_FILENAME} (${(apkSize / 1024 / 1024).toFixed(1)} MB)...`);

  // Zkontroluj, zda soubor s tímto názvem ve složce již existuje
  const listRes = await drive.files.list({
    q: `name='${APK_FILENAME}' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`,
    fields: "files(id, name)",
  });
  const existing = listRes.data.files;

  let result;
  if (existing && existing.length > 0) {
    // Aktualizuj existující soubor (zachová stejné URL/sdílení)
    const fileId = existing[0].id;
    result = await drive.files.update({
      fileId,
      media: {
        mimeType: "application/vnd.android.package-archive",
        body: fs.createReadStream(APK_PATH),
      },
    });
    console.log(`Aktualizován existující soubor (id: ${fileId})`);
  } else {
    // Nahraj jako nový soubor
    result = await drive.files.create({
      requestBody: {
        name: APK_FILENAME,
        parents: [DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/vnd.android.package-archive",
        body: fs.createReadStream(APK_PATH),
      },
      fields: "id, name, webViewLink",
    });
    console.log(`Nový soubor nahrán (id: ${result.data.id})`);
  }

  console.log(`\nHotovo! APK je dostupné v Google Drive složce:`);
  console.log(`https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`);
}

uploadApk().catch((err) => {
  console.error("\nChyba při nahrávání:", err.message || err);
  process.exit(1);
});
