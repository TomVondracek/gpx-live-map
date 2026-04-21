import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cz.behpoznamky.app",
  appName: "UltraLog",
  webDir: "www",
  android: {
    // Povolit mixed content (HTTP + HTTPS) pro Google Apps Script
    allowMixedContent: true,
  },
  server: {
    // Povolit navigaci na Google Apps Script endpoint
    allowNavigation: ["script.google.com"],
  },
  plugins: {
    StatusBar: {
      backgroundColor: "#1a1a2e",
      style: "DARK",
    },
    BackgroundRunner: {
      label: "cz.behpoznamky.app.background",
      src: "runner.js",
      event: "trackPoint",
      // Android WorkManager opakuje background task nejdříve po 15 minutách.
      // Jemnější intervaly držíme jen ve foregroundu přes setInterval.
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
