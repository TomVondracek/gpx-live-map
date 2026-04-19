/**
 * Resizes the UltraLog app icon to all required Android mipmap densities.
 * Source: icon-source.png (must be placed in project root)
 * 
 * Android launcher icon sizes:
 *   mdpi:    48x48
 *   hdpi:    72x72
 *   xhdpi:   96x96
 *   xxhdpi:  144x144
 *   xxxhdpi: 192x192
 *
 * Adaptive foreground layer needs extra 18% bleed (safe zone is 66% of canvas):
 *   mdpi:    108x108  (but we use same as launcher for simplicity with legacy icons)
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "icon-source.png");
const RES = path.join(ROOT, "android", "app", "src", "main", "res");

const DENSITIES = [
  { dir: "mipmap-mdpi",    size: 48  },
  { dir: "mipmap-hdpi",    size: 72  },
  { dir: "mipmap-xhdpi",   size: 96  },
  { dir: "mipmap-xxhdpi",  size: 144 },
  { dir: "mipmap-xxxhdpi", size: 192 },
];

// Adaptive foreground sizes (with 18% bleed = size * 108/72 ratio)
const ADAPTIVE_DENSITIES = [
  { dir: "mipmap-mdpi",    size: 108 },
  { dir: "mipmap-hdpi",    size: 162 },
  { dir: "mipmap-xhdpi",   size: 216 },
  { dir: "mipmap-xxhdpi",  size: 324 },
  { dir: "mipmap-xxxhdpi", size: 432 },
];
const ADAPTIVE_SAFE_RATIO = 72 / 108;

async function generateIcons() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source icon not found: ${SRC}`);
    process.exit(1);
  }

  // Get source image metadata to find center crop square
  const meta = await sharp(SRC).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.round((meta.width - side) / 2);
  const top = Math.round((meta.height - side) / 2);

  console.log(`Source: ${meta.width}x${meta.height}, cropping ${side}x${side} from (${left},${top})`);

  for (const { dir, size } of DENSITIES) {
    const outDir = path.join(RES, dir);
    fs.mkdirSync(outDir, { recursive: true });

    // ic_launcher.png (square)
    await sharp(SRC)
      .extract({ left, top, width: side, height: side })
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, "ic_launcher.png"));

    // ic_launcher_round.png (circle mask)
    const circle = Buffer.from(
      `<svg><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></svg>`
    );
    await sharp(SRC)
      .extract({ left, top, width: side, height: side })
      .resize(size, size)
      .composite([{ input: circle, blend: "dest-in" }])
      .png()
      .toFile(path.join(outDir, "ic_launcher_round.png"));

    console.log(`  ${dir}: ic_launcher.png + ic_launcher_round.png (${size}x${size})`);
  }

  // Adaptive foreground (larger canvas for bleed zone)
  for (const { dir, size } of ADAPTIVE_DENSITIES) {
    const outDir = path.join(RES, dir);
    fs.mkdirSync(outDir, { recursive: true });
    const safeSize = Math.round(size * ADAPTIVE_SAFE_RATIO);

    await sharp(SRC)
      .extract({ left, top, width: side, height: side })
      .resize(safeSize, safeSize)
      .extend({
        top: Math.floor((size - safeSize) / 2),
        bottom: Math.ceil((size - safeSize) / 2),
        left: Math.floor((size - safeSize) / 2),
        right: Math.ceil((size - safeSize) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(outDir, "ic_launcher_foreground.png"));

    console.log(`  ${dir}: ic_launcher_foreground.png (${size}x${size}, safe content ${safeSize}x${safeSize})`);
  }

  console.log("\nAll icons generated successfully.");
}

generateIcons().catch(err => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
