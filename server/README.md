# ShortsFactory Cloud Worker (Railway)

Serverseitiger Renderer: **Knopf drücken → Tab schließen → Videos werden trotzdem
fertig** — plus **API-Keys für AI-Agents** (`sfk_…`), damit beliebige AIs per REST
Videos erstellen können.

* Vollständige Anleitung (Deutsch): [`../docs/RAILWAY.md`](../docs/RAILWAY.md)
  (Cloud) oder [`../docs/RASPBERRY_PI.md`](../docs/RASPBERRY_PI.md)
  (**Raspberry Pi 3B+**, 0 €/Monat, gratis HTTPS-Domain, Mistral-Anbindung)
* Maschinenlesbare API-Spec: `GET /v1/openapi.json`
* Deploy Railway: Service mit **Root Directory `server`** → Dockerfile wird
  automatisch gebaut (Node 20 + ffmpeg). Pflicht-Variable: `ADMIN_TOKEN`.
  Volume auf `/data` empfohlen.
* Deploy Pi: `bash scripts/pi-install.sh --with-service` auf dem Pi —
  Vorlage: `server/.env.pi.example`, Service: `server/shortsfactory.service`.
  Pi-Tuning per Env: `PI_MODE=1`, `FFMPEG_PRESET=ultrafast`, `DEFAULT_QUALITY=540`.

```
POST /v1/keys                 API-Key erzeugen (Bearer ADMIN_TOKEN)
POST /v1/uploads              Hintergrundvideo/Musik hochladen (Bearer sfk_…)
POST /v1/jobs                 Render-Job anlegen (fire & forget; `scripts` erlaubt komplette Agent-Skripte)
GET  /v1/jobs/:id             Fortschritt pollen (inkl. `title` + verwendetem `script`)
GET  /v1/jobs/:id/videos/:n   fertiges MP4 laden (auch ?api_key=sfk_…)
POST /v1/tts                 nur Stimme erzeugen (MP3 + Wort-Timestamps als JSON)
```

Ein Agent kann vollständige Skripte direkt als JSON liefern:

```json
{
  "videoUrl": "https://example.com/background.mp4",
  "count": 1,
  "scripts": [{
    "title": "Der Titel der Reddit-Karte",
    "script": "Der komplette Text, der nach dem Titel gesprochen wird."
  }],
  "settings": { "introOn": true, "quality": "720" }
}
```

Der Titel der Karte wird bei aktiviertem Intro zuerst gesprochen. Die Job-Antwort enthält
`title` und `script` pro Unit; `stories` bleibt als Legacy-Alias für `scripts` erhalten.

Nur TTS (ohne Video) kann ein Agent ebenfalls über Railway anfordern:

```bash
curl -X POST https://DEINE-URL.up.railway.app/v1/tts \\
  -H "Authorization: Bearer sfk_…" -H "content-type: application/json" \\
  -d '{"text":"Das ist eine Stimme aus Railway.","voice":"de-DE-ConradNeural","rate":0,"pitch":0}' \\
  | jq -r .audioBase64 | base64 -d > voice.mp3
```

Die Antwort enthält neben `audioBase64` (MP3) auch `duration` und `words` mit
`offset`/`duration` in Sekunden — damit kann der Agent eigene Captions synchronisieren.
Railway erzeugt die Stimme hier direkt über Microsoft Edge Read-Aloud (keinen Supabase-
TTS-Aufruf und keinen zusätzlichen API-Key); der Dienst benötigt aber Internetzugriff.
Die Stimme ist nicht dauerhaft garantiert: für produktionskritische Nutzung empfiehlt sich
ein bezahlter TTS-Anbieter mit SLA. Der Agent kann einfach `/v1/openapi.json` lesen und
`POST /v1/tts` oder `POST /v1/jobs` selbst aufrufen.
