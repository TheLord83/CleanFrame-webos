#!/bin/sh
# install-web.sh - CleanFrame-Config-Server auf einem gerooteten webOS-Fernseher
# einrichten. Wird vom Rechner aus aufgerufen, spricht SSH mit dem Fernseher.
#
#   ./tools/install-web.sh 192.168.1.50
#
# Legt ab:
#   /var/lib/cleanframe/       server.js, lib/, assets/, cleanframectl
#   /var/lib/webosbrew/init.d/52-cleanframe   Autostart
#   Port 8484, Konfiguration /var/lib/cleanframe/config.json
#
# Entfernen: tools/uninstall-web.sh
set -eu
HOST="${1:-}"
[ -n "$HOST" ] || { echo "Aufruf: $0 <tv-ip>"; exit 2; }
SRC="$(cd "$(dirname "$0")/.." && pwd)/web"
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@$HOST"

echo "==> pruefe Fernseher unter $HOST"
$SSH 'test -x /usr/bin/node && echo node: $(/usr/bin/node -v)' || { echo "FEHLER: node fehlt oder SSH nicht erreichbar"; exit 1; }
NODEVER=$($SSH '/usr/bin/node -v' | tr -d '\r' | tr -d 'v' | cut -d. -f1)
[ "${NODEVER:-0}" -ge 8 ] 2>/dev/null || { echo "FEHLER: node >= 8 noetig, gefunden: $NODEVER"; exit 1; }

echo "==> kopiere Server"
$SSH 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets'
scp -q -o StrictHostKeyChecking=no "$SRC/server.js" "root@$HOST:/var/lib/cleanframe/server.js"
scp -q -o StrictHostKeyChecking=no "$SRC"/lib/*.js "root@$HOST:/var/lib/cleanframe/lib/"
scp -q -o StrictHostKeyChecking=no "$SRC"/assets/*.html "$SRC"/assets/*.json "root@$HOST:/var/lib/cleanframe/assets/"
# Icons liegen als Verzeichnis vor; beim Launcher bleiben sie die einzige Quelle,
# hier wird nur der Katalog mitkopiert, damit /api/icons auch ohne Launcher antwortet.
scp -r -q -o StrictHostKeyChecking=no "$SRC"/assets/icons "root@$HOST:/var/lib/cleanframe/assets/" 2>/dev/null || true
scp -q -o StrictHostKeyChecking=no "$SRC/cleanframectl" "root@$HOST:/var/lib/cleanframe/cleanframectl"
$SSH 'chmod +x /var/lib/cleanframe/cleanframectl'

echo "==> Autostart"
scp -q -o StrictHostKeyChecking=no "$SRC/init.d/52-cleanframe" "root@$HOST:/var/lib/webosbrew/init.d/52-cleanframe"
$SSH 'chmod +x /var/lib/webosbrew/init.d/52-cleanframe'

echo "==> starte Dienst"
$SSH '/var/lib/cleanframe/cleanframectl restart'
sleep 1
$SSH '/var/lib/cleanframe/cleanframectl status' || true

echo "==> Oberflaeche: http://$HOST:8484/  (API: /api/health, /api/config, /api/apps)"
