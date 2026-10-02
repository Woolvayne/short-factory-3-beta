# ShortsFactory Cloud Worker (Railway)

Serverseitiger Renderer: **Knopf drücken → Tab schließen → Videos werden trotzdem
fertig** — plus **API-Keys für AI-Agents** (`sfk_…`), damit beliebige AIs per REST
Videos erstellen können.

* Vollständige Anleitung (Deutsch): [`../docs/RAILWAY.md`](../docs/RAILWAY.md)
* Maschinenlesbare API-Spec: `GET /v1/openapi.json`
* Deploy: Railway-Service mit **Root Directory `server`** → Dockerfile wird
  automatisch gebaut (Node 20 + ffmpeg). Pflicht-Variable: `ADMIN_TOKEN`.
  Volume auf `/data` empfohlen.

```
POST /v1/keys                 API-Key erzeugen (Bearer ADMIN_TOKEN)
POST /v1/uploads              Hintergrundvideo/Musik hochladen (Bearer sfk_…)
POST /v1/jobs                 Render-Job anlegen (fire & forget; `scripts` erlaubt komplette Agent-Skripte)
GET  /v1/jobs/:id             Fortschritt pollen (inkl. `title` + verwendetem `script`)
GET  /v1/jobs/:id/videos/:n   fertiges MP4 laden (auch ?api_key=sfk_…)
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
