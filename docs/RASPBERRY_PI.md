# 🥧 ShortsFactory auf dem Raspberry Pi 3B+ — eigener Server, gratis Domain, Mistral-Anbindung

> **Kurzantwort auf deine Frage:** Ja — dein **Raspberry Pi 3B+ kann der Server** sein.
> Das Backend in [`server/`](../server) läuft auf dem Pi, eine **stabile öffentliche
> HTTPS-Adresse** (Tailscale Funnel, ohne Portfreigabe) macht es weltweit erreichbar, und
> **Mistral / beliebige AI-Agents greifen per Server-URL + OpenAPI-Spec + API-Key**
> darauf zu — exakt wie bei der [Railway-Variante](RAILWAY.md), nur **0 €/Monat**
> statt 5 €. **Nirgends ist eine Kreditkarte nötig** — kein Railway, keine Domain,
> kein kostenpflichtiger Dienst (Kap. 1).
> Ehrliche Grenze: Der 3B+ rendert **langsam** (Kap. 4) — als Nacht-Fabrik top,
> als Echtzeit-Maschine eher nicht.

---

## 0 · Der konkrete Plan (Überblick)

| Schritt | Was | Wo in dieser Anleitung |
| --- | --- | --- |
| 1 | Pi OS 64-bit + SSH + Updates | Kap. 3.1 |
| 2 | Repo klonen, `pi-install.sh` laufen lassen (Node 20, ffmpeg, Worker) | Kap. 3.2 |
| 3 | `.env` prüfen, Worker als systemd-Service starten | Kap. 3.3–3.4 |
| 4 | Lokal testen: `GET /health` | Kap. 3.5 |
| 5 | **Stabile öffentliche HTTPS-URL** via Tailscale Funnel (kein Portforwarding, keine Karte, keine Domain) | Kap. 3.6 |
| 6 | API-Key (`sfk_…`) erzeugen, Zugriff von außen testen | Kap. 3.7 |
| 7 | App anbinden (Panel `07 · CLOUD-FABRIK · SERVER`) | Kap. 3.8 |
| 8 | **Mistral anbinden: Server-URL + `/v1/openapi.json` + Key** | Kap. 3.9 |

Zeitaufwand: ca. **1–2 Stunden** beim ersten Mal (inkl. gratis Tailscale-Account, keine Karte).

## 1 · Was du brauchst

**Hardware (vorhanden):**

* Raspberry Pi 3B+ (1 GB RAM — reicht, siehe Kap. 4), Netzteil (offizielles 5V/2,5A),
  microSD **≥ 16 GB** (besser 32 GB, Class A1/A2), **LAN-Kabel empfohlen** (WLAN geht,
  ist aber langsamer und instabiler bei langen Uploads).
* Optional, aber sinnvoll: kleine Kühlkörper/Lüfter (Volllast über Stunden wird warm),
  USB-Stick/SSD als Datengrab statt SD-Karte (Kap. 4).

**Gratis-Accounts (der einzige Pflicht-Account ist Nr. 1 — ohne Karte):**

