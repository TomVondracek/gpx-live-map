# Implementační plán: Multi-user platforma (Railway + Backblaze B2)

Vytvořeno: 2026-04-22  
Status: **Připraveno k implementaci**

---

## Cíl

Přetvořit UltraLog z osobní single-user appky na platformu, kde si každý
turista/běžec vytvoří "akci" (přechod hor, závod, túra), nahraje GPX trasu,
sleduje průběh přes Android appku a sdílí veřejný link na mapu rodině.

---

## Výsledný stack

| Vrstva | Technologie | Cena |
|---|---|---|
| Backend API | Node.js/Fastify na Railway | $5/měsíc |
| Databáze | PostgreSQL na Railway | součástí $5 |
| Storage (fotky, audio, GPX) | Backblaze B2 + Cloudflare CDN | $0 (10 GB free, egress zdarma) |
| Web onboarding UI | Cloudflare Pages (statický Next.js nebo plain HTML) | $0 |
| Observer mapa | Cloudflare Pages (stávající kód) | $0 |
| Android appka | Stávající Capacitor app (minimální změny) | $0 |
| Google Play | Google Play Developer Account | $25 jednorázově |
| Doména | dle výběru (.cz ~200 Kč/rok) | ~$1/měsíc |

**Celkem: ~$6/měsíc (~140 Kč)**

---

## Datový model (PostgreSQL)

```sql
-- Uživatelé (volitelné — pro historii akcí)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Akce (túra, přechod hor, závod, ...)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL, -- nullable = anonymní akce
  slug TEXT UNIQUE NOT NULL,          -- např. "jan-krkonose-2026-07"
  name TEXT NOT NULL,                 -- "Přechod Krkonoš"
  description TEXT,
  gpx_path TEXT,                      -- cesta v Backblaze B2
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  write_token TEXT NOT NULL,          -- runner zná, náhodný UUID
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Záznamy z trasy (port stávajících řádků z Google Sheets)
CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  entry_id TEXT UNIQUE,               -- klientský dedup ID (stávající logika)
  time TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  note TEXT,
  entry_type TEXT,                    -- 'text' | 'audio' | 'photo' | 'track'
  battery INTEGER,
  speed DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  gps_accuracy DOUBLE PRECISION,
  audio_path TEXT,                    -- cesta v B2
  audio_mime TEXT,
  audio_duration_sec INTEGER,
  photo_path TEXT,                    -- cesta v B2
  weather_temp DOUBLE PRECISION,
  weather_code INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Fáze implementace

---

### Fáze 1 — Backend API (Railway + Node.js/Fastify)

**Odhadovaný čas: 4–6 hodin**

#### 1.1 Railway projekt

- Vytvořit účet na [railway.app](https://railway.app)
- Nový projekt: přidat PostgreSQL service + Node.js service
- Propojit s GitHub repem (auto-deploy na push)

#### 1.2 Node.js/Fastify API

Struktura:
```
backend/
  src/
    index.ts          -- Fastify server entry point
    db.ts             -- PostgreSQL connection (pg / postgres.js)
    storage.ts        -- Backblaze B2 S3-compatible client (@aws-sdk/client-s3)
    routes/
      activities.ts   -- POST /activities, GET /activities/:slug
      entries.ts      -- POST /entries, GET /entries?activity=:slug&since=
      media.ts        -- POST /media/upload (signed URL nebo přímý upload)
    middleware/
      auth.ts         -- ověření write_token z body nebo hlavičky
  package.json
  tsconfig.json
```

#### 1.3 API endpointy (port z appscript.js)

```
POST /activities
  body: { name, description, starts_at, ends_at }
  → vygeneruje slug + write_token
  → vrátí { activity_id, slug, write_token, map_url, setup_url }

GET /activities/:slug
  → vrátí metadata akce + gpx_url pro mapu

POST /activities/:slug/gpx
  header: Authorization: Bearer <write_token>
  body: multipart GPX soubor
  → upload do B2, uloží gpx_path

POST /entries
  header: Authorization: Bearer <write_token>
  body: stejná struktura jako stávající GAS POST
        { activity_slug, time, lat, lon, note, entry_type,
          battery, speed, altitude, gps_accuracy, entry_id,
          photo_base64?, audio_base64? }
  → deduplika přes entry_id
  → media upload do B2 (dekódovat base64 → uložit jako soubor)
  → fetch weather z Open-Meteo (stejně jako dnes)
  → INSERT do entries

