#!/usr/bin/env bash
# install-hub.sh — set up the CleanFrame Hub on a rooted TV, over SSH.
#
# The hub is the part that cannot be an IPK: it is a node process that keeps
# serving the settings page, so it needs a directory in /var/lib, an autostart and
# a port. That is why this script exists and why it needs root.
#
#   ./tools/install-hub.sh                      # find the TV, install the hub
#   ./tools/install-hub.sh --tv 192.168.1.50
#   ./tools/install-hub.sh --tv 192.168.1.50 --lang de
#   ./tools/install-hub.sh --tv 192.168.1.50 --dry-run
#
# This script does not root a TV and does not try to. If SSH answers as a normal
# user, it stops and says so: rooting is the Homebrew Channel's job (docs/ROOTING.md
# has the path that was used here, unsupported).
#
# Installs:
#   /var/lib/cleanframe/                     server.js, lib/, assets/, cleanframectl
#   /var/lib/webosbrew/init.d/52-cleanframe  autostart
#   port 8484, configuration /var/lib/cleanframe/config.json
#
# Removal: tools/uninstall-web.sh <tv-ip>  (the launcher stays)
set -uo pipefail

TV="${TV:-}"
DRY=0
YES=0
CF_LANG="${CF_LANG:-en}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/web"
# shellcheck source=lib/msg.sh
. "$HERE/lib/msg.sh"

usage() { sed -n '2,20p' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tv)       TV="${2:-}"; shift 2 ;;
    --dry-run)  DRY=1; shift ;;
    --yes|-y)   YES=1; shift ;;
    --lang)     CF_LANG="${2:-en}"; shift 2 ;;
    -h|--help)  usage ;;
    -*)         echo "unknown option: $1" >&2; exit 2 ;;
    *)          TV="$1"; shift ;;
  esac
done
export CF_LANG

# shellcheck source=lib/find-tv.sh
. "$HERE/lib/find-tv.sh"

if [ -z "$TV" ]; then
  msg find >&2
  TV="$(find_tv)" || { msg find_none >&2; exit 1; }
fi
msg found "$TV"

SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o LogLevel=ERROR root@$TV"
SCP="scp -q -o StrictHostKeyChecking=no -o LogLevel=ERROR"
UID_="$($SSH 'id -u' 2>/dev/null | tr -d '\r')" || true
[ -n "${UID_:-}" ] || { msg ssh_fail "$TV" >&2; exit 1; }
[ "$UID_" = "0" ] || { msg not_root "$UID_" >&2; exit 1; }
msg rooted "$UID_"

NODEVER="$($SSH '/usr/bin/node -v' 2>/dev/null | tr -d '\r' | tr -d 'v')"
NODE_MAJOR="${NODEVER%%.*}"
case "${NODE_MAJOR:-x}" in
  ''|*[!0-9]*) msg no_node "${NODEVER:-none}" >&2; exit 1 ;;
esac
[ "$NODE_MAJOR" -ge 8 ] || { msg no_node "$NODEVER" >&2; exit 1; }
msg node_ok "$NODEVER"

if [ "$DRY" = "1" ]; then
  msg plan "$SRC" "$TV"
  msg dry
  exit 0
fi

if [ "$YES" = "0" ]; then
  printf '%s' "$(msg ask)"
  antwort=""
  { read -r antwort </dev/tty; } 2>/dev/null || antwort="y"
  case "$antwort" in n|N|no|nein) msg aborted; exit 0 ;; esac
fi

msg copy
$SSH 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets'
$SCP "$SRC/server.js" "root@$TV:/var/lib/cleanframe/server.js" || exit 1
$SCP "$SRC"/lib/*.js "root@$TV:/var/lib/cleanframe/lib/" || exit 1
$SCP "$SRC"/assets/*.html "$SRC"/assets/*.json "root@$TV:/var/lib/cleanframe/assets/" || exit 1
# The icon catalog is copied along so /api/icons answers without the launcher too.
$SCP -r "$SRC"/assets/icons "root@$TV:/var/lib/cleanframe/assets/" 2>/dev/null || true
# Without the language files the interface shows keys instead of words.
$SCP -r "$SRC"/assets/lang "root@$TV:/var/lib/cleanframe/assets/" || exit 1
$SCP "$SRC/cleanframectl" "root@$TV:/var/lib/cleanframe/cleanframectl" || exit 1
$SSH 'chmod +x /var/lib/cleanframe/cleanframectl'

msg autostart
$SCP "$SRC/init.d/52-cleanframe" "root@$TV:/var/lib/webosbrew/init.d/52-cleanframe" || exit 1
$SSH 'chmod +x /var/lib/webosbrew/init.d/52-cleanframe'

msg start
$SSH '/var/lib/cleanframe/cleanframectl restart'
# Only report once the health check answers: starting is not running.
i=0
until $SSH 'curl -sS -m 3 http://127.0.0.1:8484/api/health' 2>/dev/null | grep -q '"ok":true'; do
  i=$((i+1))
  if [ "$i" -ge 20 ]; then
    msg health_fail "$TV" >&2
    exit 1
  fi
  sleep 1
done

msg hub_ready "$TV"
msg removal "$TV"
exit 0
