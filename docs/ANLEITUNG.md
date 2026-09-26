# ShortsFactory v3 — Anleitung

Vier Bausteine rund um Zugang, Versand und Intro:

| # | Feature | Wo eingestellt | Env-Variable (Vercel) |
| --- | --- | --- | --- |
| 1 | **Onepage-Passwortschutz + Rate Limit** | volle Seite vor der App | `APP_PASSWORD` (oder `APP_PASSWORD_HASH`) — serverseitig |
| 2 | **Zernio-Versandweg** | Panel `06 · Versand · Zernio` | `ZERNIO_API_KEY` |
| 3 | **Reddit-Story-Intro** | `00 · Machine Settings → INTRO` | keine (liegt im localStorage) |
| 4 | **Einrichtungs-Assistent** | Panel `-- · Einrichtung · nach dem Deploy` | zeigt offene Schritte an |

> **Neu hier?** Dann zuerst **[docs/EINRICHTUNG.md](EINRICHTUNG.md)** lesen — die Schritt-für-Schritt-
> Anleitung für direkt nach dem Deploy (Passwort, IP-Sperre, KV, Zernio, Sendezeiten).
> Dieses Dokument geht tiefer ins Detail.

---

## 1 · Onepage-Passwortschutz + IP-Sperre

### 1.1 So funktioniert es

Eine einzige Seite liegt vor der Fabrik. Bis das richtige Passwort eingegeben ist, rendert die App
**ausschließlich** die Passwort-Seite (`src/components/PasswordGate.tsx`) — die Fabrik dahinter wird
gar nicht erst gemountet.

Geprüft wird **serverseitig** in der Vercel-Function `api/auth.js`:

```
Browser ──GET /api/auth?action=status──►  bin ich (IP) gesperrt? wie viele Versuche frei?
        ──POST {action:"unlock"}───────►  Passwort prüfen (timing-safe)
        ◄──{ ok, token }───────────────  signiertes Token (HMAC, Standard 12 h)
        ──x-sf-auth: <token>───────────►  damit läuft /api/zernio
```

* Das Passwort steht in der Vercel-Environment-Variable **`APP_PASSWORD`** (Klartext, serverseitig)
  oder **`APP_PASSWORD_HASH`** (SHA-256). Beide Werte werden **nie** an den Browser geschickt.
* **Jede Seite neu laden = Passwort neu eingeben.** Das Token liegt ausschließlich im
  Arbeitsspeicher des Tabs — kein localStorage, kein sessionStorage, kein Cookie.
* Oben rechts in der Fabrik sperrt der Button **SPERREN** die Sitzung sofort wieder.

**Fallback ohne Serverless-Function** (reiner `npm run dev`): Ist beim Build
`VITE_APP_PASSWORD_HASH` / `VITE_APP_PASSWORD` gesetzt, prüft der Browser ersatzweise lokal gegen
diesen Wert — dann gilt ein Zähler pro Gerät statt pro IP. Auf Vercel ist immer der Serverweg aktiv.

### 1.2 Rate Limit: 5 Fehlversuche → IP-Sperre

| Stufe | Auslöser | Sperre |
| --- | --- | --- |
| 1 | `APP_MAX_ATTEMPTS` Fehlversuche in Folge (**Standard 5**) | 5 Minuten |
| 2 | danach wieder 5 | 15 Minuten |
| 3 | danach wieder 5 | 1 Stunde |
| 4 | danach wieder 5 | 6 Stunden |
| 5+ | danach wieder 5 | 24 Stunden (bleibt auf der letzten Stufe) |

