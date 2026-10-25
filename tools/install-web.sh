#!/bin/sh
# install-web.sh - set up the CleanFrame config server on a rooted webOS TV.
# Called from the desktop machine, it talks SSH to the TV.
#
#   ./tools/install-web.sh 192.168.1.50
#
# Installs:
#   /var/lib/cleanframe/       server.js, lib/, assets/, cleanframectl
#   /var/lib/webosbrew/init.d/52-cleanframe   autostart
#   port 8484, configuration /var/lib/cleanframe/config.json
#
# Removal: tools/uninstall-web.sh
set -eu
HOST="${1:-}"
[ -n "$HOST" ] || { echo "Usage: $0 <tv-ip>"; exit 2; }
SRC="$(cd "$(dirname "$0")/.." && pwd)/web"
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@$HOST"

echo "==> checking TV at $HOST"
$SSH 'test -x /usr/bin/node && echo node: $(/usr/bin/node -v)' || { echo "ERROR: node missing or SSH unreachable"; exit 1; }
NODEVER=$($SSH '/usr/bin/node -v' | tr -d '\r' | tr -d 'v' | cut -d. -f1)
[ "${NODEVER:-0}" -ge 8 ] 2>/dev/null || { echo "ERROR: node >= 8 required, found: $NODEVER"; exit 1; }

echo "==> copying server"
$SSH 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets'
scp -q -o StrictHostKeyChecking=no "$SRC/server.js" "root@$HOST:/var/lib/cleanframe/server.js"
scp -q -o StrictHostKeyChecking=no "$SRC"/lib/*.js "root@$HOST:/var/lib/cleanframe/lib/"
scp -q -o StrictHostKeyChecking=no "$SRC"/assets/*.html "$SRC"/assets/*.json "root@$HOST:/var/lib/cleanframe/assets/"
# The icons exist as a directory; for the launcher they stay the only source,
# here only the catalog is copied along so /api/icons answers without the launcher too.
scp -r -q -o StrictHostKeyChecking=no "$SRC"/assets/icons "root@$HOST:/var/lib/cleanframe/assets/" 2>/dev/null || true
scp -q -o StrictHostKeyChecking=no "$SRC/cleanframectl" "root@$HOST:/var/lib/cleanframe/cleanframectl"
$SSH 'chmod +x /var/lib/cleanframe/cleanframectl'

echo "==> autostart"
scp -q -o StrictHostKeyChecking=no "$SRC/init.d/52-cleanframe" "root@$HOST:/var/lib/webosbrew/init.d/52-cleanframe"
$SSH 'chmod +x /var/lib/webosbrew/init.d/52-cleanframe'

echo "==> starting service"
$SSH '/var/lib/cleanframe/cleanframectl restart'
# The service needs a moment: only report once the health check answers.
i=0
until $SSH 'curl -sS -m 3 http://127.0.0.1:8484/api/health' 2>/dev/null | grep -q '"ok":true'; do
  i=$((i+1)); [ "$i" -ge 20 ] && { echo "ERROR: service does not answer on port 8484"; exit 1; }; sleep 1
done
$SSH '/var/lib/cleanframe/cleanframectl status' || true

echo "==> interface: http://$HOST:8484/  (API: /api/health, /api/config, /api/apps)"
