# Plánovaná vylepšení (TODO)

## 🏃‍♂️ Ergonomie při běhu (Mobilní UX)
- [ ] **Haptická odezva (Vibrace)**: přidat `@capacitor/haptics` pro odezvu při stisku tlačítek a událostech (start, stop, odeslání).
- [ ] **Udržení rozsvíceného displeje (Wake Lock)**: implementovat `@capacitor/keep-awake` během nahrávání.
- [ ] **Zvuková signalizace (Pípnutí)**: krátké pípnutí při spuštění a automatickém ukončení nahrávání.

## 📶 Spolehlivost a Offline režim
- [ ] **Správa čekající fronty (Queue UI)**: zobrazení detailů čekajících položek s možností jejich smazání.
- [ ] **Indikátor kvality GPS**: zobrazení přesnosti polohy (např. v metrech) ve stavovém řádku.
- [ ] **Background Fetch (Zápis na pozadí)**: odesílání položek z fronty na pozadí při nalezení signálu.

## 🗺️ Vylepšení webové mapy (Zobrazení dat)
- [ ] **Lightbox pro fotky na mapě**: fullscreen galerie pro zobrazení fotek po kliknutí na miniaturu v mapě.
- [ ] **Spojnice bodů na mapě**: vizualizace reálného postupu nakreslením čáry mezi zaznamenanými body.

## 🛠️ Technický dluh a optimalizace
- [ ] **Přepis do TypeScriptu**: refaktoring `app.js` pro vyšší stabilitu kódu.
