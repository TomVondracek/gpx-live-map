import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cz.behpoznamky.app",
  appName: "Běh – poznámky",
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
  },
};

export default config;
