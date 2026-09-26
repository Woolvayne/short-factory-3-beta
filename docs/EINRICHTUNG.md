# ShortsFactory v3 — Einrichtung nach dem Deployen

Du hast die Fabrik gerade auf Vercel deployed und siehst die Seite? Dann fehlen nur noch die
**Environment-Variablen**. Ohne sie ist die App offen (kein Passwort) und der Zernio-Versand
gesperrt. Diese Anleitung führt einmal komplett durch — Dauer: ca. 10 Minuten.

> **Kurzfassung**
> 1. `APP_PASSWORD` in Vercel setzen (Settings → Environment Variables) — **ohne** `VITE_`-Prefix
> 2. `ZERNIO_API_KEY` setzen (`sk_…`, ebenfalls ohne `VITE_`)
> 3. Optional, aber empfohlen: Vercel KV verbinden → die IP-Sperre gilt dann global
> 4. **Redeploy** (Deployments → ⋯ → Redeploy, ohne Build-Cache)
> 5. Seite öffnen → Passwort eingeben → Panel `06 · Versand · Zernio` prüfen

In der App selbst zeigt dir das Panel **`-- · Einrichtung · nach dem Deploy`** (oben, direkt unter
dem Hero) jederzeit an, welche dieser Schritte noch offen sind — inklusive kopierbarer Befehle.

---

## 0 · Was dich nach dem ersten Deploy erwartet

| Zustand | Was passiert |
| --- | --- |
| Kein `APP_PASSWORD` gesetzt | Die Seite ist **offen** — jeder mit der URL sieht die Fabrik |
| `APP_PASSWORD` gesetzt, nicht neu deployt | Immer noch offen — Functions lesen Env-Variablen erst nach einem neuen Deploy |
| Kein `ZERNIO_API_KEY` | Panel `06` zeigt eine gelbe LED „ZERNIO_API_KEY FEHLT", Versand ist gesperrt |
| Alles gesetzt | Passwort-Seite → Fabrik → Versand an deine verbundenen Accounts |

---

## 1 · Passwortschutz aktivieren (das Gate)

### 1.1 Passwort ausdenken

Mindestens 12 Zeichen, am besten ein Passwort-Manager-Zufallswert. **Wichtig:** Nimm **nicht** das
Passwort, das du irgendwo sonst benutzt — es wird bewusst nur serverseitig geprüft, ist aber der
einzige Schlüssel zur Fabrik.

### 1.2 Variable in Vercel eintragen