* Gezählt wird **pro IP**; gespeichert wird nur ein gesalzener SHA-256-Hash der IP, nie die IP selbst.
* Während der Sperre antwortet `/api/auth` mit `429` + `Retry-After`; die Passwort-Seite zeigt den
  Countdown live („IP GESPERRT · FREI IN 4 MIN 12 S").
* Ein erfolgreicher Login setzt den Zähler dieser IP zurück.
* Anpassbar per Env: `APP_MAX_ATTEMPTS`, `APP_LOCKOUT_MINUTES` (z. B. `10,60,1440`),
  `APP_SESSION_TTL` (Sekunden, Standard `43200`).
* **Speicher:** Standard ist In-Memory (pro warmer Instanz). Mit Vercel KV / Upstash
  (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) gilt die Sperre global über alle Instanzen — empfohlen.
  Details: [EINRICHTUNG.md → Kapitel 2.2](EINRICHTUNG.md#22-sperre-global-machen-vercel-kv--upstash-empfohlen)

### 1.3 Schritt für Schritt — Vercel Dashboard

**Schritt 1 — Passwort ausdenken** (lang, zufällig, nirgendwo sonst benutzt).

**Schritt 2 — Variable eintragen:** Projekt → **Settings** → **Environment Variables** → **Add New**

| Feld | Wert |
| --- | --- |
| Name | `APP_PASSWORD` |
| Value | dein Passwort (Klartext — nur serverseitig) |
| Environments | Production ✔ Preview ✔ |

**Ohne `VITE_`-Prefix!** `VITE_*`-Variablen landen im Browser-Bundle. Alternative mit Hash:

```bash
npm install
npm run password:hash -- "meinSicheresPasswort"   # → SHA-256 ausgeben
# Diesen Hash als APP_PASSWORD_HASH eintragen (statt APP_PASSWORD)
```

**Schritt 3 — Neu deployen (wichtig!)** Deployments → letztes Deployment → **⋯** → **Redeploy**
(ohne „Use existing Build Cache"), oder einen Commit pushen, oder `vercel --prod`.

**Schritt 4 — Testen:** Seite öffnen → „PRÜFE SPERRE…" → Passwort eingeben → **FABRIK ENTSPERREN**.
Falsches Passwort → „NOCH 4 VON 5 VERSUCHEN — DANN 5 MIN SPERRE". Nach 5 Fehlversuchen zeigt die
Seite einen Live-Countdown der IP-Sperre. **F5 drücken → Passwort wird erneut verlangt.** ✔

### 1.4 Vercel CLI

```bash
npm i -g vercel
vercel link
printf '%s' 'meinSicheresPasswort' | vercel env add APP_PASSWORD production
printf '%s' 'meinSicheresPasswort' | vercel env add APP_PASSWORD preview
vercel --prod
```

### 1.5 Lokal testen

```bash
cat >> .env.local <<'EOF'
APP_PASSWORD=meinSicheresPasswort
EOF
npx vercel dev        # führt /api/auth + /api/zernio wirklich aus (empfohlen)
npm run dev           # nur Frontend → Fallback über VITE_APP_PASSWORD_HASH
```

### 1.6 Passwort ändern oder entfernen

* **Ändern:** neuen Wert in Vercel setzen (oder neuen Hash) → **Redeploy**. Alle laufenden Tokens
  werden automatisch ungültig, weil sie mit dem neuen Passwort signiert werden müssten.
* **Entfernen:** `APP_PASSWORD` (und ggf. `VITE_APP_PASSWORD*`) löschen + Redeploy → die App ist
  wieder offen. Der Einrichtungs-Assistent im Panel `--` meckert dann mit „PASSWORT-SCHUTZ: offen".

### 1.7 Ehrliche Sicherheitseinschätzung

* Der Passwort-Abgleich läuft serverseitig und timing-safe; der Wert verlässt Vercel nie.
* Das Token ist HMAC-signiert und läuft ab (Standard 12 h) — es liegt nur im Tab-Speicher.
* Die IP-Sperre bremst Durchprobieren wirksam aus (5 Versuche → eskalierende Sperren bis 24 h).
* **Aber:** Die Oberfläche selbst liegt als statische Datei auf Vercel. Wer sie herunterlädt, kann
  Teile der UI sehen — aber **nichts auslösen**: `/api/zernio` verlangt ein gültiges Token, und
  `ZERNIO_API_KEY` existiert nur in der Function. Für noch härteren Schutz zusätzlich
  **Vercel → Settings → Deployment Protection** einschalten.
* Ohne KV gilt die Sperre nur pro Instanz — wer es genau braucht, verbindet Vercel KV.

### 1.8 Troubleshooting

| Symptom | Ursache / Lösung |
| --- | --- |
| Gate erscheint nicht | `APP_PASSWORD` fehlt/vertippt, falsches Environment, oder **nicht neu deployt** |
| „PRÜFE SPERRE…" und dann offen | `/api/auth` antwortet `configured:false` → Variable prüfen (Kapitel 1.3) |
| „IP GESPERRT" ohne eigenes Zutun | 5 Fehlversuche von dieser IP (z. B. Tippfehler-Serie) → Countdown abwarten; mit KV notfalls den Key `sf:gate:…` im KV-Datenbrowser löschen |
| „crypto.subtle fehlt" | Nur im Offline-Fallback ohne Server über plain HTTP — über HTTPS, localhost oder `vercel dev` tritt es nicht auf |
| Zernio meldet 401 „Nicht freigeschaltet" | Token abgelaufen (`APP_SESSION_TTL`) oder Seite neu geladen → neu entsperren |
| „HINWEIS: OHNE VERCEL KV …" | Erwartet ohne KV: Sperre gilt pro Server-Instanz. Mit `KV_REST_API_URL`/`KV_REST_API_TOKEN` global |

---


## 2 · Zernio als Versandweg

Zernio ist die Social-Media-API (`https://zernio.com/api/v1`, Doku:
[docs.zernio.com](https://docs.zernio.com)), die hinter dem Versand steckt: ein Upload, ein Post,
16 Plattformen. **Es gibt keinen Kalender in dieser App** — nur vier Versand-Arten und einen
Sendeplan als Liste.

### 2.1 Voraussetzungen

1. Zernio-Account: [zernio.com](https://zernio.com/signup) (die ersten 2 verbundenen Accounts sind kostenlos)
2. API-Key anlegen: [zernio.com/dashboard/api-keys](https://zernio.com/dashboard/api-keys) — Format `sk_` + 64 Hex-Zeichen
3. Mindestens einen Social-Account verbinden (TikTok, Instagram, YouTube, …)

### 2.2 `ZERNIO_API_KEY` in Vercel setzen

**Settings → Environment Variables → Add New**

* **Name:** `ZERNIO_API_KEY`
* **Value:** `sk_...`
* **Environment:** Production ✔ Preview ✔
* **Wichtig:** *kein* `VITE_`-Prefix! Nur Variablen mit `VITE_` landen im Browser-Bundle —
  dieser Key gehört ausschließlich in die Serverless-Function `api/zernio.js`.
* Danach **Redeploy** (Serverless-Functions lesen Env zur Laufzeit, der Build-Cache kann trotzdem
  kleben bleiben).

Lokal: `echo 'ZERNIO_API_KEY=sk_...' >> .env.local` und `vercel dev` (der reine `vite`-Devserver
führt keine Serverless-Functions aus).

### 2.3 Was beim Senden passiert

```
1. POST /api/zernio {action:"presign"}   → Zernio POST /v1/media/presign
2. PUT  <uploadUrl>  (Video direkt aus dem Browser, bis 5 GB)
3. POST /api/zernio {action:"publish"}   → Zernio POST /v1/posts
                                            mediaItems: [{ type:"video", url: publicUrl }]
                                            publishNow: true  ODER  scheduledFor + timezone
```

* Der API-Key bleibt serverseitig, der Browser sieht ihn nie.
* Ziel-Accounts werden **automatisch** über `GET /v1/accounts` ermittelt (alle verbundenen,
  aktiven Accounts). Nichts zum Anklicken, nichts zum Konfigurieren.
* Ist TikTok dabei, sendet die Route die von TikTok verlangten `tiktokSettings`
  (`PUBLIC_TO_EVERYONE`, Kommentare/Duet/Stitch erlaubt, Content-Preview bestätigt) automatisch mit.
* YouTube-Titel werden auf 100 Zeichen gekürzt (API-Limit).

### 2.4 Die vier Versand-Arten (Panel `06 · Versand · Zernio`)

| Modus | Verhalten |
| --- | --- |
| **SOFORT** | `publishNow: true` — jedes Video geht direkt nach dem Upload raus |
| **06 & 20 UHR** *(Standard)* | ein Video um 06:00, das nächste um 20:00 (Europe/Berlin), dann der nächste Tag … Beide Uhrzeiten sind **editierbar**, weitere über **`+ SENDZEIT`** ergänzbar (bis 10), einzelne mit **`ENTFERNEN`** löschbar. Ein-Klick-Vorlagen: `06 & 20` · `09 & 18` · `12 & 19` · `3× TÄGLICH` |
| **EIGENE ZEIT** | eine eigene Uhrzeit **pro Video**: Vorlage (Standard 06:00/20:00) mit **`ZEITEN ÜBERNEHMEN`** auf alle 10 verteilen und/oder jede Zeile einzeln als `datetime-local` setzen. Leeres Feld = dieses Video geht sofort raus. Vergangene Zeiten werden automatisch auf „jetzt + 2 min" vorgezogen und im Sendeplan gelb als `(VORGEZOGEN)` markiert |
| **FLEXIBEL** | Startzeit (`datetime-local`) + Abstand (15 Min bis 1 Tag). Liegt die Startzeit in der Vergangenheit, wird automatisch auf den nächsten freien Zeitpunkt vorgespult |

Der Sendeplan darunter zeigt alle 10 Zeiten als Liste — kein Kalender. Intern ist das eine reine
Rechnung in `computeSlots()` (`src/lib/zernio.ts`); im Modus `EIGENE ZEIT` wird die Zeit über den
**Unit-Index** gewählt (Video 01 bekommt Zeile 01 usw.), in den anderen Modi in Sende-Reihenfolge.

Die Panel-Modi sind gleichzeitig die **Vorbelegung des Sendeplan-Dialogs** (Kapitel 2.6): Was hier
steht, ist im Dialog vorausgewählt — pro Post lässt sich dort aber jederzeit etwas anderes nehmen
(z. B. Panel steht auf `SOFORT`, dieser eine Post geht trotzdem `HEUTE 20:00` in die Queue).
Die Liste im Panel zeigt verplante Units deshalb mit ihrer **echten** Zeit aus dem Dialog
(`N × VERPLANT`, wartende mit `· QUEUE`).

Zusätzlich: **„Als Entwurf speichern"** → `isDraft: true`. Landet als Draft in Zernio, wird nicht
veröffentlicht. Perfekt, um den kompletten Weg einmal ohne Risiko durchzutesten.

Geplante Zeiten gehen als `scheduledFor` (Wandzeit) **plus** `timezone: "Europe/Berlin"` raus —
so erwartet es die Zernio-API, und die Sommer-/Winterzeit stimmt automatisch.

### 2.5 Der 3-Sekunden-Takt

Zwischen **jeden beiden** Videos wartet die Fabrik exakt **3 Sekunden**
(`SHIP_GAP_MS = 3000` in `src/lib/zernio.ts`). Das gilt:

* beim Batch-Versand (alle 10 mit einem Klick),
* wenn du mehrere Einzelversande kurz hintereinander klickst — alles landet in derselben
  Warteschlange und wird mit 3 s Abstand abgearbeitet (auch wenn du einen Plan **während** einer
  laufenden Queue im Dialog bestätigst: er wird angehängt),
* unabhängig vom Modus (auch bei „SOFORT").

Im Panel und in der Status-Pille unten läuft der Countdown sichtbar mit: `PAUSE 2.4 s`.
**STOP** bricht die Warteschlange ab (das gerade laufende Video wird noch fertig gesendet).

### 2.6 Einzelversand vs. alle 10 — der Sendeplan-Dialog

Kein Versand mehr „blind": **jeder** Klick auf einen Versand-Button öffnet zuerst ein Fenster, in
dem du den Sendeplan für genau diesen Post (oder den ganzen Stapel) festlegst.

* **Einzelnes Video:** in der Output Bay (`05`) hat jede fertige Karte einen Button **→ ZERNIO**.
  Er erscheint erst, sobald das Video gerendert ist. Klick → **Sendeplan-Dialog** für dieses eine
  Video. Danach zeigt der Button den Zernio-Status (`IN WARTESCHLEIFE`, `GEPLANT`,
  `VERÖFFENTLICHT`, `ENTWURF`, `FEHLER`) plus die geplante Zeit (`HEUTE 20:00 · QUEUE`).
* **Alle 10:** im Panel `06` der Button **`10 Videos → Zernio`** (bzw. die Anzahl der noch nicht
  gesendeten) → derselbe Dialog, nur für den ganzen Stapel.
* **Alle gleichzeitig in die Queue:** der Button **`Alle 10 → Queue`** daneben reiht **ohne**
  Dialog alle fertigen Videos auf einmal in die Warteschlange ein — jedes bekommt reihum den
  nächsten freien Sendeplatz des Panel-Sendeplans (Standard 06:00 & 20:00 Uhr).
* Unter „Einzelversand" findest du zusätzlich alle fertigen Units als Chips — praktisch, wenn du
  nur 3 von 10 rausschicken willst. Auch diese Chips öffnen den Dialog.

#### Was der Dialog kann

| Auswahl | Einzelner Post | Alle Videos |
| --- | --- | --- |
| **SOFORT** | `publishNow: true` | jedes Video direkt nach dem Upload (mit 3 s Takt) |
| **EIGENE ZEIT** | frei planen: `datetime-local` plus Chips `+15 MIN` · `+1 STD` · `+3 STD` · `20 UHR` · `06 UHR` | — (dafür **FLEXIBEL**) |
| **IN DIE QUEUE** / **ALLE → QUEUE** | nächster freier Sendeplatz; Position per `−`/`+` bis zu 9 Plätze verschiebbar | alle reihum auf die nächsten freien Plätze |
| **FLEXIBEL** | — | Startzeit + Abstand (15 Min … 1 Tag) |
| **EIGENE ZEITEN** | — | die 10 Zeiten aus dem Panel `06` → Modus `EIGENE ZEIT` (Zeit pro Unit-Index), Button **IM PANEL BEARBEITEN** springt direkt dorthin |

Zusätzlich im Dialog:

* **POST-DETAILS (OPTIONAL)** — Titel und Hashtags **nur für diesen Versand**; leer lassen = die
  Werte aus dem Panel `06`.
* **ALS ENTWURF SPEICHERN** — wie im Panel, wird beim Senden ins Panel übernommen.
* **GEHT AN** — deine verbundenen Zernio-Accounts (bzw. die Warnung, wenn Key oder Account fehlt;
  dann ist der Send-Button gesperrt).
* **DEIN SENDEPLAN** — die echte Liste „01 → HEUTE 20:00 · 02 → MORGEN 06:00 …" für genau die
  ausgewählten Videos, inklusive `(VORGEZOGEN)` bei Zeiten in der Vergangenheit.
* `Esc` = schließen, `Strg/Cmd + Enter` = senden, Klick auf den Hintergrund = schließen.

#### Queue-Verhalten

* Der Plan wird **beim Einreihen einmal** in feste Slots übersetzt und hängt am Queue-Eintrag
  (`ShipQueueEntry` in `src/lib/shipPlan.ts`) — dadurch kann jeder Post seine eigene Zeit haben,
  auch wenn mehrere Dialoge nacheinander bestätigt werden.
* **Keine Doppelbuchung:** liegt ein Slot schon in der Queue, rutscht der neue Post automatisch um
  5 Minuten (bzw. um den gewählten Abstand) nach hinten — im Plan als `(VERSCHOBEN)` markiert.
* **„IN DIE QUEUE"** zählt die bereits wartenden Queue-Plätze mit und reiht sich dahinter ein.
* Während die Queue läuft, bleiben die Versand-Buttons aktiv: ein neuer Plan wird einfach
  **angehängt**. **STOP** bricht die Warteschlange ab und setzt die wartenden Units zurück.

### 2.7 Titel, Caption, Hashtags

Im Panel `06` rechts:

* **POST-TITEL** — leer lassen = der Titel aus dem Idea-Feld des Videos (empfohlen, weil jede
  Story ihren eigenen Titel bekommt). Max. 100 Zeichen (YouTube-Limit).
* **HASHTAGS** — z. B. `#shorts #redditstories #storytime #viral #fyp`
* **CAPTION-VORLAGE** — Platzhalter: `{title}` `{idea}` `{excerpt}` (erste ~240 Zeichen der Story)
  `{story}` (vollständiger Text) `{hashtags}` `{index}`

Standard:

```
{title}

{excerpt}

{hashtags}
```

### 2.8 Dateigrößen & der Upload-Fallback

* **Normalfall:** der Browser lädt das Video **direkt** auf die Presigned-URL (bis 5 GB). Kein
  Vercel-Body-Limit, Upload-Fortschritt inklusive.
* **Fallback:** blockt der Storage-Host den Browser-Upload (CORS), geht dieselbe Datei automatisch
  über die eigene Serverless-Route (`POST /api/zernio/upload`). Vercel begrenzt Request-Bodies auf
  **4,5 MB** — für größere Videos schlägt auch der Fallback fehl. Dann: in `00 → VIDEO` die
  Auflösung (540×960) oder Bitrate (LIGHT) senken, oder das Video per **ZIP** holen und manuell
  hochladen.
* `WEBM`-Renders (Chrome/Firefox) werden als `video/webm` verschickt; Safari rendert MP4/H.264.
  TikTok/Instagram/YouTube bevorzugen MP4 — für den Versand ist Safari als Render-Browser die
  sicherste Wahl.

### 2.9 Troubleshooting

| Meldung | Lösung |
| --- | --- |
| `ZERNIO_API_KEY fehlt` | Variable in Vercel gesetzt? Neu deployt? |
| `Nicht freigeschaltet …` (401) | Passwort-Gate aktiv, aber ohne gültige Sitzung aufgerufen → Seite normal über das Gate öffnen |
| `Kein verbundener Social-Account` | bei Zernio mindestens einen Account verbinden, dann Button **API** im Panel |
| `Upload HTTP 403` | Presigned-URL abgelaufen (1 h) → einfach erneut senden |
| `Zernio HTTP 429` | Rate Limit (Free: 60 req/min) — der 3-Sekunden-Takt hält dich normalerweise darunter, sonst kurz warten |
| `Zernio HTTP 403 (plan limit)` | mehr als 2 Accounts verbunden → Zernio-Abrechnung prüfen |

---

## 3 · Reddit-Story-Intro

Das klassische Titel-Card-Intro: eine Reddit-Post-Karte (Avatar, `r/Subreddit`, Alter, **Titel**,
Upvotes + Kommentare) fliegt über die ersten Sekunden des Videos ein, bleibt kurz stehen und
fliegt wieder raus. Sie wird **direkt in den Canvas-Render gezeichnet** — ist also fest im Video
eingebrannt, kein Overlay und kein Schnittprogramm nötig.

### 3.1 Einstellungen (`00 · Machine Settings → INTRO`)

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| **REDDIT-STORY INTRO** | an | Master-Schalter |
| **Titel-Quelle** | `IDEA-FELD` | `IDEA-FELD` = jedes Video zeigt seinen eigenen Titel aus Schritt 01 · `FESTER TITEL` = alle 10 zeigen denselben |
| **Eigener Titel** | leer | der einstellbare Titel (bis 5 Zeilen, Rest endet mit `…`) |
| **Subreddit** | `r/AmItheAsshole` | steht über dem Titel |
| **Alter-Label** | `12 Std.` | kleine Zeitangabe daneben |
| **Autor** | `u/Throwaway_42` | zweite Zeile im Kartenkopf (leer = wird weggelassen) |
| **Upvotes** | `15400` | zählt beim Einfliegen sichtbar hoch, Kommentare werden daraus abgeleitet |
| **Dauer im Video** | **3.0 s** | wie lange die Karte sichtbar ist — die „ersten 3 Sekunden" |
| **Flug-Bewegung** | `FLY UP` | `FLY UP` (von unten) · `FLY IN` (von links) · `DROP` (von oben) |
| **Karten-Look** | `DARK` | Reddit-Nachtmodus oder Tagmodus |
| **Position** | 36 % von oben | Kartenmitte; Captions bleiben bei ~60 % |
| **Titelgröße** | 5.8 % der Breite | bei 1080 px Breite ≈ 63 px |
| **Hintergrund abdunkeln** | 34 % | legt sich nur während des Intros über das Video |
| **Upvotes + Kommentare** | an | Statistik-Zeile unter dem Titel |

### 3.2 Live-Vorschau

Rechts im INTRO-Tab läuft eine echte Vorschau: **INTRO ABSPIELEN** zeigt die Karte in einer
Schleife über einem Platzhalter-Hintergrund (inklusive deiner Caption-Einstellungen), der Regler
darunter scrubbt Frame für Frame durch die ersten Sekunden. Gezeichnet wird exakt dieselbe
Funktion wie im Render — die Vorschau ist kein Mockup.

### 3.3 Tipps

* Titel kurz halten: 6–10 Wörter wirken am besten, lange Titel werden auf 5 Zeilen begrenzt.
* Position ~34–40 % lässt Platz für die Captions bei 60 % (TikTok/Reels-UI sitzt unten).
* Dauer 3 s ist der Standard-Look; 2.5 s wirkt schneller, 4 s lässt Zeit zum Lesen langer Titel.
* Änderung der Intro-Einstellungen betrifft **nur neue Renders** — bereits gerenderte Units
  bleiben unverändert (einfach **RE-RENDER** drücken).

---

## 4 · Alle Environment-Variablen auf einen Blick

| Variable | Prefix | Wo | Pflicht | Zweck |
| --- | --- | --- | --- | --- |
| `APP_PASSWORD` | keins → Server | `/api/auth` | **empfohlen**¹ | Gate-Passwort (Klartext, verlässt den Server nie) |
| `APP_PASSWORD_HASH` | keins → Server | `/api/auth` | Alternative¹ | SHA-256 des Gate-Passworts |
| `APP_MAX_ATTEMPTS` | keins → Server | `/api/auth` | nein | Fehlversuche bis zur IP-Sperre (Standard `5`) |
| `APP_LOCKOUT_MINUTES` | keins → Server | `/api/auth` | nein | Sperr-Stufen in Minuten (Standard `5,15,60,360,1440`) |
| `APP_SESSION_TTL` | keins → Server | `/api/auth` | nein | Token-Gültigkeit in Sekunden (Standard `43200` = 12 h) |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | keins → Server | `/api/auth` | nein | Vercel KV: IP-Sperre gilt global |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | keins → Server | `/api/auth` | nein | Upstash direkt (Alternative zu Vercel KV) |
| `ZERNIO_API_KEY` | serverseitig | `/api/zernio` | für Versand | Zernio-API-Key `sk_…` |
| `ZERNIO_BASE_URL` | serverseitig | `/api/zernio` | nein | eigene API-Basis, Standard `https://zernio.com/api/v1` |
| `VITE_APP_PASSWORD_HASH` | `VITE_` → Browser | Build + Server | nein² | Altbestand / Offline-Fallback |
| `VITE_APP_PASSWORD` | `VITE_` → Browser | Build + Server | nein² | dito als Klartext (nicht empfohlen) |

¹ Ohne beide Passwort-Variablen ist das Gate aus — die App ist dann öffentlich erreichbar.
² Nur für ältere Deployments bzw. den lokalen Fallback ohne Serverless-Functions nötig.

Qwen-/Mistral-Keys gehören **nicht** nach Vercel, sondern in die App (`00 → AI`) und liegen nur im
localStorage deines Browsers.

---

## 5 · Deployment-Checkliste

```bash
npm install
npm run password:hash -- "meinPasswort"      # optional: Hash statt Klartext
npm run typecheck                            # optional: TypeScript prüfen
npm run build                                # baut dist/ (Single-File)
```

Vercel:

- [ ] `APP_PASSWORD` gesetzt (Production + Preview, **ohne** `VITE_`)
- [ ] optional `APP_MAX_ATTEMPTS` / `APP_LOCKOUT_MINUTES` angepasst
- [ ] optional Vercel KV verbunden → IP-Sperre gilt global
- [ ] `ZERNIO_API_KEY` gesetzt (**ohne** `VITE_`)
- [ ] neu deployt (Redeploy ohne Build-Cache)
- [ ] Seite öffnen → Passwort-Seite erscheint → Entsperrung funktioniert
- [ ] **F5 → Passwort wird erneut verlangt** ✔
- [ ] 5× falsch → „IP GESPERRT" mit Live-Countdown ✔
- [ ] Panel `-- · Einrichtung` zeigt alle Häkchen
- [ ] Panel `06` zeigt grüne LED „ZERNIO_API_KEY VERBUNDEN" + deine Accounts
- [ ] Sendezeiten wählen (Standard 06:00 / 20:00, eigene Zeit pro Video oder flexibel)
- [ ] ein Video rendern → **→ ZERNIO** → Status wird `GESENDET/GEPLANT`
- [ ] optional: „Als Entwurf speichern" für den ersten Testlauf
