# Plánovaná vylepšení (TODO)

## 🏃‍♂️ Ergonomie při běhu (Mobilní UX)
- [x] **Haptická odezva (Vibrace)**: přidat `@capacitor/haptics` pro odezvu při stisku tlačítek a událostech (start, stop, odeslání).
- [x] **Udržení rozsvíceného displeje (Wake Lock)**: implementováno přes Screen Wake Lock API (`navigator.wakeLock`).
- [x] **Zvuková signalizace (Pípnutí)**: krátké pípnutí při spuštění a automatickém ukončení nahrávání (Web Audio API).

## 📶 Spolehlivost a Offline režim
- [x] **Správa čekající fronty (Queue UI)**: bottom sheet panel se seznamem čekajících položek a možností smazání.
- [x] **Indikátor kvality GPS**: barevný badge (zelená/žlutá/červená) ve stavovém řádku, kontinuální watchPosition s 10s intervalem, cache GPS fixu pro rychlé odesílání.
- [x] **Background Fetch (Zápis na pozadí)**: Service Worker s Background Sync API (tag: flush-queue); audio Blob serializován před enqueue; WRITE_TOKEN/SHEET_URL v IDB config store; pojistka visibilitychange→visible.

## 🗺️ Vylepšení webové mapy (Zobrazení dat)
- [x] **Lightbox pro fotky na mapě**: fullscreen galerie pro zobrazení fotek po kliknutí na miniaturu v mapě.
- [ ] **Spojnice bodů na mapě**: vizualizace reálného postupu nakreslením čáry mezi zaznamenanými body.

## 🛠️ Technický dluh a optimalizace
- [ ] **Přepis do TypeScriptu**: refaktoring `app.js` pro vyšší stabilitu kódu.
