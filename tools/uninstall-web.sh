#!/bin/sh
# uninstall-web.sh - CleanFrame-Config-Server entfernen. Der Launcher bleibt.
set -eu
HOST="${1:-}"
[ -n "$HOST" ] || { echo "Aufruf: $0 <tv-ip>"; exit 2; }
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@$HOST"
echo "==> stoppe Dienst"
$SSH '/var/lib/cleanframe/cleanframectl stop || true'
echo "==> entferne Autostart und Dateien"
$SSH 'rm -f /var/lib/webosbrew/init.d/52-cleanframe; rm -rf /var/lib/cleanframe; echo entfernt'
