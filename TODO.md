# TODO

## Mobilní aplikace

## Web / Live mapa

## Backend / Data / Bezpečnost

- [ ] `P1` Omezit přenos a ukládání tokenů na klientu; navrhnout bezpečnější read-only přístup pro mapu.
- [ ] `P2` Omezit sdílení fotek přes Google Drive a zvážit bezpečnější serving než trvalé `ANYONE_WITH_LINK`.
- [ ] `P2` Optimalizovat `doGet` tak, aby nečetl vždy celý sheet a škáloval i při delším běhu / více záznamech.
- [ ] `P2` Cachovat nebo přesunout získávání počasí, aby se nedělalo při každém `POST`.

## Kód / Architektura / DX

- [ ] `P2` Přidat základní smoke/e2e testy pro hlavní scénáře: online text, offline audio, reconnect flush, foto upload.
- [ ] `P3` Připravit release workflow pro build APK + upload artefaktu.
- [ ] `P3` Přidat export/report z běhu: mapa, timeline, poznámky, galerie, audio odkazy.