GET /entries?activity=:slug&since=:iso_timestamp
  → vrátí JSON ve stejném formátu jako stávající GAS GET
  → observer mapa toto volá (minimální změna na frontendu)
```

#### 1.4 Backblaze B2 setup

- Vytvořit účet na [backblaze.com](https://www.backblaze.com)
- Nový bucket: `ultralog-media`, nastavit jako Public (pro CDN)
- Vygenerovat Application Key (S3-compatible credentials)
- Propojit bucket s Cloudflare CDN (Cloudflare proxy před B2 = egress zdarma)
  - Postup: přidat CNAME `media.tvoje-domena.cz → B2 bucket endpoint`
  - Tím pádem bandwidth z B2 přes Cloudflare = $0

Struktura složek v B2:
```
ultralog-media/
  {activity_id}/
    gpx/trasa.gpx
    photos/{entry_id}.jpg
    audio/{entry_id}.webm
```

---

### Fáze 2 — Webový onboarding UI

**Odhadovaný čas: 4–6 hodin**

Jednoduchá statická stránka hostovaná na Cloudflare Pages.

#### Stránky / flows:

**`/` — Homepage**
- Krátký popis co appka dělá
- CTA: "Vytvořit novou akci" + "Přihlásit se" (volitelné)

**`/new` — Vytvoření akce**
1. Formulář: název akce, popis, datum start/konec
2. Upload GPX souboru (drag & drop)
3. Volitelné: "Přihlásit se pro historii akcí"
4. Submit → API `POST /activities` + `POST /activities/:slug/gpx`
5. Výsledná stránka:
   - **Link na mapu** (pro rodinu) — velké tlačítko "Zkopírovat" + "Sdílet přes WhatsApp"
   - **QR kód** nebo **deep link** pro nastavení appky
   - Odkaz na Google Play ke stažení appky
   - Instrukce: "Otevři appku, naskenuj QR nebo klikni na odkaz — vše se nastaví automaticky"

**`/a/:slug` — Observer mapa** (přesunout z GitHub Pages sem, nebo ponechat zvlášť)

**`/my` — Moje akce** (jen pro přihlášené uživatele)
- Seznam minulých akcí s linky na mapy

#### Tech stack pro UI:
- **Čistý HTML/JS + Tailwind CDN** — nejjednodušší, žádný build step
- Nebo **Next.js** pokud se plánuje složitější UI

---

### Fáze 3 — Android appka (minimální změny)

**Odhadovaný čas: 2–3 hodiny**

#### 3.1 Změna API endpointu

V `shared/project-config.ts` nebo `runtime-config.js`:
```ts
// Stávající
const SHEET_URL = "https://script.google.com/macros/s/.../exec";

// Nové
const API_URL = "https://api.tvoje-domena.cz";
```

Změna v `app/api.ts`:
- `directPost()` → POST na `${API_URL}/entries` místo SHEET_URL
- Authorization header: `Bearer ${WRITE_TOKEN}` místo tokenu v body
  (nebo ponechat token v body pro zpětnou kompatibilitu — API oboje podporuje)

#### 3.2 Deep link / QR setup

Přidat support pro `ultralog://setup?token=xxx&activity=yyy&api=zzz`:
- Android Intent filter v `AndroidManifest.xml`
- Handler v `app.js` při startu: pokud přijde deep link, automaticky uloží
  `WRITE_TOKEN`, `ACTIVITY_SLUG` a `API_URL` do IndexedDB
- Uživatel nemusí nic ručně konfigurovat

#### 3.3 Komprese fotek před uploadem

V `app/photo.ts`:
- Přidat canvas resize na max 1200px + JPEG quality 0.75
- Před odesláním → výrazně menší soubory (300 KB místo 3 MB)
- Ušetří storage a bandwidth

#### 3.4 Activity slug v každém requestu

Každý entry POST musí obsahovat `activity_slug` (nebo `activity_id`):
- Přidat do `buildBasePayload()` v `app/api.ts`
- Hodnota se načte z IDB config (uloží se při QR setup nebo ručním nastavení)

---

### Fáze 4 — Observer mapa (minimální změny)

**Odhadovaný čas: 1–2 hodiny**

#### 4.1 Nový API endpoint

V `map/data.js`:
```js
// Stávající
const url = buildGASUrl({ since: lastSync });

// Nové
const url = `${API_URL}/entries?activity=${activitySlug}&since=${lastSync}`;
```

