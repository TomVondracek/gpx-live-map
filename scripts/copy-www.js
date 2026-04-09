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

// Zajisti existenci www/
if (!fs.existsSync(WWW)) {
  fs.mkdirSync(WWW, { recursive: true });
}

// app.html → www/index.html (Capacitor entry point)
// Opraví odkaz na mapu: ./index.html → ./map.html
const appHtml = path.join(ROOT, "app.html");
if (fs.existsSync(appHtml)) {
  let content = fs.readFileSync(appHtml, "utf-8");
  content = content.replace(
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

console.log("Web assets copied to www/");
