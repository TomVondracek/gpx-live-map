const sharp = require("sharp");
const path = require("path");

const size = 1024;

const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="50%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#86efac"/>
    </linearGradient>
    <linearGradient id="track" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#86efac"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="230" ry="230" fill="#0f0f1a"/>
  <rect x="18" y="18" width="${size - 36}" height="${size - 36}" rx="215" ry="215"
        fill="none" stroke="url(#border)" stroke-width="28"/>
  <path d="M 160 720 C 200 680 220 600 300 560 C 380 520 400 480 460 440
           C 520 400 560 360 620 320 C 680 280 720 300 760 260
           C 800 220 820 200 860 180"
        fill="none" stroke="url(#track)" stroke-width="22"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="300" cy="560" r="22" fill="#22d3ee"/>
  <circle cx="460" cy="440" r="22" fill="#22d3ee"/>
  <circle cx="620" cy="320" r="22" fill="#22d3ee"/>
  <circle cx="860" cy="180" r="28" fill="#86efac"/>
  <path d="M 140 800 Q 170 750 200 800 Q 230 850 260 800 Q 290 720 320 800
           Q 350 870 380 800 Q 410 730 440 800 Q 470 860 500 800
           Q 530 750 560 800 Q 590 840 620 800 Q 650 770 680 800
           Q 710 820 740 800 Q 760 790 780 800"
        fill="none" stroke="white" stroke-width="16" stroke-linecap="round" opacity="0.85"/>
  <rect x="800" y="640" width="60" height="90" rx="30" ry="30"
        fill="none" stroke="#86efac" stroke-width="16"/>
  <line x1="830" y1="730" x2="830" y2="775" stroke="#86efac" stroke-width="16" stroke-linecap="round"/>
  <path d="M 800 710 Q 765 710 765 755 Q 765 810 830 810 Q 895 810 895 755 Q 895 710 860 710"
        fill="none" stroke="#86efac" stroke-width="16" stroke-linecap="round"/>
</svg>`;

sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toFile(path.join(__dirname, "..", "icon-source.png"))
  .then(() => console.log("icon-source.png created (" + size + "x" + size + ")"))
  .catch((e) => { console.error(e); process.exit(1); });
