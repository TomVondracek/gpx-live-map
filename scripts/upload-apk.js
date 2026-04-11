/**
 * upload-apk.js — Nahraje debug APK na Google Drive (OAuth2)
 *
 * SETUP (jednorázový):
 * 1. V Google Cloud Console vytvoř OAuth2 Desktop credentials:
 *    https://console.cloud.google.com/apis/credentials
 *    - "Create Credentials" → "OAuth client ID" → "Desktop app"
 *    - Stáhni JSON → ulož jako: C:\DEV\gpx-live-map\gdrive-oauth-client.json
 *
 * 2. Povol Google Drive API:
 *    https://console.cloud.google.com/apis/library/drive.googleapis.com
 *
 * 3. Při prvním spuštění: npm run upload-apk
 *    - Skript otevře autorizační URL, přihlaš se svým Google účtem
 *    - Zkopíruj kód a vlož do terminálu
 *    - Token se uloží do .gdrive-token.json (automaticky pro další spuštění)
 *
 * BEZPEČNOST:
 *    gdrive-oauth-client.json a .gdrive-token.json jsou v .gitignore!
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const http = require("http");

const CREDENTIALS_PATH = path.join(__dirname, "..", "gdrive-service-account.json");
const OAUTH_CLIENT_PATH = path.join(__dirname, "..", "gdrive-oauth-client.json");
const TOKEN_PATH = path.join(__dirname, "..", ".gdrive-token.json");
const APK_PATH = path.join(
  __dirname, "..",
  "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"
);
const DRIVE_FOLDER_ID = "1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj";
const APK_FILENAME = "UltraLog-debug.apk";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

// ── Získání OAuth2 klienta ───────────────────────────────────────────────────

async function getOAuthClient() {
  // Prefer OAuth2 client credentials if available
  if (fs.existsSync(OAUTH_CLIENT_PATH)) {
    const raw = JSON.parse(fs.readFileSync(OAUTH_CLIENT_PATH, "utf-8"));
    const { client_id, client_secret, redirect_uris } = raw.installed || raw.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
      oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")));
      return oAuth2Client;
    }

    // První spuštění — vyžádej autorizaci
    return await authorizeOAuth(oAuth2Client);
  }

  // Fallback: Service Account (funguje jen na Shared Drive)
  if (fs.existsSync(CREDENTIALS_PATH)) {
    console.log("Používám Service Account...");
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
    return new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
  }

  console.error("\nChybí credentials soubor.");
  console.error("Potřebuješ buď:");
  console.error("  A) gdrive-oauth-client.json (OAuth2 Desktop App) — doporučeno pro osobní Drive");
  console.error("  B) gdrive-service-account.json (Service Account) — pro Shared Drive");
  process.exit(1);
}

async function authorizeOAuth(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });

  console.log("\n── OAuth2 autorizace ─────────────────────────────────────────");
  console.log("Otevři tuto URL v prohlížeči a přihlas se svým Google účtem:\n");
  console.log(authUrl);
  console.log("\n──────────────────────────────────────────────────────────────");

  // Pokus o otevření prohlížeče automaticky
  try {
    const { exec } = require("child_process");
    exec(`start "" "${authUrl}"`);
    console.log("(Prohlížeč byl otevřen automaticky)");
  } catch {}

  const code = await askQuestion("\nVlož autorizační kód z prohlížeče: ");
  const { tokens } = await oAuth2Client.getToken(code.trim());
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Token uložen: ${TOKEN_PATH}`);
  return oAuth2Client;
}

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans); }));
}

// ── Hlavní upload logika ─────────────────────────────────────────────────────

async function uploadApk() {
  if (!fs.existsSync(APK_PATH)) {
    console.error(`\nAPK soubor nenalezen: ${APK_PATH}`);
    console.error("Nejprve proveď build: cd android && .\\gradlew assembleDebug");
    process.exit(1);
  }

  const auth = await getOAuthClient();
  const drive = google.drive({ version: "v3", auth });

  const apkSize = fs.statSync(APK_PATH).size;
  console.log(`\nNahrávám ${APK_FILENAME} (${(apkSize / 1024 / 1024).toFixed(1)} MB)...`);

  // Zkontroluj, zda soubor s tímto názvem ve složce již existuje
  const listRes = await drive.files.list({
    q: `name='${APK_FILENAME}' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = listRes.data.files;

  let fileId;
  if (existing && existing.length > 0) {
    // Aktualizuj existující soubor (zachová stejné URL/sdílení)
    fileId = existing[0].id;
    await drive.files.update({
      fileId,
      media: {
        mimeType: "application/vnd.android.package-archive",
        body: fs.createReadStream(APK_PATH),
      },
      supportsAllDrives: true,
    });
    console.log(`Aktualizován existující soubor (id: ${fileId})`);
  } else {
    // Nahraj jako nový soubor
    const createRes = await drive.files.create({
      requestBody: {
        name: APK_FILENAME,
        parents: [DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "application/vnd.android.package-archive",
        body: fs.createReadStream(APK_PATH),
      },
      fields: "id",
      supportsAllDrives: true,
    });
    fileId = createRes.data.id;
    console.log(`Nový soubor nahrán (id: ${fileId})`);
  }

  console.log(`\nHotovo! APK dostupné na:`);
  console.log(`https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`);
}

uploadApk().catch((err) => {
  console.error("\nChyba při nahrávání:", err.message || err);
  process.exit(1);
});