1. [vercel.com](https://vercel.com) → dein Projekt
2. **Settings** → **Environment Variables** → **Add New**
3. Ausfüllen:

   | Feld | Wert |
   | --- | --- |
   | **Key / Name** | `APP_PASSWORD` |
   | **Value** | dein Passwort im Klartext |
   | **Environments** | Production ✔ Preview ✔ (Development optional) |

4. **Save**

> **Kein `VITE_`-Prefix!** Nur so bleibt das Passwort auf dem Server. Variablen mit `VITE_` landen
> beim Build im JavaScript-Bundle und wären für jeden sichtbar. (Falls du aus einer älteren Version
> noch `VITE_APP_PASSWORD_HASH` gesetzt hast: Das funktioniert weiter — es ist serverseitig
> gleichwertig, nur „öffentlich geraten" werden könnte der Hash, weil er im Bundle liegt.)

**Alternative ohne Klartext:** Statt `APP_PASSWORD` kannst du `APP_PASSWORD_HASH` mit dem SHA-256
des Passworts setzen:

```bash
npm install
npm run password:hash -- "meinSicheresPasswort"
# → SHA-256 : 0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d
```

Diesen Hash als Wert von `APP_PASSWORD_HASH` eintragen. (Für den Schutz ist beides gleich gut, weil
der Abgleich serverseitig passiert.)

### 1.3 Neu deployen (Pflicht!)

**Deployments** → beim letzten Deployment **⋯** → **Redeploy** → Häkchen bei *„Use existing Build
Cache"* **entfernen** → **Redeploy**. Alternativ: neuen Commit pushen oder `vercel --prod`.

### 1.4 Testen

1. Seite öffnen → die Passwort-Seite erscheint, während des Starts steht dort kurz
   „PRÜFE SPERRE…".
2. Passwort eingeben → **FABRIK ENTSPERREN**.
3. Falsches Passwort → rote Meldung mit „NOCH 4 VON 5 VERSUCHEN".
4. Seite neu laden (F5) → das Passwort wird **erneut** verlangt. Das ist Absicht: das Token liegt nur
   im Arbeitsspeicher des Tabs, nicht im localStorage und nicht in einem Cookie.

Oben rechts in der Fabrik gibt es den Button **SPERREN** — er wirft dich sofort zurück auf die
Passwort-Seite.

---

## 2 · Rate Limit / IP-Sperre (schon aktiv)

Die Sperre braucht keine Einstellung — sie ist ab Werk an und arbeitet so:

| Stufe | Auslöser | Sperre |
| --- | --- | --- |
| 1 | 5 Fehlversuche in Folge (`APP_MAX_ATTEMPTS`) | **5 Minuten** |
| 2 | danach wieder 5 Fehlversuche | **15 Minuten** |
| 3 | danach wieder 5 | **1 Stunde** |
| 4 | danach wieder 5 | **6 Stunden** |
| 5 | danach wieder 5 | **24 Stunden** |
| ab 6 | danach wieder 5 | wieder **24 Stunden** (letzte Stufe bleibt) |

* Gezählt wird **pro IP** (die IP wird nur als gesalzener SHA-256-Hash gespeichert, nie im Klartext).
* Ein **erfolgreicher** Login setzt den Zähler dieser IP sofort zurück; nach längerem Nichtstun
  verfallen die Zähler automatisch (7 Tage).
* Während der Sperre antwortet `/api/auth` mit HTTP `429` und `Retry-After` — die Passwort-Seite
  zeigt den Countdown live an.
* **Alles über der letzten Stufe bleibt bei 24 h** — Endlos-Raten ist damit wirkungslos.

### 2.1 Werte anpassen (optional)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `APP_MAX_ATTEMPTS` | `5` | Fehlversuche bis zur Sperre |
| `APP_LOCKOUT_MINUTES` | `5,15,60,360,1440` | Sperr-Stufen in Minuten (Komma-Liste) |
| `APP_SESSION_TTL` | `43200` | Gültigkeit des Tokens in Sekunden (12 h) |

Beispiel für strengere Regeln: `APP_MAX_ATTEMPTS=3` und `APP_LOCKOUT_MINUTES=10,60,1440`.

### 2.2 Sperre global machen: Vercel KV / Upstash (empfohlen)

Ohne KV liegt der Zähler im Speicher der jeweiligen Serverless-Instanz. Das **funktioniert**, ist
aber nicht global: Bei mehreren gleichzeitig warmen Instanzen könnte eine IP mit etwas Glück
temporär wieder durchrutschen. Mit KV/Redis gilt die Sperre für alle Instanzen.

**Vercel Dashboard:** Projekt → **Storage** → **Create Database** → **KV / Upstash Redis** → mit dem
Projekt verbinden. Vercel setzt dann automatisch:

* `KV_REST_API_URL`
* `KV_REST_API_TOKEN`

Danach **neu deployen**. Die Variablennamen werden auch von Upstash direkt akzeptiert
(`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). Nach dem Deploy steht in der Passwort-Seite
und im Panel `--` dann „Redis verbunden" bzw. „SPERRE GLOBAL (OPTIONAL) ✔".

---

## 3 · Zernio-Versand einrichten

1. Account anlegen: [zernio.com/signup](https://zernio.com/signup) (die ersten 2 verbundenen
   Accounts sind kostenlos).
2. API-Key holen: [zernio.com/dashboard/api-keys](https://zernio.com/dashboard/api-keys) — Format
   `sk_` + 64 Hex-Zeichen.
3. Mindestens einen Social-Account (TikTok, Instagram, YouTube, …) bei Zernio verbinden.
4. In Vercel: **Settings** → **Environment Variables** → **Add New**

   | Feld | Wert |
   | --- | --- |
   | Key | `ZERNIO_API_KEY` |
   | Value | `sk_…` |
   | Environments | Production ✔ Preview ✔ |

   **Kein `VITE_`-Prefix!** Der Key gehört ausschließlich in die Serverless-Functions
   (`api/zernio.js`) und landet nie im Browser.

5. **Redeploy**.
6. Seite entsperren → Panel **`06 · Versand · Zernio`** → der Button **API** lädt den Status:
   grüne LED „ZERNIO_API_KEY VERBUNDEN" + deine Accounts als Chips.

---

## 4 · Sendezeiten einstellen (Standard 06:00 und 20:00)

Alles im Panel **`06 · Versand · Zernio`**, Bereich **„WANN RAUS?"** — vier Modi:

### 4.1 `SOFORT`
Jedes Video geht direkt nach dem Upload raus (`publishNow: true`). Zwischen zwei Videos wartet die
Fabrik trotzdem 3 Sekunden (Zernio-Rate-Limit).

### 4.2 `06 & 20 UHR` (Standard)
Ein Video um **06:00**, das nächste um **20:00**, dann der nächste Tag — bis alle 10 draussen sind.
Beide Zeiten sind **editierbar**:

* Uhrzeit ändern → sofort in der Vorschau „SENDEPLAN (10 VIDEOS)" sichtbar.
* **`+ SENDZEIT`** fügt weitere Uhrzeiten hinzu (z. B. 3 Videos pro Tag: 08:00 / 14:00 / 20:00).
* **`ENTFERNEN`** löscht eine Uhrzeit.
* Vorlagen mit einem Klick: **`06 & 20`** · **`09 & 18`** · **`12 & 19`** · **`3× TÄGLICH`**.

### 4.3 `EIGENE ZEIT` (neu — eine Zeit pro Video)
Für jeden der 10 Clips ein eigenes Datum **und** eine eigene Uhrzeit:

* Oben eine Vorlage (Standard 06:00 / 20:00) → **`ZEITEN ÜBERNEHMEN`** füllt alle 10 Felder
  automatisch (06:00 heute, 20:00 heute, 06:00 morgen …).
* Danach jede Zeile einzeln anpassen (`01` … `10`, `datetime-local`).
* Feld **leer lassen = dieses Video geht sofort raus** (`LEEREN` / `SOFORT`).
* Zeiten in der Vergangenheit zieht die App automatisch auf „jetzt + 2 Minuten" vor und markiert sie
  im Sendeplan gelb mit **`(VORGEZOGEN)`** — so lehnt Zernio nichts ab.
* Alle Zeiten gelten in **Europe/Berlin** (Sommer-/Winterzeit wird automatisch korrekt umgerechnet).

### 4.4 `FLEXIBEL`
Startzeit + fester Abstand (15 Min, 30 Min, 1 h, 2 h, 6 h, 12 h, 1 Tag). Liegt die Startzeit in der
Vergangenheit, wird auf den nächsten freien Takt vorgespult.

### 4.5 Sendeplan-Dialog — pro Post entscheiden (und alle auf einmal in die Queue)

Die vier Modi oben sind die **Vorbelegung**. Beim Klicken auf einen Versand-Button öffnet ein
Fenster, in dem du den Plan für genau diesen Versand festlegst:

* **`→ ZERNIO`** auf einer Unit-Karte (Output Bay `05`) oder ein Chip unter **„Einzelversand"** →
  Dialog für **ein** Video: `SOFORT` · `EIGENE ZEIT` (frei planen, mit Chips `+15 MIN` `+1 STD`
  `+3 STD` `20 UHR` `06 UHR`) · `IN DIE QUEUE` (nächster freier Sendeplatz, Position per `−`/`+`).
* **`10 Videos → Zernio`** im Panel `06` → derselbe Dialog für **alle** fertigen Videos:
  `ALLE SOFORT` · `ALLE → QUEUE` · `FLEXIBEL` (Start + Abstand) · `EIGENE ZEITEN`.
* **`Alle 10 → Queue`** im Panel `06` → **ein Klick, kein Dialog**: alle Videos landen
  gleichzeitig in der Warteschlange, jedes auf dem nächsten freien Sendeplatz.
* Im Dialog zusätzlich: Titel/Hashtags **nur für diesen Versand** (leer = Panel-Wert),
  **„Als Entwurf speichern"**, Ziel-Accounts und die Vorschau **„DEIN SENDEPLAN"**.
* Slots werden nicht doppelt belegt: Was schon in der Queue liegt, zählt mit — ein neuer Post
  rutscht automatisch auf den nächsten freien Zeitpunkt.
* `Esc` = schließen · `Strg/Cmd + Enter` = senden · während eine Queue läuft, wird ein neuer Plan
  einfach angehängt.

> **Extra-Tipp:** Schalter **„ALS ENTWURF SPEICHERN"** aktivieren → die Posts landen als `draft` bei
> Zernio und werden nicht veröffentlicht. Perfekt für den ersten Testlauf mit echtem Key.

---

## 5 · Lokal testen (optional)

```bash
npm install
cat >> .env.local <<'EOF'
APP_PASSWORD=meinSicheresPasswort
ZERNIO_API_KEY=sk_...
EOF
npx vercel dev        # führt /api/auth und /api/zernio lokal aus
```

* `.env.local` steht in `.gitignore` und landet nie im Repo.
* **`npm run dev`** (reiner Vite-Server) führt **keine** Serverless-Functions aus: `/api/auth`
  antwortet nicht, das Gate fällt dann auf `VITE_APP_PASSWORD_HASH` / `VITE_APP_PASSWORD` zurück
  (Browser-Prüfung mit lokalem Zähler). Für realistische Tests also `npx vercel dev` nutzen.

---

## 6 · Alle Environment-Variablen auf einen Blick

| Variable | Prefix | Wo gelesen | Pflicht | Zweck |
| --- | --- | --- | --- | --- |
| `APP_PASSWORD` | keins (Server) | `/api/auth` | **empfohlen** | Passwort im Klartext — beste Wahl |
| `APP_PASSWORD_HASH` | keins (Server) | `/api/auth` | Alternative | SHA-256 des Passworts |
| `APP_MAX_ATTEMPTS` | keins | `/api/auth` | nein | Fehlversuche bis zur Sperre (Standard `5`) |
| `APP_LOCKOUT_MINUTES` | keins | `/api/auth` | nein | Sperr-Stufen in Minuten (Standard `5,15,60,360,1440`) |
| `APP_SESSION_TTL` | keins | `/api/auth` | nein | Token-Gültigkeit in Sekunden (Standard `43200`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | keins | `/api/auth` | nein | globales Rate-Limit (Vercel KV / Upstash) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | keins | `/api/auth` | nein | wie oben (Upstash direkt) |
| `ZERNIO_API_KEY` | keins | `/api/zernio` | für Versand | Zernio-API-Key `sk_…` |
| `ZERNIO_BASE_URL` | keins | `/api/zernio` | nein | eigene API-Basis (Standard `https://zernio.com/api/v1`) |
| `VITE_APP_PASSWORD_HASH` | `VITE_` → Browser | Build + Server | nein | Altbestand / Offline-Fallback für `npm run dev` |
| `VITE_APP_PASSWORD` | `VITE_` → Browser | Build + Server | nein | dito, Klartext (nicht empfohlen) |

Qwen-/Mistral-Keys gehören **nicht** nach Vercel, sondern in die App
(`00 · Machine Settings → AI`) — sie liegen nur im localStorage deines Browsers.

---

## 7 · Deployment-Checkliste

```bash
npm install
npm run typecheck     # TypeScript prüfen
npm run build         # baut dist/ (Single-File)
```

Auf Vercel:

- [ ] `APP_PASSWORD` gesetzt (Production + Preview) — **ohne** `VITE_`
- [ ] optional `APP_MAX_ATTEMPTS` / `APP_LOCKOUT_MINUTES` an die eigenen Nerven angepasst
- [ ] optional Vercel KV verbunden (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)
- [ ] `ZERNIO_API_KEY` gesetzt (**ohne** `VITE_`)
- [ ] **neu deployt** (Redeploy ohne Build-Cache)
- [ ] Seite öffnen → Passwort-Seite → Entsperren funktioniert
- [ ] F5 drücken → Passwort wird erneut verlangt ✔
- [ ] 5× falsch eingeben → Meldung „IP GESPERRT" mit Countdown ✔
- [ ] Panel `--` oben zeigt alle Häkchen grün
- [ ] Panel `06` → Button **API** → grüne LED + Accounts
- [ ] Sendezeiten wählen (Standard 06:00 / 20:00 oder „EIGENE ZEIT") — pro Post im Sendeplan-Dialog, alle auf einmal über **`Alle → Queue`**
- [ ] ersten Testlauf mit **„Als Entwurf speichern"** machen

---

## 8 · Troubleshooting

| Symptom | Ursache / Lösung |
| --- | --- |
| „PRÜFE SPERRE…" hängt und dann ist die App offen | `/api/auth` nicht erreichbar oder `APP_PASSWORD` nicht gesetzt → Variable setzen + **Redeploy** |
| Gate erscheint trotz gesetzter Variable nicht | Variable heißt nicht exakt `APP_PASSWORD` (Tippfehler, Leerzeichen), falsches Environment (Production vs. Preview) oder **nicht neu deployt** |
| „IP GESPERRT" obwohl du es selbst bist | Du hast 5× falsch getippt. Countdown abwarten (5 min … 24 h) oder — wenn du KV nutzt — den Key löschen: Vercel KV → Data Browser → Key mit Prefix `sf:gate:` löschen |
| „crypto.subtle fehlt" | Nur im Offline-Fallback (`npm run dev` ohne Funktionen) und über plain HTTP. Über HTTPS/localhost oder mit `vercel dev` tritt das nicht auf |
| Login klappt, aber Zernio meldet 401 „Nicht freigeschaltet" | Token ist abgelaufen (`APP_SESSION_TTL`) oder die Seite wurde neu geladen → einfach neu entsperren |
| 5 Minuten gewartet, Sperre bleibt | Du hast in der Zwischenzeit weitere Versuche gemacht — jeder Fehlversuch während/nach der Sperre zählt zur nächsten Stufe. Countdown in der Meldung beachten |
| „HINWEIS: OHNE VERCEL KV …" in der Passwort-Seite | Erwartet: ohne KV gilt die Sperre pro Instanz. KV verbinden (Kapitel 2.2), um sie global zu machen |
| Nach dem Passwortwechsel altes Passwort geht noch | Nicht neu deployt oder alte Variable zusätzlich gesetzt (`VITE_APP_PASSWORD` **und** `APP_PASSWORD` → beide gelten). Alte Variable löschen |

---

## 9 · Sicherheit — ehrlich eingeordnet

* Das Passwort verlässt den Server nie: geprüft wird in `/api/auth` (timing-safe), der Wert wird nie
  ausgeliefert. Der Browser bekommt nur ein signiertes Token mit Ablaufzeit (Standard 12 h).
* Das Token liegt **nur im Arbeitsspeicher des Tabs** — F5 = neues Passwort. Genau so ist es
  eingestellt, dadurch hilft ein gestohlenes Cookie/localStorage nichts.
* Die Sperre gilt pro **IP** (nicht pro Passwort), also auch gegen verteiltes Durchprobieren
  einzelner Seitenbesucher. Für den Betrieb hinter einem Proxy zählt der erste Eintrag in
  `x-forwarded-for` — bei Vercel ist das korrekt die Besucher-IP.
* **Grenzen:** Ein Gate vor einer statischen Onepage ist ein Türsteher, kein Tresor. Wer die
  HTML-Datei direkt herunterlädt, kann Teile der Oberfläche sehen — aber **nichts tun**: Der
  Zernio-Versand verlangt das Token, und `ZERNIO_API_KEY` liegt nur serverseitig. Die
  Kamera-/Dateiverarbeitung läuft ohnehin lokal im Browser.
* Wenn du es härter brauchst: zusätzlich **Vercel → Settings → Deployment Protection** aktivieren
  (Passwortschutz auf Plattformebene) und die Domain nur per Einladung teilen.
