#!/usr/bin/env bash
# ── ShortsFactory: Pi-Installer ──────────────────────────────────────────────
# Richtet den Cloud Worker (`server/`) auf einem Raspberry Pi ein:
# Node.js 20, ffmpeg, Fonts, npm-Pakete, Datenverzeichnis, ADMIN_TOKEN
# und optional den systemd-Service + Cloudflare-Tunnel (gratis HTTPS-Domain).
#
# Aufruf auf dem Pi, im Repo-Ordner:
#   bash scripts/pi-install.sh                 # Basis-Installation
#   bash scripts/pi-install.sh --with-service  # + systemd Autostart
#   bash scripts/pi-install.sh --with-tunnel   # + cloudflared installieren
#
# Anleitung (Schritt für Schritt): docs/RASPBERRY_PI.md
set -euo pipefail

WITH_SERVICE=0
WITH_TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --with-service) WITH_SERVICE=1 ;;
    --with-tunnel) WITH_TUNNEL=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *) echo "Unbekannte Option: $arg (erlaubt: --with-service, --with-tunnel)" >&2; exit 1 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$REPO_DIR/server"
DATA_DIR="${DATA_DIR:-/home/pi/shortsfactory-data}"

say()  { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*" >&2; }

# ── 1 · Systempakete ─────────────────────────────────────────────────────────
say "Systempakete: ffmpeg, Fonts, Tools …"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ffmpeg fonts-dejavu-core curl ca-certificates gnupg git openssl

# ── 2 · Node.js ≥ 20 ─────────────────────────────────────────────────────────
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -ge 20 ] 2>/dev/null; then
    need_node=0
    say "Node.js $(node -v) ist bereits installiert ✔"
  fi
fi
if [ "$need_node" = 1 ]; then
  say "Installiere Node.js 20 (NodeSource) …"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
ffmpeg -version | head -n 1

# ── 3 · Server-Abhängigkeiten (nur Production) ───────────────────────────────
say "npm-Pakete für server/ …"
cd "$SERVER_DIR"
npm install --omit=dev

# ── 4 · Datenverzeichnis + .env ──────────────────────────────────────────────
say "Datenverzeichnis + Konfiguration …"
mkdir -p "$DATA_DIR"/{jobs,uploads}

if [ ! -f "$SERVER_DIR/.env" ]; then
  cp "$SERVER_DIR/.env.pi.example" "$SERVER_DIR/.env"
  token="$(openssl rand -hex 32)"
  # ADMIN_TOKEN-Platzhalter ersetzen (macOS-/GNU-sed-kompatibel genug für den Pi)
  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$token|" "$SERVER_DIR/.env"
  # DATA_DIR anpassen, falls per Env überschrieben
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|" "$SERVER_DIR/.env"
  echo "  Neue server/.env angelegt — ADMIN_TOKEN wurde zufällig erzeugt."
  echo "  Token sichern mit:  grep ADMIN_TOKEN $SERVER_DIR/.env"
else
  echo "  server/.env existiert bereits — lasse sie unverändert."
fi

# ── 5 · Rauchtest ────────────────────────────────────────────────────────────
say "Rauchtest: Server kurz starten und /health prüfen …"
set -a
# shellcheck disable=SC1091
source "$SERVER_DIR/.env"
set +a
PORT="${PORT:-8080}"
node src/index.js & SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/tmp/sf-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done
if curl -fsS "http://127.0.0.1:$PORT/health" | head -c 600; then
  echo
  echo "  ✔ Worker antwortet auf Port $PORT"
else
  warn "Der Worker antwortet nicht — Logs oben prüfen."
  exit 1
fi
kill $SRV_PID 2>/dev/null || true
trap - EXIT
wait $SRV_PID 2>/dev/null || true

# ── 6 · optional: systemd-Service ────────────────────────────────────────────
if [ "$WITH_SERVICE" = 1 ]; then
  say "systemd-Service installieren + starten …"
  # WorkingDirectory/EnvironmentFile/User an dieses System anpassen
  me="$(whoami)"
  sed -e "s|^User=.*|User=$me|" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$SERVER_DIR|" \
      -e "s|^EnvironmentFile=.*|EnvironmentFile=$SERVER_DIR/.env|" \
      "$SERVER_DIR/shortsfactory.service" | sudo tee /etc/systemd/system/shortsfactory.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now shortsfactory
  sleep 2
  sudo systemctl --no-pager status shortsfactory | head -n 12 || true
fi

# ── 7 · optional: Cloudflare-Tunnel (gratis HTTPS-Domain) ────────────────────
if [ "$WITH_TUNNEL" = 1 ]; then
  say "cloudflared installieren …"
  if ! command -v cloudflared >/dev/null 2>&1; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
      | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y cloudflared
  fi
  cloudflared --version
  echo
  echo "  Nächster Schritt: Tunnel im Cloudflare-Dashboard anlegen und als"
  echo "  Service laufen lassen — genaue Befehle: docs/RASPBERRY_PI.md, Kap. 3.6."
fi

say "Fertig ✔  Weiter mit docs/RASPBERRY_PI.md (Kap. 3.3 Key erzeugen, 3.6 Domain, 3.9 Mistral)."
