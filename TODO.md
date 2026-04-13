# TODO

Priority:

- `P1` = vysoký dopad / vhodné řešit brzy
- `P2` = střední priorita / výrazné zlepšení
- `P3` = nice-to-have / později

## Mobilní aplikace

### Příští úkoly

### Hotovo

- [x] `P1` Přidat klientský `entry_id` ke každé poznámce a připravit payload tak, aby šel bezpečně deduplikovat při retry/offline flush.
- [x] `P2` Přidat výraznější "glove mode" UX: větší tlačítka, vyšší kontrast, méně jemných interakcí.
- [x] Haptická odezva (vibrace): odezva při stisku tlačítek a událostech.
- [x] Wake Lock: udržení rozsvíceného displeje během záznamu.
- [x] Zvuková signalizace: pípnutí při spuštění a ukončení nahrávání.
- [x] Indikátor kvality GPS: barevný badge + průběžný `watchPosition`.
- [x] Správa čekající fronty: bottom sheet panel se seznamem položek a možností smazání.

## Web / Live mapa

### Příští úkoly

- [ ] `P2` Přidat timeline / scrubber pro přehrání průběhu běhu zpětně.
- [ ] `P2` Přidat souhrnný horní panel: poslední známá poloha, stav baterie, čas od posledního kontaktu, aktuální tempo, vzdálenost po trase.
- [ ] `P2` Dopočítávat ETA do cíle a případně na další checkpoint.

### Hotovo

- [x] Lightbox pro fotky na mapě.
- [x] Spojnice bodů na mapě mezi zaznamenanými pozicemi.
- [x] Audio přehrávání přímo z popupu / side panelu.
- [x] Pozastavení refreshe mapy během přehrávání audio poznámky.
- [x] `P1` Přepsat refresh mapy na inkrementální synchronizaci místo pravidelného stahování celého datasetu.
- [x] `P1` Přidat serverovou/klientskou podporu pro `since` / `lastId` / `lastTimestamp`, aby se po 10 s dotahovaly jen nové body.

## Backend / Data / Bezpečnost

### Příští úkoly

- [ ] `P1` Omezit přenos a ukládání tokenů na klientu; navrhnout bezpečnější read-only přístup pro mapu.
- [ ] `P2` Omezit sdílení fotek přes Google Drive a zvážit bezpečnější serving než trvalé `ANYONE_WITH_LINK`.
- [ ] `P2` Optimalizovat `doGet` tak, aby nečetl vždy celý sheet a škáloval i při delším běhu / více záznamech.
- [ ] `P2` Cachovat nebo přesunout získávání počasí, aby se nedělalo při každém `POST`.

### Hotovo

- [x] `P1` Zavést deduplikaci zápisů na backendu podle `entry_id`, aby retry/offline flush nevytvářel duplicitní řádky.
- [x] Service Worker s Background Sync API a fallback flush při `visibilitychange`.
- [x] Serializace audio Blob → Base64 před uložením do offline fronty.
- [x] Ukládání konfigurace pro SW do IndexedDB (`WRITE_TOKEN`, `SHEET_URL`).

## Kód / Architektura / DX

### Příští úkoly

- [ ] `P2` Přidat základní smoke/e2e testy pro hlavní scénáře: online text, offline audio, reconnect flush, foto upload.
- [ ] `P3` Připravit release workflow pro build APK + upload artefaktu.
- [ ] `P3` Přidat export/report z běhu: mapa, timeline, poznámky, galerie, audio odkazy.

### Hotovo

- [x] Build skripty pro kopírování web assets do `www/`.
- [x] Generování ikon a upload APK na Google Drive.
- [x] `P1` Rozdělit `app.js` do menších modulů podle domén (`audio`, `photo`, `gps`, `queue`, `network`, `ui`, `api`).
- [x] `P1` Začít postupný přepis do TypeScriptu od sdílených datových typů a API payloadů.
- [x] `P2` Rozdělit logiku live mapy z `index.html` do samostatného JS souboru / modulů.
