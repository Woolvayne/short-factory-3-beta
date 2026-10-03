# ☁️ Cloud-Fabrik auf Railway — Videos rendern ohne offenen Tab + API-Keys für AI-Agents

> **Kurzantwort auf beide Fragen:**
>
> 1. **„Kann man mit Railway ein Backend bauen, sodass man einen Knopf drückt und ohne offenen
>    Tab Videos erstellt werden?"** → **Ja.** Genau das liegt jetzt in [`server/`](../server):
>    ein Node.js-Worker mit ffmpeg, der die komplette Pipeline (Story → Stimme → Captions →
>    Render) serverseitig ausführt. In der App gibt es dafür das neue Panel
>    **`07 · CLOUD-FABRIK · RAILWAY`** — Knopf drücken, Tab zu, später (auch vom Handy)
>    herunterladen.
> 2. **„Kann man API-Keys für AI-Agents generieren, damit beliebige AIs Videos erstellen?"**
>    → **Ja.** Das Backend hat eine eingebaute Key-Verwaltung (`sfk_…`-Keys, nur als SHA-256-Hash
>    gespeichert) und eine **OpenAPI-Spezifikation** unter `/v1/openapi.json`, die jeder
>    AI-Agent (Claude, ChatGPT, eigene Bots, n8n, Zapier …) direkt lesen und benutzen kann.
>
> **Zu „Railway Free":** Railway hat seit August 2023 **keinen dauerhaft kostenlosen
> Volltarif** mehr. Es gibt (Stand 2026): **Trial** = einmalig **$5 Guthaben für 30 Tage**
> (reicht locker zum Aufbauen und für viele Renderläufe) und danach einen sehr kleinen
> **Free-Plan (~$1 Guthaben/Monat, 0,5 GB RAM)** bzw. **Hobby für $5/Monat**. Mit dem hier
> aktivierten **App-Sleeping** (Service schläft, wenn keine Anfragen kommen) kommt man mit
> sehr wenig Guthaben aus — für Dauerbetrieb ist der Hobby-Plan ($5/Monat) die ehrliche
> Empfehlung. Details unten in [Kosten & Grenzen](#kosten--grenzen-ehrlich).

---

## 1 · Was das Backend kann

| Feature | Browser-Fabrik (bisher) | Cloud-Fabrik (`server/`) |
| --- | --- | --- |
| Render-Ort | Canvas + MediaRecorder **im Tab** | **ffmpeg auf dem Server** |
| Tab muss offen bleiben | ✔ (Echtzeit-Capture) | ✖ — Knopf drücken, Tab zu |
| Stories | Qwen/Mistral/Offline | gleich (Keys per Job oder Railway-Env) |
| Stimme | Edge Read-Aloud via `/api/tts` | gleiche Protokoll-Implementierung, direkt im Worker |
| Captions (wortsynchron) | Canvas | eingebrannt via ASS-Untertitel (gleiche Wort-Timestamps) |
| Reddit-Intro-Karte | mit Flug-Animation | **vereinfachte statische Karte** (Fade statt Flug) |
| Auflösung | bis 1080p | 540/720/1080 (Standard „auto" = 720p — kleine Cloud-Box) |
| Zugriff | nur du im Tab | **REST-API mit API-Keys → auch für AI-Agents** |

Der Worker rendert **einen Job nach dem anderen, ein Video nach dem anderen** — bewusst,
denn auf 0,5–1 GB RAM ist kein Platz für parallele ffmpeg-Prozesse.

## 2 · Auf Railway deployen (Schritt für Schritt)

1. **Account:** [railway.com](https://railway.com) → mit GitHub anmelden (Trial: $5 Guthaben).
2. **Projekt:** *New Project → Deploy from GitHub repo* → dieses Repository wählen.
3. **Root Directory setzen (wichtig!):** Service → *Settings → Source → Root Directory* →
   **`server`** eintragen. Railway findet dann automatisch das `Dockerfile`
   (Node 20 + ffmpeg + Fonts) und die `railway.json` (Healthcheck `/health`, App-Sleeping an).
4. **Variablen:** Service → *Variables*:

   | Variable | Wert | Pflicht? |
   | --- | --- | --- |
   | `ADMIN_TOKEN` | langes Zufallsgeheimnis (z. B. `openssl rand -hex 32`) | **ja** — schaltet die Key-Verwaltung frei |
   | `QWEN_API_KEY` | DashScope-Key | optional (sonst Offline-Storywriter) |
   | `MISTRAL_API_KEY` | Mistral-Key | optional |
   | `MAX_UPLOAD_MB` | Upload-Limit, Standard `500` | optional |
   | `MAX_JOBS` | wie viele fertige Jobs auf der Platte bleiben, Standard `6` | optional |

5. **Volume (empfohlen):** Rechtsklick auf den Service → *Attach Volume* → Mount Path **`/data`**.
   Ohne Volume funktioniert alles, aber Jobs/Keys sind nach jedem Deploy/Neustart weg.
   (Trial/Free: 0,5–1 GB Volume — deshalb räumt der Worker alte Jobs automatisch ab.)
6. **Domain:** Service → *Settings → Networking → Generate Domain* →
   `https://…up.railway.app`. Das ist die **Backend-URL** für App und Agents.
7. **Test:** `curl https://DEINE-URL.up.railway.app/health` → `{"ok":true,…}` ✔

## 3 · API-Key für dich / für AI-Agents erzeugen

```bash
# 1) Key erzeugen (nur mit ADMIN_TOKEN möglich):
curl -X POST https://DEINE-URL.up.railway.app/v1/keys \
  -H "Authorization: Bearer DEIN_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"label":"claude-agent"}'
# → { "ok":true, "id":"key_…", "key":"sfk_…" }   ← key wird GENAU EINMAL angezeigt!

# Keys auflisten / widerrufen:
curl https://…/v1/keys -H "Authorization: Bearer DEIN_ADMIN_TOKEN"
curl -X DELETE https://…/v1/keys/key_xxx -H "Authorization: Bearer DEIN_ADMIN_TOKEN"
```

Gespeichert wird **nur der SHA-256-Hash** — ein geleakter Server verrät keine Keys.
Pro Agent ein eigener Key mit Label, dann kann man einzeln widerrufen.

## 4 · Knopf in der App: `07 · CLOUD-FABRIK · RAILWAY`

Unten in der App (nach dem Zernio-Panel):

1. **Backend-URL** (`https://…up.railway.app`) und **API-Key** (`sfk_…`) eintragen → **TEST**
   (grüne LED = verbunden). Beides bleibt im localStorage dieses Geräts.
2. Wie gewohnt: Ideen in `01`, Quelle in `02` (**1 SOURCE → 10**; Datei wird hochgeladen,
   eine Direkt-URL wird direkt vom Server geladen), optional Musik in `03`.
3. **„n VIDEOS IN DER CLOUD RENDERN"** drücken. Sobald der Job in der Liste auftaucht:
   **Tab zu.** Die Jobliste zeigt beim nächsten Öffnen (egal welches Gerät mit URL+Key)
   Fortschritt pro Video und **MP4-Download-Buttons**.

## 5 · So erstellt ein AI-Agent Videos (Beispiel)

Die maschinenlesbare Spezifikation liegt unter **`GET /v1/openapi.json`** — einem Agent
reicht der Satz: *„Lies https://DEINE-URL.up.railway.app/v1/openapi.json und erstelle mit
dem Key sfk_… drei Videos aus diesem Hintergrundvideo."*

```bash
# Job anlegen (feuern & vergessen — Client darf sofort trennen):
curl -X POST https://DEINE-URL.up.railway.app/v1/jobs \
  -H "Authorization: Bearer sfk_…" -H "content-type: application/json" \
  -d '{
    "videoUrl": "https://example.com/gameplay.mp4",
    "count": 2,
    "scripts": [
      {
        "title": "My roommate stole my meal prep for three months",
        "script": "I labelled every container in the fridge, but my roommate kept taking them. I finally left one with a harmless surprise note, and the next morning the entire building knew what had been happening."
      },
      "My boss scheduled a meeting during my wedding, so I sent the calendar invite to everyone."
    ],
    "settings": { "voice": "en-US-AndrewNeural", "storyStyle": "revenge", "quality": "720", "introOn": true }
  }'
# → { "job": { "id": "job_…", "status": "queued", "units": [{ "title": "…", "script": "…" }] } }

# Status pollen bis done/partial:
curl https://…/v1/jobs/job_… -H "Authorization: Bearer sfk_…"

# Fertige MP4s laden (Header ODER ?api_key=…):
curl -OJ "https://…/v1/jobs/job_…/videos/1?api_key=sfk_…"
```

Regeln für Agents: `videoUrl` muss eine **direkte, öffentlich erreichbare Videodatei**
sein (MP4/WebM) — Plattform-Links (YouTube, TikTok …) lehnt der Server ab, aus denselben
rechtlichen Gründen wie die Browser-App. Ein Agent kann das komplette Skript selbst als JSON
schreiben: `scripts` ist ein Array aus Strings oder Objekten wie
`{"title":"Mein Titel","script":"Der vollständige Text …"}`. Das `title`-Feld landet auf der
Intro-Karte und wird bei aktiviertem Intro als **allererster gesprochener Satz** verwendet.
`ideas` bleiben als Fallback für fehlende Einträge möglich; fehlende Skripte erzeugt der Server
über Qwen/Mistral oder den Offline-Writer. Das alte Feld `stories` bleibt als Alias kompatibel.
Die Antwort von `POST /v1/jobs` und jedes Polling-Ergebnis enthält pro Unit `title` und `script`,
damit der Agent den tatsächlich verwendeten Text prüfen kann.

## 6 · Nur die Stimme erzeugen — Railway als Ersatz für Supabase TTS

Ja, dein Agent kann die Stimme auch separat erstellen. Das Railway-Backend hat dafür
`POST /v1/tts`. Der Agent schickt Text und bekommt MP3-Audio als Base64 plus
Wort-Timestamps zurück. Es wird kein Supabase-Projekt und kein Supabase-TTS-Key benötigt:

```bash
curl -X POST https://DEINE-URL.up.railway.app/v1/tts \\
  -H "Authorization: Bearer sfk_…" \\
  -H "content-type: application/json" \\
  -d '{
    "text": "Das ist der Text, den dein Agent sprechen lassen möchte.",
    "voice": "de-DE-ConradNeural",
    "rate": 0,
    "pitch": 0
  }' > tts.json

jq -r .audioBase64 tts.json | base64 -d > voice.mp3
```

`words` ist ein Array mit `text`, `offset` und `duration` in Sekunden. Damit kann dein
Agent eigene Untertitel synchronisieren. Bekannte Stimmen sind zum Beispiel
`de-DE-ConradNeural`, `de-DE-KatjaNeural`, `en-US-AndrewNeural`, `en-US-JennyNeural`
und `en-GB-RyanNeural`; die verfügbaren Edge-Stimmen können sich ändern.

**Agenten-Workflow:**

1. `GET https://DEINE-URL.up.railway.app/v1/openapi.json` lesen.
2. Mit `Authorization: Bearer sfk_…` `POST /v1/tts` aufrufen, wenn nur Audio nötig ist.
3. Die Base64-Zeichenkette dekodieren und als `voice.mp3` speichern — oder direkt
   `POST /v1/jobs` verwenden; dort erledigt der Worker TTS, Captions und ffmpeg bereits
   automatisch im Hintergrund.

Damit ist der frühere Supabase-TTS-Call durch denselben HTTP-Agentenfluss ersetzt. Wichtig:
Der Worker verwendet die öffentlich erreichbare Microsoft-Edge-Read-Aloud-Schnittstelle,
nicht eine Railway-eigene Sprach-KI. Railway hostet also den Code; es fallen keine
zusätzlichen TTS-API-Keys an, aber die Internetverbindung zum Dienst muss funktionieren.
Für kommerziell kritische oder SLA-pflichtige Nutzung sollte später ein offizieller
TTS-Anbieter ergänzt werden.

## 7 · Kosten & Grenzen (ehrlich)

* **Railway Trial:** einmalig $5 / 30 Tage, bis 1 GB RAM — reicht für den Aufbau und
  reichlich 720p-Renderläufe. **Kein dauerhafter Gratis-Volltarif.**
* **Free-Plan danach:** ~$1 Guthaben/Monat, 0,5 GB RAM, 0,5 GB Volume. Ein always-on-Service
  verbraucht mehr — darum ist in `railway.json` **App-Sleeping aktiviert**: der Worker
  schläft ohne Anfragen und kostet dann fast nichts. Für gelegentliche Batches kann das
  reichen; für regelmäßigen Betrieb: **Hobby-Plan $5/Monat** (enthält $5 Nutzung — bei
  diesem Workload meist damit abgedeckt).
* **Wichtig bei App-Sleeping:** Während ein Job rendert, ist der Service wach (HTTP-Polling
  des Jobs hält ihn zusätzlich wach). Schlafende Services brauchen beim ersten Request ein
  paar Sekunden zum Aufwachen.
* **Renderzeit:** ffmpeg auf 1 vCPU rendert ein ~50-s-Short in 720p in etwa 1–3 Minuten;
  10 Stück laufen sequenziell durch (~15–30 Min pro Batch). Auf 1080p entsprechend länger.
* **Speicher:** kleine Volumes → der Worker löscht Zwischendateien sofort und behält nur die
  letzten `MAX_JOBS` fertigen Jobs. Fertige Videos zeitnah herunterladen.
* **Intro-Karte:** serverseitig als **vereinfachte statische Reddit-Karte** (Fade statt
  Flug-Animation) mit eingebettetem Standard-Snoo-Profilbild neben dem Namen. Wer die volle
  Flug-Animation will, nutzt weiter den Browser-Render.
* **Edge-TTS:** derselbe (kostenlose) Microsoft-Endpunkt wie bisher — gleiche
  Intermittenz-Realität, gleiche Retry-Logik. Für Tests ohne Microsoft-Endpunkt:
  Railway-Variable `TTS_FAKE=1` rendert mit stummer Tonspur + gleichmäßigen Wort-Timings.

## 8 · Lokal testen

```bash
cd server
npm install
ADMIN_TOKEN=test npm run dev     # http://localhost:8080/health
# ffmpeg muss im PATH sein (oder FFMPEG_PATH/FFPROBE_PATH setzen)
```
