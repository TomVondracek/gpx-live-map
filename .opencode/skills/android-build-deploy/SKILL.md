---
name: android-build-deploy
description: Complete deploy workflow for this UltraLog repository in OpenCode. Use when OpenCode should build the mobile app, sync Capacitor assets, rebuild the Android APK, upload it to Google Drive, update README deploy status, commit the intended repo changes, and send the final ntfy notification to ntfy.sh/OpenCode_done.
---

# Android Build Deploy

Použij jednotný repo deploy engine místo ručního skládání jednotlivých kroků.

## Workflow

1. Zkontroluj `git status --short`.
2. Pokud jsou v repu změny, které nepatří k aktuálnímu úkolu, zastav se a zeptej se uživatele.
3. Pokud změny patří k aktuálnímu úkolu, stageuj je:

```powershell
git add -A
```

4. Spusť kompletní deploy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-complete.ps1 -Agent opencode -StageAllWorktreeChanges
```

## Guarantees

- Deploy skript dělá `npm run build`, `npx cap sync android`, Gradle rebuild, upload na Drive, update README, commit a ntfy notifikaci.
- Když Gradle rebuild selže, workflow se zastaví, nic se nenahraje na Google Drive a pošle se failure notifikace.
- Úspěšný běh končí notifikací na `ntfy.sh/OpenCode_done`.

## Source of Truth

- Workflow je definovaný v `scripts/deploy-complete.ps1`.
- README status se aktualizuje přes `scripts/update-readme-deploy.ps1`.
- Notifikace se odesílá přes `scripts/send-ntfy.ps1`.
