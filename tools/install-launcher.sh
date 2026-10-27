#!/usr/bin/env bash
# install-launcher.sh — put CleanFrame (the start page) on an LG TV.
#
# No SSH, no root, no Python needed for the install itself: it talks to Glasshouse
# on port 8080, which is the same door the Homebrew Channel uses. Root is only
# needed for the hub, and the hub is a separate script.
#
#   ./tools/install-launcher.sh                  # find the TV, install the IPK
#   ./tools/install-launcher.sh --tv 192.168.1.50
#   ./tools/install-launcher.sh --ipk foo.ipk    # a release IPK instead of building one
#   ./tools/install-launcher.sh --dry-run        # detect and print the plan only
#   ./tools/install-launcher.sh --lang de        # German prompts
#
# Before running: Glasshouse installed and opened once on the TV. Without it there
# is nothing that accepts an IPK, and without Glasshouse the launcher has no app
# list either.
#
# The IPK is built locally when none is given; that needs python3. If python3 is
# missing, the script says so and points at Glasshouse's own "install from a file".
#
# See also: install-hub.sh (the settings page, needs root), docs/ROOTING.md (root).
set -uo pipefail

TV="${TV:-}"
IPK="${IPK:-}"
DRY=0
YES=0
CF_LANG="${CF_LANG:-en}"
APPID="com.blackpearl.cleanframe"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=lib/msg.sh
. "$HERE/lib/msg.sh"

usage() { sed -n '2,20p' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tv)       TV="${2:-}"; shift 2 ;;
    --ipk)      IPK="${2:-}"; shift 2 ;;
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
answers "$TV" || { msg no_glass "$TV" >&2; exit 1; }
msg glass_ok "$TV"

# ---- the IPK -----------------------------------------------------------------
if [ -z "$IPK" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    msg no_python >&2
    exit 1
  fi
  IPK="$ROOT/dist/cleanframe_all.ipk"
  if [ "$DRY" = "1" ]; then
    msg plan_build "$TV"
  else
    msg ipk_build
    mkdir -p "$ROOT/dist"
    python3 "$ROOT/tools/build-ipk.py" "$ROOT/app" "$IPK" >/dev/null || { echo "IPK build failed" >&2; exit 1; }
  fi
else
  [ -f "$IPK" ] || { echo "no such file: $IPK" >&2; exit 1; }
  msg plan "$IPK" "$TV"
fi

if [ "$DRY" = "1" ]; then
  msg dry
  exit 0
fi

# ---- confirm -----------------------------------------------------------------
if [ "$YES" = "0" ]; then
  printf '%s' "$(msg ask)"
  antwort=""
  { read -r antwort </dev/tty; } 2>/dev/null || antwort="y"
  case "$antwort" in n|N|no|nein) msg aborted; exit 0 ;; esac
fi

# ---- install -----------------------------------------------------------------
msg install "$APPID"
# --quiet: the JSON line of install-ipk.py is for scripts that parse it, not for
# a person watching an install run.
python3 "$HERE/install-ipk.py" --tv "$TV" --ipk "$IPK" --quiet || exit 1

# ---- verify: the app list is the only thing that counts ----------------------
APPS="$(curl -sS -m 10 "http://$TV:8080/api/apps" 2>/dev/null)"
VERSION="$(printf '%s' "$APPS" | python3 -c '
import json, sys
try:
    apps = json.load(sys.stdin).get("installed", [])
except Exception:
    sys.exit(1)
for a in apps:
    if a.get("id") == sys.argv[1]:
        print(a.get("version", "?"))
        break
' "$APPID" 2>/dev/null)"
[ -n "$VERSION" ] || { msg verify_fail "$APPID" >&2; exit 1; }
msg installed "$APPID" "$VERSION"

# ---- start it once: "installed" is not "on screen" ---------------------------
curl -sS -m 10 -X POST "http://$TV:8080/api/control" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"launchApp\",\"value\":\"$APPID\"}" >/dev/null 2>&1 \
  && msg launched || msg launch_fail

msg hub_note "$TV"
exit 0
