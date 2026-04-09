/**
 * Stáhne a rozbalí český Vosk model do android/app/src/main/assets/models/.
 * 
 * Spouštění: node scripts/download-vosk-model.js
 * 
 * Model: vosk-model-small-cs-0.4-rhasspy (~40MB)
 * Zdroj: https://alphacephei.com/vosk/models
 */
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-cs-0.4-rhasspy.zip";
const DEST_DIR = path.resolve(__dirname, "..", "android", "app", "src", "main", "assets", "models");
const MODEL_DIR_NAME = "vosk-model-small-cs";
const ZIP_PATH = path.join(DEST_DIR, "model.zip");

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Stahuji ${url}...`);

    const makeRequest = (requestUrl) => {
      const client = requestUrl.startsWith("https") ? https : http;
      client.get(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`Redirect -> ${response.headers.location}`);
          makeRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;

        const file = fs.createWriteStream(dest);
        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r  ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        response.pipe(file);

        file.on("finish", () => {
          file.close();
          console.log("\n  Staženo.");
          resolve();
        });

        file.on("error", (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
      }).on("error", reject);
    };

    makeRequest(url);
  });
}

async function main() {
  // Zkontroluj, jestli model už existuje
  const modelPath = path.join(DEST_DIR, MODEL_DIR_NAME);
  if (fs.existsSync(modelPath) && fs.readdirSync(modelPath).length > 0) {
    console.log(`Model už existuje v ${modelPath}`);
    console.log("Pro přestažení smaž složku a spusť znovu.");
    return;
  }

  // Vytvoř cílový adresář
  fs.mkdirSync(DEST_DIR, { recursive: true });

  // Stáhni zip
  await downloadFile(MODEL_URL, ZIP_PATH);

  // Rozbal
  console.log("Rozbaluji model...");

  // Použij PowerShell pro rozbalení (Windows)
  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${DEST_DIR}' -Force"`,
      { stdio: "inherit" }
    );
  } catch (e) {
    // Zkus tar jako zálohu
    try {
      execSync(`tar -xf "${ZIP_PATH}" -C "${DEST_DIR}"`, { stdio: "inherit" });
    } catch (e2) {
      console.error("Nepodařilo se rozbalit. Nainstaluj 7-zip nebo rozbal ručně.");
      process.exit(1);
    }
  }

  // Přejmenuj extrahovaný adresář
  const entries = fs.readdirSync(DEST_DIR).filter(
    (e) => e !== "model.zip" && fs.statSync(path.join(DEST_DIR, e)).isDirectory()
  );

  if (entries.length === 1 && entries[0] !== MODEL_DIR_NAME) {
    const extractedDir = path.join(DEST_DIR, entries[0]);
    const targetDir = path.join(DEST_DIR, MODEL_DIR_NAME);
    fs.renameSync(extractedDir, targetDir);
    console.log(`  Přejmenováno: ${entries[0]} -> ${MODEL_DIR_NAME}`);
  }

  // Smaž zip
  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }

  // Ověř
  const finalPath = path.join(DEST_DIR, MODEL_DIR_NAME);
  if (fs.existsSync(finalPath) && fs.readdirSync(finalPath).length > 0) {
    const files = fs.readdirSync(finalPath);
    console.log(`\nModel úspěšně nainstalován do ${finalPath}`);
    console.log(`Obsah: ${files.join(", ")}`);

    // Vypočítej velikost
    let totalSize = 0;
    const calcSize = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) calcSize(fp);
        else totalSize += stat.size;
      }
    };
    calcSize(finalPath);
    console.log(`Celková velikost: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  } else {
    console.error("CHYBA: Model nebyl správně rozbalený.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Chyba:", e.message);
  process.exit(1);
});
