#!/usr/bin/env python3
"""─ ShortsFactory × Mistral: Agent-Beispiel ───────────────────────────────────

Zeigt das Prinzip „Mistral greift per Server-URL auf den Pi zu":

1. Dem Mistral-Modell wird ein Tool `create_shorts_job` angeboten (Function
   Calling / Tool Use) — dahinter steckt dein Pi-Backend (POST /v1/jobs).
2. Das Modell schreibt Skripte + ruft das Tool auf, dieses Skript führt den
   echten HTTP-Call gegen den Pi aus, pollt bis zum fertigen Video und
   meldet die Download-Links ans Modell zurück.

Benötigt:
    pip install mistralai
    export MISTRAL_API_KEY=...          # Key von console.mistral.ai
    export SF_BASE_URL=https://dein-pi.de   # deine gratis Domain (Kap. 3.6)
    export SF_API_KEY=sfk_...           # Key vom Pi (POST /v1/keys)
    export SF_VIDEO_URL=https://example.com/hintergrund.mp4  # direkte MP4-URL

Start:
    python3 scripts/mistral-agent-example.py "2 Videos über WG-Streit"

Doku: docs/RASPBERRY_PI.md, Kapitel 3.9.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

from mistralai import Mistral

SF_BASE = os.environ.get("SF_BASE_URL", "").rstrip("/")
SF_KEY = os.environ.get("SF_API_KEY", "")
VIDEO_URL = os.environ.get("SF_VIDEO_URL", "")
MODEL = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")

for name, val in [("SF_BASE_URL", SF_BASE), ("SF_API_KEY", SF_KEY),
                  ("SF_VIDEO_URL", VIDEO_URL), ("MISTRAL_API_KEY", os.environ.get("MISTRAL_API_KEY"))]:
    if not val:
        sys.exit(f"Fehlt: {name} als Umgebungsvariable setzen (siehe Kopf dieser Datei).")


def sf_call(method: str, path: str, payload: dict | None = None) -> dict:
    """Ein HTTP-Call gegen das Pi-Backend (sfk_-Auth, JSON)."""
    req = urllib.request.Request(
        SF_BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {SF_KEY}", "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode())


# ── Tool-Definition für Mistral (JSON Schema, OpenAI-kompatibel) ──────────────
TOOLS = [{
    "type": "function",
    "function": {
        "name": "create_shorts_job",
        "description": (
            "Rendert Hochkant-Shorts (9:16, MP4) auf dem ShortsFactory-Server. "
            "Jeder Eintrag in 'scripts' wird ein eigenes Video mit eigener "
            "Stimme, Captions und Reddit-Intro-Karte. Gibt eine Job-ID zurück; "
            "die Videos sind danach einzeln herunterladbar."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scripts": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 10,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string",
                                      "description": "Titel für die Intro-Karte (wird zuerst gesprochen)."},
                            "script": {"type": "string",
                                        "description": "Kompletter Erzähltext, Englisch, ~110-280 Wörter."},
                        },
                        "required": ["title", "script"],
                    },
                },
            },
            "required": ["scripts"],
        },
    },
}]


def create_shorts_job(scripts: list[dict]) -> dict:
    """Führt den Tool-Call aus: Job am Pi anlegen → pollen → Links liefern."""
    created = sf_call("POST", "/v1/jobs", {
        "videoUrl": VIDEO_URL,
        "count": len(scripts),
        "scripts": scripts,
        "settings": {"quality": "540"},  # Pi 3B+: 540p ist deutlich schneller
    })
    job_id = created["job"]["id"]
    print(f"  ⏳ Job {job_id} läuft auf dem Pi …", flush=True)

    while True:  # pollen bis done/partial/failed (Pi braucht pro Short Minuten)
        time.sleep(20)
        job = sf_call("GET", f"/v1/jobs/{job_id}")["job"]
        done, total = job["progress"]["done"], job["progress"]["total"]
        print(f"  … {job['status']} ({done}/{total})", flush=True)
        if job["status"] in ("done", "partial", "failed", "canceled"):
            videos = [
                f"{SF_BASE}{u['videoPath']}?api_key={SF_KEY}"
                for u in job["units"] if u["status"] == "done" and u["videoPath"]
            ]
            return {"job_id": job_id, "status": job["status"], "videos": videos}


def main() -> None:
    wish = " ".join(sys.argv[1:]) or "2 lustige Videos über WG-Streit auf Englisch"
    client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])

    messages: list[dict] = [
        {"role": "system", "content": (
            "Du bist ein Shorts-Produzent. Schreibe zu jedem Wunsch eigenständig "
            "komplette, virale First-Person-Reddit-Stories (Englisch, je ~180 Wörter) "
            "und rufe dann create_shorts_job auf. Fasse dich danach kurz.")},
        {"role": "user", "content": wish},
    ]

    print(f"🤖 Mistral ({MODEL}) plant …")
    resp = client.chat.complete(model=MODEL, messages=messages, tools=TOOLS, tool_choice="auto")
    msg = resp.choices[0].message
    messages.append(msg)

    if not msg.tool_calls:
        print("Modell hat kein Tool aufgerufen. Antwort:\n", msg.content)
        return

    for call in msg.tool_calls:
        args = json.loads(call.function.arguments)
        print(f"🔧 Tool-Call: {call.function.name} mit {len(args.get('scripts', []))} Skript(en)")
        result = create_shorts_job(args["scripts"])
        messages.append({
            "role": "tool",
            "tool_call_id": call.id,
            "name": call.function.name,
            "content": json.dumps(result),
        })

    final = client.chat.complete(model=MODEL, messages=messages)
    print("\n🤖 Mistral:\n", final.choices[0].message.content)


if __name__ == "__main__":
    main()
