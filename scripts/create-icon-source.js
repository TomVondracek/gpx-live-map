const sharp = require("sharp");
const path = require("path");

const size = 1024;

// Launcher ikona musí fungovat v kruhové/squircle masce.
// Proto je hlavní motiv umístěný do kruhového medailonu uprostřed
// a okolí zůstává transparentní.

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

  <!-- Transparent canvas + centrální medailon -->
  <circle cx="512" cy="512" r="348" fill="url(#grad-bg)"/>
  <circle cx="512" cy="512" r="336" fill="none" stroke="url(#grad-track)" stroke-width="10" opacity="0.6"/>
  <circle cx="512" cy="512" r="308" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4"/>

  <!-- GPS trasa uvnitř medailonu -->
  <path d="M 348 640
           C 386 594, 422 560, 466 525
           C 520 482, 568 448, 612 414
           C 654 382, 688 344, 718 288"
        fill="none" stroke="url(#grad-track)" stroke-width="30"
        stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Waypointy na trase -->
  <circle cx="468" cy="524" r="18" fill="#22d3ee"/>
  <circle cx="594" cy="428" r="18" fill="#22d3ee"/>
  <circle cx="650" cy="382" r="18" fill="#22d3ee"/>

  <!-- Cílový bod (větší, zelený) -->
  <circle cx="718" cy="288" r="28" fill="#86efac"/>
  <!-- Vnitřní tečka cílového bodu -->
  <circle cx="718" cy="288" r="11" fill="#0f0f1a"/>

  <!-- Startovní bod (modrý kroužek) -->
  <circle cx="348" cy="640" r="24" fill="none" stroke="#3b82f6" stroke-width="12"/>
  <circle cx="348" cy="640" r="9" fill="#3b82f6"/>

  <!-- Elevační profil / waveform v dolní části medailonu -->
  <path d="M 382 722
           Q 406 692, 430 722
           Q 454 748, 478 722
           Q 502 688, 526 722
           Q 550 748, 574 722
           Q 598 694, 622 722
           Q 646 746, 670 722"
        fill="none" stroke="white" stroke-width="16"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
</svg>`;

sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toFile(path.join(__dirname, "..", "icon-source.png"))
  .then(() => console.log("icon-source.png created (" + size + "x" + size + ")"))
  .catch((e) => { console.error(e); process.exit(1); });