Parametry akce (`API_URL`, `activitySlug`) se načtou z URL:
- `map.tvoje-domena.cz/a/jan-krkonose-2026`
- Slug z URL path → API call

#### 4.2 Odstranění tokenu z URL

Observer mapa již nepotřebuje `#token=` v URL — akce jsou veřejné.
Zjednodušení `map/tokens.js`.

#### 4.3 CDN URL pro fotky a audio

Fotky a audio se načítají přímo z Cloudflare CDN (B2):
```js
// Stávající — base64 přes GAS
const audioBase64 = await fetchAudioFromGAS(fileId);

// Nové — přímé URL
const audioUrl = `https://media.tvoje-domena.cz/${activity_id}/audio/${entry_id}.webm`;
```

Lightbox a audio player zůstávají beze změny — jen jiný src.

---

### Fáze 5 — Google Play

**Odhadovaný čas: 1–2 dny práce + 7–14 dní čekání na review**

#### 5.1 Příprava

- [ ] Registrace Google Play Developer Account ($25)
- [ ] Vygenerovat **release keystore**: `keytool -genkey -v -keystore ultralog-release.keystore`
  - **DŮLEŽITÉ**: keystore zálohovat — bez něj nelze updatovat appku
- [ ] Nakonfigurovat signing v `android/app/build.gradle`
- [ ] Build release AAB: `./gradlew bundleRelease`

#### 5.2 Play Console listing

- Název appky, popis (krátký + dlouhý), kategorie: "Cestování a navigace"
- Screenshoty: min. 2 pro telefon (doporučeno 5–8)
- Feature graphic: 1024×500 px banner
- Content rating dotazník (GPS, fotky, audio → pravděpodobně PEGI 3 / Everyone)

#### 5.3 Privacy Policy (povinná)

Musí pokrývat:
- Sběr GPS polohy (i na pozadí)
- Nahrávání fotek a audio
- Ukládání dat na serveru
- Jak smazat účet / data

Hostovat na: `tvoje-domena.cz/privacy`

#### 5.4 Citlivá oprávnění — zdůvodnění pro Google

`ACCESS_BACKGROUND_LOCATION` vyžaduje explicitní zdůvodnění v Play Console:
> "Appka sleduje polohu turisty/běžce na pozadí během aktivity, aby rodina
> mohla v reálném čase sledovat jeho průběh trasy. Poloha se nahrává pouze
> během aktivní akce."

---

## Pořadí implementace (doporučené)

```
1. Backblaze B2 setup + Cloudflare CDN        (30 min)
2. Railway projekt + PostgreSQL               (30 min)
3. Backend API (Fastify)                      (4–6h)
4. Webový onboarding UI                       (4–6h)
5. Android appka — změna endpointu            (1h)
6. Android appka — deep link QR setup         (1–2h)
7. Android appka — komprese fotek             (30 min)
8. Observer mapa — nový endpoint              (1h)
9. Observer mapa — CDN media URL              (30 min)
10. Google Play příprava + submission         (1–2 dny)
```

---

## Co se NEMĚNÍ (zachovat beze změny)

- Offline-first architektura (IndexedDB queue)
- Background runner (`runner.js` + CapacitorKV)
- Service Worker Background Sync
- Leaflet mapa, markery, polyline, orbit expand
- Audio player, lightbox
- GPX vrstva na mapě
- Vosk offline STT
- Deduplication přes `entry_id`
- Incremental sync přes `?since=` parametr
- Open-Meteo weather fetch (přesune se z GAS do Fastify backendu)

---

## Otevřené otázky pro rozhodnutí při implementaci

1. **Auth pro onboarding**: použít Supabase Auth pouze pro user accounts
   (aby nebylo nutné psát vlastní JWT logiku), nebo vlastní jednoduché session?
2. **Slug generování**: `jmeno-nazev-akce-rok-mesic` ručně, nebo auto-generovat
   náhodný slug (čitelný, např. `modra-hora-k7x2`)?
3. **Expiry akcí**: automaticky archivovat/smazat akce po X dnech po `ends_at`?
4. **Notifikace pro rodinu**: v budoucnu push notifikace "Petr právě odeslal
   zprávu z trasy"? (vyžaduje další infrastrukturu — Web Push nebo FCM)
5. **Název / branding appky**: UltraLog? Nebo přejmenovat pro širší publikum?
