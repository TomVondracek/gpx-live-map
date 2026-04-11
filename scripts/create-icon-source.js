const sharp = require("sharp");
const path = require("path");

const size = 1024;

// Bezpečná plocha pro obsah: zaoblení rx=230 ořízne rohy ~160px od každého rohu.
// Obsah držíme v zóně x: 210–814, y: 210–814 (padding ~210px).
//
// Design: GPS trasa (modrá→zelená, diagonálně) + waveform/elevační profil (bílý, střed-dolní).
// Jednoduché, čitelné i na 48px.

const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad-track" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#86efac"/>
    </linearGradient>
    <linearGradient id="grad-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#0f0f1a"/>
      <stop offset="100%" stop-color="#151528"/>
    </linearGradient>
  </defs>

  <!-- Pozadí -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="230" ry="230" fill="url(#grad-bg)"/>

  <!-- Jemný vnitřní rámeček (gradient, tenký) -->
  <rect x="24" y="24" width="${size - 48}" height="${size - 48}" rx="210" ry="210"
        fill="none" stroke="url(#grad-track)" stroke-width="8" opacity="0.5"/>

  <!-- GPS trasa: diagonálně z levého-dolního středu do pravého-horního středu.
       Vychází z (240,740) a končí na (784,240) — oba body daleko od rohů. -->
  <path d="M 240 740
           C 290 680, 330 640, 390 590
           C 450 540, 500 510, 560 470
           C 620 430, 670 390, 720 350
           C 750 325, 770 300, 784 260"
        fill="none" stroke="url(#grad-track)" stroke-width="28"
        stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Waypointy na trase -->
  <circle cx="390" cy="590" r="20" fill="#22d3ee"/>
  <circle cx="560" cy="470" r="20" fill="#22d3ee"/>
  <circle cx="720" cy="350" r="20" fill="#22d3ee"/>

  <!-- Cílový bod (větší, zelený) -->
  <circle cx="784" cy="260" r="30" fill="#86efac"/>
  <!-- Vnitřní tečka cílového bodu -->
  <circle cx="784" cy="260" r="12" fill="#0f0f1a"/>

  <!-- Startovní bod (modrý kroužek) -->
  <circle cx="240" cy="740" r="26" fill="none" stroke="#3b82f6" stroke-width="14"/>
  <circle cx="240" cy="740" r="10" fill="#3b82f6"/>

  <!-- Elevační profil / waveform — v dolní třetině, centrovaný, mimo rohy.
       Osa y=820, rozsah x: 260–764 — v bezpečné zóně. -->
  <path d="M 260 820
           Q 290 780, 320 820
           Q 350 860, 380 820
           Q 410 775, 440 820
           Q 470 858, 500 820
           Q 530 782, 560 820
           Q 590 852, 620 820
           Q 650 790, 680 820
           Q 710 845, 740 820
           Q 752 808, 764 820"
        fill="none" stroke="white" stroke-width="14"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
</svg>`;

sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toFile(path.join(__dirname, "..", "icon-source.png"))
  .then(() => console.log("icon-source.png created (" + size + "x" + size + ")"))
  .catch((e) => { console.error(e); process.exit(1); });
