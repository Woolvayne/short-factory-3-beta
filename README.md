# ShortsFactory — Clip Mill Edition

> **🔐 NACH DEM DEPLOY ZUERST:** [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md) — Passwortschutz,
> IP-Sperre, Vercel KV, Zernio-Versand und Sendezeiten einrichten (Deutsch, Schritt für Schritt).
> Tiefere Details & Troubleshooting: [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

---

## 0 · Anleitung: Onepage-Passwortschutz mit IP-Sperre (serverseitig)

Eine einzige Seite liegt vor der App: Passwort eingeben → Fabrik öffnet sich. Geprüft wird
**serverseitig** in `api/auth.js` gegen eine Vercel-Environment-Variable — das Passwort liegt nie im
Browser-Bundle. Nach **5 Fehlversuchen in Folge** wird die **IP** gesperrt: 5 Min → 15 Min → 1 h →
6 h → 24 h (jede weitere Sperre eskaliert). Und: **Nach jedem Neuladen wird das Passwort erneut
verlangt** — das Token lebt nur im Arbeitsspeicher des Tabs (kein localStorage, kein Cookie).

**Schritt 1 — Passwort ausdenken** (lang & zufällig, am besten aus dem Passwort-Manager).

**Schritt 2 — in Vercel eintragen**
Projekt → **Settings** → **Environment Variables** → **Add New**

| Feld | Wert |
| --- | --- |
| Name | `APP_PASSWORD` |
| Value | dein Passwort (Klartext — nur serverseitig) |
| Environments | Production ✔ Preview ✔ |

**Kein `VITE_`-Prefix!** Alternativ statt Klartext den Hash setzen:

```bash
npm install
npm run password:hash -- "meinSicheresPasswort"
# → den ausgegebenen SHA-256 als APP_PASSWORD_HASH eintragen
```

**Schritt 3 — Neu deployen.** Deployments → ⋯ → **Redeploy** (ohne Build-Cache) oder neuen Commit
pushen — sonst kennt die Function die Variable nicht.

**Schritt 4 — Testen.** Seite öffnen → „PRÜFE SPERRE…" → Passwort → **FABRIK ENTSPERREN**. Falsch
eingeben zeigt „NOCH 4 VON 5 VERSUCHEN"; nach 5 Fehlversuchen läuft ein Live-Countdown der
IP-Sperre. **F5 → Passwort erneut eingeben ✔.** Der Button **SPERREN** oben rechts sperrt sofort.

Optional, aber empfohlen: **Vercel KV / Upstash** verbinden (`KV_REST_API_URL`,
`KV_REST_API_TOKEN`) — dann gilt die IP-Sperre global über alle Serverless-Instanzen. Ohne KV zählt
jede Instanz für sich (funktioniert, ist aber nicht global). Feintuning per
`APP_MAX_ATTEMPTS`, `APP_LOCKOUT_MINUTES`, `APP_SESSION_TTL`.

In der App zeigt das Panel **`-- · Einrichtung · nach dem Deploy`** an, welche Schritte noch offen
sind — inklusive kopierbarer Befehle. Details, CLI-Variante, KV, Troubleshooting:
**[docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)** ·
**[docs/ANLEITUNG.md → Kapitel 1](docs/ANLEITUNG.md#1--onepage-passwortschutz--ip-sperre)**

---

## 0.1 · Anleitung: Zernio als Versandweg

**Schritt 1** — API-Key holen: [zernio.com/dashboard/api-keys](https://zernio.com/dashboard/api-keys)
(Format `sk_` + 64 Hex) und mindestens einen Social-Account bei Zernio verbinden.

**Schritt 2** — in Vercel: **Settings → Environment Variables**

| Feld | Wert |
| --- | --- |
| Name | `ZERNIO_API_KEY` |
| Value | `sk_…` |
| Environments | Production ✔ Preview ✔ |

**Kein `VITE_`-Prefix!** Der Key gehört nur in die Serverless-Function `api/zernio.js` und landet
niemals im Browser. Danach neu deployen.

**Schritt 3** — senden. Panel **`06 · Versand · Zernio`**:

* grüne LED + deine verbundenen Accounts (werden automatisch über `GET /v1/accounts` geholt)
* **wann raus?** — vier Modi, alle in Europe/Berlin:
  * `SOFORT` (`publishNow`) — alles geht direkt raus
  * `06 & 20 UHR` — **Standard**: ein Video um 6 Uhr, das nächste um 20 Uhr, dann der nächste Tag.
    Uhrzeiten frei editierbar, weitere über `+ SENDZEIT`, Vorlagen wie `09 & 18` oder `3× TÄGLICH`
  * `EIGENE ZEIT` — eine eigene Uhrzeit **pro Video** (Vorlage auf alle 10 verteilen und/oder jede
    Zeile einzeln; leeres Feld = sofort, vergangene Zeiten werden automatisch vorgezogen)
  * `FLEXIBEL` — Startzeit + Abstand 15 Min … 1 Tag
* **„Alle 10 → Zernio"** = ein Klick, alle gerenderten Videos gehen raus — vorher öffnet der
  **Sendeplan-Dialog** (siehe unten)
* **„Alle → Queue"** = ein Klick, **kein** Dialog: alle Videos landen gleichzeitig in der
  Warteschlange und bekommen reihum die nächsten freien Sendeplätze
* **„→ ZERNIO"** auf jeder Unit-Karte in der Output Bay = nur dieses eine Video → öffnet den
  **Sendeplan-Dialog** für genau diesen Post

### Sendeplan-Dialog (ein Post oder alle auf einmal)

Statt sofort loszuschicken, fragt die App beim Klick auf **→ ZERNIO** (Unit-Karte,
„Einzelversand") bzw. **Alle → Zernio** (Panel `06`) in einem Fenster nach, **wie** der Post
raus soll — flexibel, pro Post, mit Live-Vorschau des fertigen Sendeplans:

| Auswahl | Einzelner Post | Alle Videos gleichzeitig |
| --- | --- | --- |
| `SOFORT` | ✔ `publishNow` | ✔ (mit 3 s Takt) |
| `EIGENE ZEIT` | ✔ frei planen: `datetime-local` + Chips `+15 MIN` `+1 STD` `+3 STD` `20 UHR` `06 UHR` | — |
| `IN DIE QUEUE` / `ALLE → QUEUE` | ✔ nächster freier Sendeplatz, Position in der Queue per `−`/`+` wählbar | ✔ jedes Video bekommt reihum den nächsten freien Platz |
| `FLEXIBEL` | — | ✔ Startzeit + Abstand 15 Min … 1 Tag |
| `EIGENE ZEITEN` | — | ✔ die 10 Zeiten aus dem Panel (eine pro Video) |

Dazu im Dialog: **Post-Titel** und **Hashtags** nur für diesen Versand (leer = Panel-Wert),
Schalter **„Als Entwurf speichern"**, die verbundenen Accounts als Zielanzeige und die Liste
**„DEIN SENDEPLAN"** mit der echten Zeit pro Unit. `Esc` schließt, `Strg/Cmd + Enter` sendet.

Bereits verplante Slots in der Queue werden **nicht doppelt belegt** — ein neuer Post rutscht
automatisch auf den nächsten freien Zeitpunkt (im Dialog als Hinweis, im Plan als
`(VERSCHOBEN)`).

* zwischen **jedem** Video wartet die Fabrik **exakt 3 Sekunden** (`SHIP_GAP_MS = 3000`) — der
  Countdown läuft sichtbar mit, **STOP** bricht die Warteschlange ab. Während die Queue läuft,
  kannst du weitere Posts über den Dialog **anhängen**
* Titel, Hashtags und Caption-Vorlage (`{title}` `{excerpt}` `{story}` `{hashtags}` `{index}`)
  sind einstellbar, plus Schalter **„Als Entwurf speichern"** zum risikofreien Testen

**Kein Kalender.** Der Sendeplan erscheint als schlichte Liste („01 → HEUTE 20:00 · 02 → MORGEN
06:00 …"), mehr nicht — im Panel `06` und im Dialog.

Technik: `POST /v1/media/presign` → Video direkt aus dem Browser per `PUT` hochladen (bis 5 GB,
mit Fortschritt) → `POST /v1/posts` mit `mediaItems`. Bei CORS-Problemen greift automatisch ein
Relay über die eigene Function (Vercel-Body-Limit 4,5 MB). Details:
**[docs/ANLEITUNG.md → Kapitel 2](docs/ANLEITUNG.md#2--zernio-als-versandweg)**

---

## 0.2 · Anleitung: Reddit-Story-Intro

`00 · Machine Settings → INTRO`: die typische Reddit-Post-Karte (Avatar, `r/Subreddit`, Alter,
Titel, Upvotes + Kommentare) **fliegt** in den ersten Sekunden ein — Standard **3.0 s**, Dauer
einstellbar von 1 bis 8 s.

* **Titel einstellbar:** `IDEA-FELD` (jedes Video zeigt seinen eigenen Titel aus Schritt 01) oder
  `FESTER TITEL` (alle 10 denselben)
* **Flug-Bewegung:** `FLY UP` · `FLY IN` (von links) · `DROP` — Titelzeilen fliegen gestaffelt hinterher,
  der Upvote-Zähler zählt beim Einfliegen hoch
* **Look:** Dark/Light, Position, Titelgröße, Abdunklung, Statistik-Zeile an/aus
* **Live-Vorschau** mit Abspielen und Scrub-Regler — gezeichnet wird exakt dieselbe Funktion wie im
  Render, die Karte ist also wirklich ins Video eingebrannt (kein Overlay, kein Schnitt)

---

## What this is

**One clip in. Ten shorts out.** A video assembly line that runs **100 % in your
browser**: no render farm, no ffmpeg. Feed it one long background video, get ten
different moments — each with its own AI story, neural voice, flying Reddit intro
and word-synced captions — then press **Render** and ship the result to Zernio.

Optimised for desktop **and** iPhone / iPad (iOS 17+ recommended).

### The three-button flow

1. **① Prepare 10 scripts + voices** — fast step, writes every story and
   synthesises every voice track. No video is rendered yet.
2. **② Render** — renders every staged unit, or use the **RENDER** button on each
   individual card in the Output Bay. Done units get **RE-RENDER**, failed ones
   get **RETRY**. A **STOP** button in the status bar aborts a running batch.
3. **Bundle → ZIP** *or* **→ Zernio** — pack all finished blobs locally, and/or
   send them out one by one (3-second cadence) or all ten with a single click.

### Clip Mill — one source → ten clips

Step 02 has two modes:

| Mode | What it does |
| --- | --- |
| **1 SOURCE → 10** | Pick *one* long video (or paste a direct link). It's sliced into 10 different clip windows — one per story. Every window shows its timecode and can be re-rolled individually; **RE-SLICE** redeals all ten. |
| **10 FILES** | The classic path: pick ten separate 9:16 clips, one per story. |

Slicing is controlled under **Settings → CLIPS**: distribution
(*evenly spread / random / sequential*), clip length (*match voice / fixed*),
plus **skip intro** and **skip outro** so title cards and end screens never
make it into a short. When clip length is set to *match voice*, the ten
windows are re-cut after preparation using the real voice durations.

#### About YouTube links

Paste a YouTube (or TikTok / Instagram / X / Vimeo) link and the app tells you
honestly what's going on instead of pretending: **browsers cannot download
those streams** — they're signed and send no CORS headers, and working around
that would breach the platform's terms and, for material you don't own,
copyright. The panel shows the legal one-step alternative:

* Your own video → download the original in **YouTube Studio → Content → ⋮ → Download**, then pick that file.
* Licensed / Creative-Commons footage → get the file from the rights holder or stock site.
* Or paste a **direct video URL** (`…/clip.mp4`) that allows cross-origin requests — your own hosting, S3/R2, Pexels, Coverr, Mixkit. Those are streamed into a local blob with a progress bar and sliced exactly the same way.

### Settings (6 tabs)

| Tab | Controls |
| --- | --- |
| **AI** | Qwen + Mistral keys (localStorage only), story genre (AITA · petty revenge · confession · unsettling · wholesome · workplace · custom instruction), story length ~110–280 words, creativity/temperature |
| **VOICE** | 12 Edge neural voices, speaking rate ±40 %, pitch ±20 Hz, voice volume, music-bed volume, music fade-out, tail padding |
| **CAPTIONS** | On/off, 4 style presets, 1–5 words per cue, colour swatches + custom picker, text size, vertical position, outline weight, uppercase, drop shadow — with a **live preview** |
| **INTRO** | Reddit story card: on/off, title source (per-video idea or one fixed title), subreddit, author, age label, upvotes, **duration (default 3 s)**, flight animation, dark/light, position, title size, backdrop dim, stats row — with a **live canvas preview** |
| **VIDEO** | Resolution (auto / 540 / 720 / 1080), frame rate 24·30·60, bitrate, vignette, slow Ken-Burns zoom |
| **CLIPS** | Distribution mode, clip length mode + fixed length, skip intro, skip outro |

No API keys? The built-in **offline story writer** takes over — full-length
first-person stories with zero network.

### Quick start

```bash
npm install
npm run dev        # open the printed URL (narration relay included, same origin)
npm run build      # static bundle in dist/
npm run password:hash -- "meinPasswort"   # optional: SHA-256 statt Klartext
```

Deploying to Vercel works with zero configuration: everything in `api/` is picked
up as a Serverless Function automatically (`api/tts.js` for narration,
`api/auth.js` for the gate, `api/zernio.js` for shipping), and the `ws` dependency
is installed during build. The only environment variables you need are the ones
from the guides above — `APP_PASSWORD` (gate, server-side only) and
`ZERNIO_API_KEY` (shipping). Optional: `APP_MAX_ATTEMPTS`, `APP_LOCKOUT_MINUTES`,
`APP_SESSION_TTL` und `KV_REST_API_URL`/`KV_REST_API_TOKEN` für ein globales
IP-Rate-Limit.

> Lokal ohne `vercel dev` gibt es keine Serverless-Functions: Stimme und Zernio-Versand
> brauchen `npm run dev` hinter `vercel dev` oder ein Deployment.

#### Why the TTS relay exists

Microsoft's Edge Read-Aloud endpoint is WebSocket-only, and every **browser**
WebSocket handshake automatically carries an `Origin` header — which that
endpoint rejects. Supabase's Edge Function runtime proved unreliable for
outbound third-party WebSockets (invocations terminate after ~10ms CPU with
"EarlyDrop" before any audio arrives). The proven `edge-tts` protocol
implementation (TrustedClientToken + `Sec-MS-GEC` BigInt token,
`speech.config`, SSML, WordBoundary parsing) therefore lives in
`api/tts.js` — a Vercel Serverless Function pinned to the **Node.js runtime**
(`export const config = { runtime: 'nodejs' }`), where raw `ws` connections
work without restriction. The frontend POSTs to this same-origin endpoint:

```
POST /api/tts
{ "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }

200 { "ok": true, "format": "audio/mpeg", "audioBase64": "…", "words": [ … ] }
```

Same origin → no CORS, no apikey, no Supabase anon key, no configuration.
`src/lib/tts.ts` keeps the same `TtsResult` / `WordTs` / `Cue` / `buildCues` /
`cueAt` exports — the renderer is untouched.

### How it works

| Piece | Where |
| --- | --- |
| Gate | `PasswordGate.tsx` + `lib/gate.ts` + `api/auth.js` — Passwort wird serverseitig gegen `APP_PASSWORD`/`APP_PASSWORD_HASH` geprüft; 5 Fehlversuche pro IP → eskalierende Sperren (5 min … 24 h), Token nur im Tab-Speicher (F5 = neues Passwort) |
| Stories | Browser → Qwen/Mistral directly (optional), else offline writer |
| Voice | Browser → same-origin Vercel Serverless Function `/api/tts` (Node runtime + `ws`) ⇄ Microsoft Edge Read-Aloud WebSocket — free, no API key |
| Intro | `lib/intro.ts` — Reddit card drawn straight onto the render canvas for the first N seconds |
| Captions | WordBoundary timestamps grouped into N-word cues, drawn on canvas |
| Rendering | Canvas 2D + WebAudio graph + MediaRecorder, real-time capture, MP4/H.264 on Safari with automatic WebM fallback |
| ZIP | JSZip (STORE) → blob anchor, fully local |
| Shipping | `lib/zernio.ts` + `api/zernio.js` — presign → direct PUT upload → `POST /v1/posts`, 3 s between videos |
| Your files | Never uploaded anywhere except Zernio when **you** press send |

Rendering is real-time: a 40-second voice takes ~40 seconds per unit, and the
tab must stay in the foreground (that's how MediaRecorder captures frames).

### Project layout

```
src/
├─ App.tsx                     gate → prepare → render → zip → ship
├─ components/
│  ├─ PasswordGate.tsx         the one-page password screen (lockout countdown)
│  ├─ SetupPanel.tsx           “--” panel: setup checklist right after deploy
│  ├─ Header.tsx               LEDs, clock, marquee, lock button
│  ├─ SettingsPanel.tsx        6-tab settings console (incl. INTRO)
│  ├─ IntroPreview.tsx         live canvas preview of the flying Reddit card
│  ├─ Controls.tsx             sliders, toggles, segmented, colour swatches
│  ├─ IdeasPanel.tsx           the 10 numbered inputs
│  ├─ ClipMill.tsx             1-source slicing + link intake + 10-file mode
│  ├─ Uploaders.tsx            soundtrack deck
│  ├─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay · per-unit → ZERNIO
│  └─ ShipPanel.tsx            Zernio dispatch: mode, send plan, caption, batch button, log
└─ lib/
   ├─ gate.ts      intro.ts    zernio.ts   settings.ts   llm.ts   tts.ts
   └─ renderer.ts  clips.ts    media.ts    types.ts

api/        ← auth gate + tts relay + zernio shipping (Vercel Serverless, Node.js)
              └─ _lib/gate.js  shared gate: password check, HMAC tokens, IP rate limit
scripts/    ← hash-password.mjs (npm run password:hash)
docs/       ← EINRICHTUNG.md (Einrichtung nach dem Deploy) · ANLEITUNG.md (Details, Deutsch)
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
```

— No render farm. No ffmpeg. No calendar. No mercy.
