/**
 * Kopíruje web assets z kořene projektu do www/ pro Capacitor.
 * Spouštěno automaticky před cap sync/run.
 *
 * DŮLEŽITÉ: app.html se kopíruje jako index.html (Capacitor entry point).
 * Původní index.html (mapa) se kopíruje jako map.html.
 * Odkaz na mapu se v index.html automaticky opraví.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "www");
const DEFAULT_RUNTIME_CONFIG = "window.RUN_NOTES_CONFIG = window.RUN_NOTES_CONFIG || {};\n";

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Zajisti existenci www/
if (!fs.existsSync(WWW)) {
  fs.mkdirSync(WWW, { recursive: true });
}

// app.html → www/index.html (Capacitor entry point)
// Opraví odkaz na mapu: ./index.html → ./map.html
const appHtml = path.join(ROOT, "app.html");
if (fs.existsSync(appHtml)) {
  let content = fs.readFileSync(appHtml, "utf-8");
  content = content.replaceAll(
    'href="./index.html"',
    'href="./map.html"'
  );
  fs.writeFileSync(path.join(WWW, "index.html"), content, "utf-8");
  console.log("  app.html -> www/index.html (Capacitor entry point, map link fixed)");
}

// app.js → www/app.js
const appJs = path.join(ROOT, "app.js");
if (fs.existsSync(appJs)) {
  fs.copyFileSync(appJs, path.join(WWW, "app.js"));
  console.log("  app.js -> www/app.js");
}

// app/ → www/app/ (rozsekané mobilní moduly)
const appDir = path.join(ROOT, "app");
if (fs.existsSync(appDir)) {
  copyDirRecursive(appDir, path.join(WWW, "app"));
  console.log("  app -> www/app");
}

// sw.js → www/sw.js (Service Worker pro Background Sync)
const swJs = path.join(ROOT, "sw.js");
if (fs.existsSync(swJs)) {
  fs.copyFileSync(swJs, path.join(WWW, "sw.js"));
  console.log("  sw.js -> www/sw.js");
}

// runtime-config.js → www/runtime-config.js (lokální runtime konfigurace, pokud existuje)
const runtimeConfig = path.join(ROOT, "runtime-config.js");
const runtimeConfigTarget = path.join(WWW, "runtime-config.js");
if (fs.existsSync(runtimeConfig)) {
  fs.copyFileSync(runtimeConfig, runtimeConfigTarget);
  console.log("  runtime-config.js -> www/runtime-config.js");
} else {
  fs.writeFileSync(runtimeConfigTarget, DEFAULT_RUNTIME_CONFIG, "utf-8");
  console.log("  generated www/runtime-config.js (empty default config)");
}

// index.html → www/map.html (mapa — přístupná přes odkaz v appce)
const mapHtml = path.join(ROOT, "index.html");
if (fs.existsSync(mapHtml)) {
  fs.copyFileSync(mapHtml, path.join(WWW, "map.html"));
  console.log("  index.html -> www/map.html");
}

// trasa.gpx
const gpx = path.join(ROOT, "trasa.gpx");
if (fs.existsSync(gpx)) {
  fs.copyFileSync(gpx, path.join(WWW, "trasa.gpx"));
  console.log("  trasa.gpx -> www/trasa.gpx");
}

// vendor/ → www/vendor/ (lokální JS/CSS/assets pro offline mapu)
const vendorDir = path.join(ROOT, "vendor");
if (fs.existsSync(vendorDir)) {
  copyDirRecursive(vendorDir, path.join(WWW, "vendor"));
  console.log("  vendor -> www/vendor");
}

console.log("Web assets copied to www/");
