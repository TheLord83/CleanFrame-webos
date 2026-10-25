#!/usr/bin/env bash
# Alle Pruefungen in einem Lauf — lokal und in der CI.
#
# Reihenfolge: erst die schnellen, abhaengigkeitsfreien Pruefungen (Syntax,
# node-8-Vertraeglichkeit, Icons), dann die API-Tests, zuletzt die Pruefungen,
# die einen Browser brauchen (Tasten und Live-Uebernahme).
#
# Was das Skript selbst startet, raeumt es am Ende auch wieder ab.
#
# Aufruf:  tools/check-all.sh [--keep]   (--keep laesst Server und Chrome laufen)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

PORT_SERVER=8484
PORT_DEBUG=9333
FAILED=0
PIDS=()
TMPDIR_RUN="$(mktemp -d)"

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "  info  Server (Port $PORT_SERVER) und Chrome (Port $PORT_DEBUG) laufen weiter"
    return
  fi
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
  rm -rf "$TMPDIR_RUN"
}
trap cleanup EXIT

step() { printf '\n=== %s\n' "$1"; }

# Eine Pruefung gilt nur als bestanden, wenn sie mit 0 endet UND ihre
# Zusammenfassung ausgibt. Sonst waere ein Test, der still nichts tut, gruen —
# genau das ist am 25.10.2026 passiert (fehlender Aufruf der Hauptfunktion).
run() {
  local name="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -qE "bestanden|in Ordnung"; then
    echo "  --> $name: FEHLGESCHLAGEN"
    FAILED=1
  else
    echo "  --> $name: bestanden"
  fi
}

# ---------------------------------------------------------------- Syntax
step "1/5 Syntax der Quellen"
for f in app/*.js web/*.js web/lib/*.js tools/*.js; do
  node --check "$f" || { echo "  Syntaxfehler: $f"; FAILED=1; }
done
[ "$FAILED" = "0" ] && echo "  --> alle JavaScript-Dateien lesbar"

# ------------------------------------------------- node 8 (Fernseher)
step "2/5 Vertraeglichkeit mit node 8.12 (Fernseher)"
run "node-8-Pruefung" python3 tools/check-node8.py

# --------------------------------------------------------------- Icons
step "3/5 Icon-Bibliothek"
run "Icon-Pruefung" python3 tools/check-icons.py

# ------------------------------------------------------------ API-Tests
step "4/5 Konfigurations-Server (API)"
run "API-Pruefungen" python3 tools/test-web-api.py

# --------------------------------------- Server + Chrome fuer die UI-Tests
step "5/5 Oberflaeche (Tasten und Live-Uebernahme)"
if ! curl -sf -m 3 "http://127.0.0.1:$PORT_SERVER/api/health" >/dev/null 2>&1; then
  echo "  starte Konfigurations-Server auf Port $PORT_SERVER"
  CF_PORT="$PORT_SERVER" \
  CF_CONFIG="$TMPDIR_RUN/config.json" \
  CF_CLIENT_LOG="$TMPDIR_RUN/client.log" \
  CF_STUB_APPS="$ROOT/web/test/fixtures/apps-stub.json" \
  CF_WALL_DIR="$ROOT/app/assets/wallpapers" \
  CF_GLASSHOUSE="http://127.0.0.1:9" \
  node web/server.js >"$TMPDIR_RUN/server.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 40); do
    curl -sf -m 2 "http://127.0.0.1:$PORT_SERVER/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

if ! curl -sf -m 3 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1; then
  CHROME="${CHROME:-}"
  if [ -z "$CHROME" ]; then
    for c in "${CHROME:-}" "$HOME/.agent-browser/browsers"/*/chrome google-chrome chrome chromium chromium-browser; do
      [ -x "$c" ] && CHROME="$c" && break
      ls "$c"/*/chrome >/dev/null 2>&1 && CHROME="$(ls "$c"/*/chrome | head -1)" && break
    done
  fi
  if [ -z "$CHROME" ]; then
    echo "  --> Oberflaechen-Pruefungen: uebersprungen (kein Chrome gefunden)"
    FAILED=1
  else
    echo "  starte Chrome auf Port $PORT_DEBUG ($CHROME)"
    "$CHROME" --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files \
      --remote-debugging-port="$PORT_DEBUG" about:blank >"$TMPDIR_RUN/chrome.log" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 60); do
      curl -sf -m 2 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1 && break
      sleep 0.25
    done
  fi
elif [ -z "${CHROME:-}" ]; then
  # bereits laufender Chrome: Pfad fuer die Meldung ermitteln
  CHROME="$(command -v google-chrome || echo 'laufender Chrome')"
fi

if curl -sf -m 3 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1; then
  run "Tastenpruefungen" node tools/test-ui-keys.js --port "$PORT_DEBUG" --config "http://127.0.0.1:$PORT_SERVER/api/config"
  run "Live-Uebernahme" node tools/test-live-apply.js --port "$PORT_DEBUG" --server "http://127.0.0.1:$PORT_SERVER"
fi

# ------------------------------------------------------------- Ergebnis
printf '\n'
if [ "$FAILED" = "0" ]; then
  echo "Alle Pruefungen bestanden."
else
  echo "Mindestens eine Pruefung ist fehlgeschlagen."
fi
exit "$FAILED"
