#!/bin/sh
# uninstall-web.sh - remove the CleanFrame config server. The launcher stays.
set -eu
HOST="${1:-}"
[ -n "$HOST" ] || { echo "Usage: $0 <tv-ip>"; exit 2; }
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 root@$HOST"
echo "==> stopping service"
$SSH '/var/lib/cleanframe/cleanframectl stop || true'
echo "==> removing autostart and files"
$SSH 'rm -f /var/lib/webosbrew/init.d/52-cleanframe; rm -rf /var/lib/cleanframe; echo removed'