1. **[Tailscale](https://tailscale.com/)** (Personal-Tarif: **dauerhaft gratis, keine
   Kreditkarte nötig** [1](https://costbench.com/software/business-vpn/tailscale/))
   — Login per GitHub/Google/Microsoft, 1 Minute. Liefert die **stabile öffentliche
   HTTPS-URL** (`https://dein-pi.tail1234.ts.net`) für App + Mistral.
2. Optional, erst später wenn du willst: [Mistral API-Key](https://console.mistral.ai/)
   für echte AI-Stories im Worker und das Agent-Beispiel. **Ohne Key läuft alles** —
   der Worker nutzt den Offline-Storywriter, und Mistral (Le Chat, gratis) kann den
   Pi trotzdem per Server-URL ansteuern (Kap. 3.9).
3. **NICHT nötig:** kein Railway (genau das ersetzen wir), keine eigene Domain,
   kein Cloudflare-Account, **nirgends eine Kreditkarte**.

## 2 · Architektur (was läuft wo)

```
┌─────────────┐   HTTPS    ┌──────────────┐  Tunnel (outbound,   ┌─────────────────────┐
│ Dein Browser│ ─────────▶ │  Tailscale   │ ── kein offener ───▶ │  Raspberry Pi 3B+   │
│ / Handy     │            │  Funnel      │    Port nötig!       │  :8080              │
├─────────────┤            │  (gratis,    │                      │  server/index.js    │
│ Mistral /   │ ─────────▶ │   stabile    │                      │  · REST-API /v1/*   │
│ AI-Agents   │  Server-URL│   ts.net-URL │                      │  · ffmpeg rendert   │
└─────────────┘  + sfk_-Key│  + HTTPS)    │                      │  · Edge-TTS (out)   │
                           └──────────────┘                      │  · Qwen/Mistral(out)│
                                                                └─────────────────────┘
```

* Der Pi baut **von innen** eine verschlüsselte Verbindung zu Tailscale auf —
  deshalb braucht es **keine Portfreigabe** in der FritzBox, keine statische IP,
  kein DynDNS, keine eigene Domain, und es funktioniert auch hinter
  **CGNAT / DS-Lite** (Kabel/Vodafone).
* Die App (Vercel) und Mistral sehen nur `https://dein-pi.tail1234.ts.net` — Funnel
  ist auf **allen Tailscale-Plänen inklusive** [2](https://tunnels.io/compare/tailscale),
  die URL ist **stabil über Neustarts** und das HTTPS-Zertifikat kommt automatisch.
* Schwerstarbeit (ffmpeg) läuft **sequenziell**: ein Video nach dem anderen, damit
  1 GB RAM nicht platzt. Genau dafür ist der Worker schon gebaut (`worker.js`).

## 3 · Schritt für Schritt

### 3.1 Pi vorbereiten

1. **Pi OS Lite (64-bit)** mit dem [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
   auf die SD-Karte flashen. Im Imager unter „Settings“ (Zahnrad) gleich setzen:
   Hostname `shortsfactory`, **SSH aktivieren**, WLAN (falls kein LAN), User `pi` + Passwort.
2. Pi per LAN anschließen, booten, per SSH verbinden:
   ```bash
   ssh pi@shortsfactory.local
   ```
3. Updates + Basis:
   ```bash
   sudo apt update && sudo apt full-upgrade -y
   sudo apt install -y git
   ```

### 3.2 Repo klonen + Installer laufen lassen

```bash
cd ~
git clone https://github.com/Woolvayne/short-factory-3-beta.git
cd short-factory-3-beta
bash scripts/pi-install.sh --with-service
```

Das Skript (idempotent, kann mehrfach laufen) erledigt:

* `ffmpeg` + Fonts + Tools per apt
* **Node.js 20** (falls älter/fehlend)
* `npm install --omit=dev` in `server/`
* Datenverzeichnis `/home/pi/shortsfactory-data`
* `server/.env` aus `.env.pi.example` inkl. **zufälligem `ADMIN_TOKEN`**
* Rauchtest (`/health`) und mit `--with-service` den **systemd-Autostart**

Mit `--with-funnel` installiert es zusätzlich **Tailscale** (Kap. 3.6, empfohlen),
mit `--with-tunnel` alternativ `cloudflared` (nur für die optionale
Cloudflare-Variante mit eigener Domain).

### 3.3 `.env` prüfen

```bash
cat server/.env
```

Pflicht ist nur `ADMIN_TOKEN` (wurde zufällig erzeugt — **sichern**, z. B. im
Passwort-Manager). Pi-Tuning ist schon voreingestellt:

| Variable | Pi-Wert | Warum |
| --- | --- | --- |
| `PI_MODE=1` | an | erscheint in `/health` als `"profile":"pi"` |
| `FFMPEG_PRESET=ultrafast` | statt `veryfast` | ~30–50 % schneller, Dateien etwas größer |
| `DEFAULT_QUALITY=540` | statt 720 | „auto“ rendert 540p — halbiert die Zeit auf dem 3B+ |
| `MAX_JOBS=3` | statt 6 | schont die SD-Karte |
| `QWEN_API_KEY` / `MISTRAL_API_KEY` | optional | echte AI-Stories statt Offline-Writer |

Änderungen danach: `sudo systemctl restart shortsfactory`.

### 3.4 Service verwalten

```bash
sudo systemctl status shortsfactory     # Status
journalctl -u shortsfactory -f          # Live-Logs (Strg+C = raus)
sudo systemctl restart shortsfactory    # nach .env-Änderungen
```

### 3.5 Lokal testen

```bash
curl -s http://localhost:8080/health | head -c 500; echo
# → {"ok":true,"service":"shortsfactory-cloud-worker",…,"profile":"pi",…} ✔
```

### 3.6 Stabile öffentliche HTTPS-URL (Tailscale Funnel — empfohlen, 0 €, keine Karte)

**Warum diese Variante:** Tailscale Personal ist **dauerhaft gratis ohne Kreditkarte**
[1](https://costbench.com/software/business-vpn/tailscale/), **Funnel ist auf allen
Plänen inklusive** [2](https://tunnels.io/compare/tailscale) und liefert eine
**stabile öffentliche HTTPS-Adresse** (`https://dein-pi.tail1234.ts.net`) —
ohne Portfreigabe, ohne Domain-Kauf, ohne DynDNS, hinter jedem Router (auch
CGNAT/DS-Lite). Zertifikat automatisch, URL überlebt Neustarts. Das ist die
**Server-URL für App + Mistral**.

1. **Tailscale installieren** (einmalig, auf dem Pi):
   ```bash
   bash scripts/pi-install.sh --with-funnel   # oder manuell:
   # curl -fsSL https://tailscale.com/install.sh | sh
   ```
2. **Anmelden:**
   ```bash
   sudo tailscale up
   # → zeigt einen Login-Link; im Browser öffnen und mit GitHub/Google/Microsoft
   #    einloggen (neuer Personal-Tarif, gratis, KEINE Karte). Fertig in 1 Minute.
   ```
3. **Im Tailscale-Admin** ([login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)):
   **MagicDNS → Enabled** und **HTTPS → Enabled** (2 Klicks, gratis).
4. **Funnel einschalten:**
   ```bash
   sudo tailscale funnel --bg 8080
   # → https://shortsfactory.tail1234.ts.net  ✔  GENAU DIESE URL NOTIEREN!
   #    (Name/Zahl sind bei dir anders — nimm deine echte Ausgabe.)
   ```
   Status prüfen: `tailscale funnel status`. Nach einem Reboot bleibt alles aktiv
   (tailscaled startet automatisch, Funnel-Konfig ist persistent).
5. **Test von außen** (Handy mit **mobilen Daten**, WLAN aus!):
   ```bash
   curl https://shortsfactory.tail1234.ts.net/health
   # → {"ok":true,…} ✔  Jetzt ist dein Pi weltweit erreichbar.
   ```

Gut zu wissen: Die URL ist kryptisch, aber stabil. Fair Use reicht locker für
API-Calls + MP4-Downloads. Alle `/v1/*`-Aufrufe brauchen weiterhin deinen
`sfk_…`-Key (Kap. 3.7 + 5) — Funnel allein schützt nichts, es macht nur erreichbar.

**Alternative A · Cloudflare Tunnel mit eigener Domain (optional, erst später):**

Schönere URL (`https://sf.deine-domain.de`), aber: Domain kostet ~10 €/Jahr **und**
Cloudflare fragt beim Zero-Trust-Onboarding **ggf. nach einer Kreditkarte**
([Quelle](https://www.cloudflare.com/zero-trust/trial)) — deshalb **nicht** der
No-Card-Weg. Falls du später willst: Domain auf Cloudflare-Nameserver zeigen →
Zero Trust → Networks → Tunnels → Tunnel anlegen → `cloudflared` per
`pi-install.sh --with-tunnel` installieren → Public Hostname auf
`http://localhost:8080` zeigen. Anleitungen:
[1](https://raspberrytips.com/cloudflare-selfhosted-website/)
[2](https://raspberry.tips/en/raspberrypi-einsteiger/raspberry-pi-cloudflare-tunnel-en)
[3](https://berkem.xyz/blog/hosting-n8n-on-raspberry-pi/)

**Alternative B · Cloudflare Quick Tunnel (nur zum Testen, 30 Sekunden):**

```bash
cloudflared tunnel --url http://localhost:8080
# → https://…trycloudflare.com — Wechselt bei JEDEM Neustart, Ratenlimits.
```

Ohne Domain im Cloudflare-Account gibt es **keinen stabilen** benannten Tunnel —
für eine stabile No-Card-URL nimm Funnel (oben).

**Sonst nicht empfohlen:**

| Alternative | Warum nicht |
| --- | --- |
| FritzBox-Portfreigabe + DuckDNS + Let's Encrypt | gratis ohne Karte, aber fummlig, bricht bei CGNAT/DS-Lite, Pi direkt im Internet — nur als Notfall-Plan |
| ngrok Free | URL wechselt, Warnseite vor der API, Limits |
| IPv6-Freigaben | fummelig, nicht alle Clients/Agents spielen sauber mit |

### 3.7 API-Key erzeugen + Zugriff von außen testen

```bash
# Auf dem Pi (ADMIN_TOKEN aus server/.env):
export SF=https://shortsfactory.tail1234.ts.net
curl -X POST $SF/v1/keys \
  -H "Authorization: Bearer DEIN_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"label":"mein-handy"}'
# → { "ok":true, "id":"key_…", "key":"sfk_…" }  ← EINMALIG anzeigen, sichern!

# Von überall testen:
curl -s $SF/health
curl -s $SF/v1/openapi.json | head -c 200
curl -s $SF/v1/jobs -H "Authorization: Bearer sfk_…"   # → {"ok":true,"jobs":[]} ✔
```

**Pro Agent ein eigener Key mit Label** (`mistral-agent`, `mein-handy` …) — dann kannst
du einzeln widerrufen: `DELETE /v1/keys/key_xxx` (mit `ADMIN_TOKEN`).

### 3.8 App anbinden (Panel `07 · CLOUD-FABRIK · SERVER`)

1. App öffnen (Vercel-URL) → ganz unten Panel **`07 · CLOUD-FABRIK · SERVER`**.
2. **Backend-URL** = `https://shortsfactory.tail1234.ts.net`, **API-Key** = `sfk_…` → **TEST**.
   Grüne LED = verbunden ✔ (bleibt im localStorage des Geräts).
3. Wie gewohnt: Ideen in `01`, Quelle in `02` (**1 SOURCE → 10**), optional Musik in `03`.
4. **„n VIDEOS IN DER CLOUD RENDERN“** → sobald der Job angenommen ist: **Tab zu.**
   Der Pi rendert weiter (Stunden ok!) — später MP4s herunterladen, auch vom Handy.

Tipp: Stelle in `00 · Settings → VIDEO` die Qualität auf **540p** — das ist auf dem
3B+ der Sweet Spot (Kap. 4).

### 3.9 Mistral anbinden (Server-URL und mehr)

Dein Pi spricht **REST + OpenAPI** — also genau das, was AI-Agents brauchen.
Mistral-Modelle unterstützen **Function Calling / Tool Use** (Tools als JSON-Schema
definieren, Modell ruft sie auf, dein Code führt sie aus) [1](https://techjacksolutions.com/ai-tools/mistral/mistral-api-guide/)
[2](https://myengineeringpath.dev/tools/mistral-guide/) — und das Backend liefert die
Maschinen-Spec gleich mit.

**Die drei Dinge, die Mistral von dir braucht („Server URL und mehr“):**

| # | Was | Beispiel |
| --- | --- | --- |
| 1 | **Server-URL** (Basis) | `https://shortsfactory.tail1234.ts.net` |
| 2 | **OpenAPI-Spec** (alle Endpunkte, maschinenlesbar) | `https://shortsfactory.tail1234.ts.net/v1/openapi.json` |
| 3 | **API-Key** (ein eigener pro Agent) | `sfk_…` (Header `Authorization: Bearer sfk_…`) |

**Copy-paste-fähiger Prompt für einen Agenten (Le Chat, Mistral AI Studio, Custom Bot, n8n …):**

> „Lies die API-Spec unter `https://shortsfactory.tail1234.ts.net/v1/openapi.json`.
> Dein API-Key ist `sfk_…` (Header `Authorization: Bearer …`).
> Erstelle 2 Shorts aus dem Hintergrundvideo `https://example.com/gameplay.mp4`
> (direkte MP4-URL!): schreibe komplette englische Skripte (~180 Wörter), lege den
> Job per `POST /v1/jobs` an (`scripts` als `[{title, script}]`, `settings.quality`
> bitte `540`), polle `GET /v1/jobs/{id}` bis `done` und gib mir die MP4-Links.“

**Die wichtigsten Endpunkte** (alle mit `Authorization: Bearer sfk_…`):

```
POST /v1/jobs                 Render-Job anlegen (fire & forget)
GET  /v1/jobs/:id             Fortschritt pollen (title + script pro Unit)
GET  /v1/jobs/:id/videos/:n   fertiges MP4 laden (auch ?api_key=sfk_…)
POST /v1/tts                  nur Stimme (MP3-Base64 + Wort-Timestamps)
POST /v1/uploads              Hintergrundvideo/Musik hochladen → uploadId
GET  /v1/openapi.json         die Spec für den Agenten (ohne Auth lesbar)
```

**Fertiges Python-Beispiel** (Mistral Tool-Call → Pi-Job → Polling → MP4-Links):

```bash
pip install mistralai
export MISTRAL_API_KEY=... SF_BASE_URL=https://shortsfactory.tail1234.ts.net \
       SF_API_KEY=sfk_... SF_VIDEO_URL=https://example.com/hintergrund.mp4
python3 scripts/mistral-agent-example.py "2 Videos über WG-Streit"
```

Regeln für Agents (wichtig!): `videoUrl` muss eine **direkte, öffentliche MP4-Datei**
sein — Plattform-Links (YouTube, TikTok …) werden aus rechtlichen Gründen abgelehnt,
genau wie in der Browser-App. Details: [RAILWAY.md](RAILWAY.md) (API identisch —
nur die URL ist deine Pi-Domain).

## 4 · Ehrliche Leistungserwartung (Pi 3B+)

Der 3B+ hat 4× Cortex-A53 (1,4 GHz) + **1 GB RAM** — ffmpeg encodiert per Software
(`libx264`). Richtwerte für ein ~50-s-Short (gemessen an vergleichbaren ARM-Boards;
der Hardware-Encoder des Pi 3 schafft ~27 fps nur für simple Webcam-Streams [3](https://www.hackster.io/news/chris-griffith-puts-the-raspberry-pi-s-hardware-h-264-encoder-through-its-paces-1d804e538d9e)
— unser Full-Pipeline-Render mit Filtern/ASS liegt darunter):

| Qualität | Preset | ca. Zeit / Short | 10er-Batch |
| --- | --- | --- | --- |
| **540p** (Pi-Empfehlung) | `ultrafast` | **~4–8 Min** | ~0,7–1,5 h (über Nacht ✔) |
| 720p | `ultrafast` | ~8–15 Min | ~1,5–2,5 h |
| 1080p | — | nicht empfohlen | SD-Karte + RAM sagen nein |

**So holst du das Maximum raus:**

* `DEFAULT_QUALITY=540` + `FFMPEG_PRESET=ultrafast` (schon voreingestellt).
* **Ein Job nach dem anderen** — der Worker macht das automatisch (Queue).
* **Kühlung**: Kühlkörper oder Mini-Lüfter; Pi nicht in die Schublade legen.
* **LAN statt WLAN**, Netzteil original (Unterspannung → Throttling → doppelte Zeit).
* Daten auf **USB-Stick/SSD** statt SD-Karte: `DATA_DIR=/mnt/usb/…` in `.env`
  (SD-Karten sterben an vielen Schreibzyklen; außerdem schneller).
* `MAX_JOBS=3` lassen; fertige MP4s zeitnah herunterladen.
* TTS (Stimme) ist netzwerkgebunden und dauert nur Sekunden — der Engpass ist ffmpeg.

**Fazit:** Als **24/7-Nacht-Fabrik + API für Mistral** ist der 3B+ super.
Für „10 Videos in 10 Minuten“ brauchst du mehr Wumms (Kap. 7).

## 5 · Sicherheit (kurz, aber wichtig)

* `ADMIN_TOKEN` lang & zufällig (Installer erzeugt eines) — **nie** in Git/Chat posten.
* **Pro Agent ein `sfk_…`-Key** mit Label; ungenutzte widerrufen (`DELETE /v1/keys/…`).
* Tailscale Funnel = Pi braucht **keine offenen Ports** im Router — trotzdem: Pi-User-Passwort
  stark, SSH-Key statt Passwort erwägen, `sudo apt update && sudo apt upgrade` monatlich.
* Denk dran: Die Funnel-URL ist **öffentlich** — `/health` und `/v1/openapi.json` sind
  absichtlich lesbar, aber alle Aktionen brauchen deinen `sfk_…`-Key. Keys nie posten.
* Backup: `/home/pi/shortsfactory-data/keys.json` + `jobs.json` gelegentlich kopieren
  (darin: nur Key-**Hashes**, keine Secrets ✔).

## 6 · Kosten: 0 €/Monat

| Posten | Kosten |
| --- | --- |
| Pi 3B+ (vorhanden) | 0 € |
| Tailscale Personal + Funnel (stabile `*.ts.net`-URL + HTTPS) | 0 €, keine Karte |
| Eigene Domain (optional, nur für eine schönere URL) | ~10 €/Jahr — oder weglassen = 0 € |
| Edge-TTS-Stimmen, Offline-Stories | 0 € |
| Strom (Pi 3B+ ~2–4 W, ~25 kWh/Jahr) | ~8 €/**Jahr** |
| Mistral (Le Chat gratis zur Agent-Steuerung; API-Key optional) | 0 € für den Start |

## 7 · Troubleshooting

| Symptom | Ursache / Fix |
| --- | --- |
| `curl localhost:8080/health` → keine Antwort | `journalctl -u shortsfactory -50` lesen; meist `.env`-Tippfehler → `sudo systemctl restart shortsfactory` |
| Von außen: `521/522/530` (nur Cloudflare-Alternative) | Tunnel offline: `sudo systemctl status cloudflared`; Token in `/etc/shortsfactory-tunnel.env` prüfen |
| Von außen: Funnel-URL lädt nicht | `tailscale funnel status` prüfen; Admin → DNS → MagicDNS + HTTPS an? Danach `sudo tailscale funnel --bg 8080` erneut |
| `tailscale funnel` meldet Policy/Permission-Fehler | Admin → Access Controls → `nodeAttrs` ergänzen: `{"target":["autogroup:member"],"attr":["funnel"]}` (nur falls gefordert) |
| `401 API key invalid` | `sfk_…` vollständig kopiert? Key pro Agent; notfalls neuen via `ADMIN_TOKEN` erzeugen |
| Job hängt auf `rendering` ewig | normal auf dem 3B+ (Kap. 4)! Bei >30 Min/Short: Kühlung + Netzteil prüfen (`vcgencmd get_throttled` — `0x0` = ok) |
| `file was pruned` / Jobs weg | `MAX_JOBS` erreicht oder Pi neugestartet ohne Datenverzeichnis — MP4s zeitnah laden |
| SD-Karte voll | `du -sh /home/pi/shortsfactory-data`; `MAX_JOBS` senken, alte Jobs per `DELETE /v1/jobs/:id` löschen |
| TTS-Fehler `502` | Microsoft-Endpunkt klemmt (kostenlos = manchmal wackelig) — Job einfach erneut anlegen; Test mit `TTS_FAKE=1` |

## 8 · Upgrade-Pfad (wenn der 3B+ zu langsam wird)

1. **Pi 4/5** (4–8 GB): gleiches Setup, ~3–5× schneller — einfach SD-Karte umziehen + `pi-install.sh` erneut.
2. **Mini-PC / alter Laptop** (x86, Debian): gleiches Setup, noch schneller.
3. **Hybrid**: Pi als Always-on-API + Queue, schwere Batches zusätzlich auf
   [Railway](RAILWAY.md) (Panel 07 kann per URL umschalten — Keys bleiben getrennt).
4. **Nur TTS/Stories auf dem Pi**, Render im Browser (Tab offen) — null Wartezeit-Änderung, null Kosten.

---

*Siehe auch: [RAILWAY.md](RAILWAY.md) (Cloud-Alternative, identische API) ·
[ANLEITUNG.md](ANLEITUNG.md) (App-Details) · `server/.env.pi.example` ·
`scripts/mistral-agent-example.py`*
