#!/usr/bin/env bash
# install.sh — both parts in one run, for people who know what they are doing.
#
# This is the wrapper around install-launcher.sh and install-hub.sh: the launcher
# always, the hub only when the TV is rooted. Rooting itself is not part of it.
#
#   ./tools/install.sh                   # find the TV, install launcher (+ hub if rooted)
#   ./tools/install.sh --tv 192.168.1.50
#   ./tools/install.sh --launcher-only   # no hub, no SSH, nothing to be root for
#   ./tools/install.sh --hub-only        # settings page on an already installed launcher
#   ./tools/install.sh --info            # model, webOS, node, root - change nothing
#   ./tools/install.sh --dry-run         # detect and print the plan only
#   ./tools/install.sh --lang de         # German prompts
#
# Rooting, if it is missing, is documented in docs/ROOTING.md and is not this
# script's job: the Homebrew Channel explains how to root a TV, and everything here
# expects that to be done already.
#
# Normal use is the two scripts this one calls:
#   ./tools/install-launcher.sh <tv>     # the app, no SSH, no root
#   ./tools/install-hub.sh <tv>          # the settings page, SSH as root
set -uo pipefail

TV="${TV:-}"
IPK="${IPK:-}"
DO_LAUNCHER=1
DO_HUB=1
DO_INFO=0
DRY=0
YES=0
CF_LANG="${CF_LANG:-en}"
APPID="com.blackpearl.cleanframe"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=lib/msg.sh
. "$HERE/lib/msg.sh"
# shellcheck source=lib/find-tv.sh
. "$HERE/lib/find-tv.sh"

usage() { sed -n '2,22p' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tv)            TV="${2:-}"; shift 2 ;;
    --ipk)           IPK="${2:-}"; shift 2 ;;
    --launcher-only) DO_HUB=0; shift ;;
    --hub-only)      DO_LAUNCHER=0; shift ;;
    --info)          DO_INFO=1; shift ;;
    --dry-run)       DRY=1; shift ;;
    --yes|-y)        YES=1; shift ;;
    --lang)          CF_LANG="${2:-en}"; shift 2 ;;
    -h|--help)       usage ;;
    -*)              echo "unknown option: $1" >&2; exit 2 ;;
    *)               TV="$1"; shift ;;
  esac
done
export CF_LANG

if [ -z "$TV" ]; then
  msg find >&2
  TV="$(find_tv)" || { msg find_none >&2; exit 1; }
fi
msg found "$TV"

ssh_uid() { ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o LogLevel=ERROR "root@$TV" 'id -u' 2>/dev/null | tr -d '\r'; }

# ---- --info is a report, never a step ---------------------------------------
if [ "$DO_INFO" = "1" ]; then
  LAUNCHERVER="$(cat "$ROOT/VERSION" 2>/dev/null || echo '?')"
  HUBVER="$(sed -n "s/^var VERSION *= *'\([^']*\)'.*/\1/p" "$ROOT/web/server.js" 2>/dev/null | head -1)"
  printf '    launcher: %s (this repo)\n    hub:      %s\n' "${LAUNCHERVER:-?}" "${HUBVER:-?}"
  if command -v python3 >/dev/null 2>&1; then
    python3 "$HERE/tvinfo.py" "$TV" 2>/dev/null | sed 's/^/    /'
  fi
  UID_="$(ssh_uid)"
  if [ -n "${UID_:-}" ] && [ "$UID_" = "0" ]; then
    printf '    root:     yes\n'
    printf '    node:     %s\n' "$(ssh -o StrictHostKeyChecking=no "root@$TV" '/usr/bin/node -v' 2>/dev/null | tr -d '\r')"
  else
    printf '    root:     no (the launcher runs without it, the hub does not)\n'
  fi
  exit 0
fi

# ---- the plan ---------------------------------------------------------------
if [ "$DO_LAUNCHER" = "1" ]; then
  if [ -n "$IPK" ]; then msg plan "$IPK" "$TV"; else msg plan_build "$TV"; fi
fi
if [ "$DO_HUB" = "1" ]; then
  if [ "$(ssh_uid)" = "0" ]; then
    msg plan "$ROOT/web" "$TV"
  else
    msg hub_skipped "$TV"
    DO_HUB=0
  fi
fi

if [ "$DRY" = "1" ]; then
  msg dry
  exit 0
fi

if [ "$YES" = "0" ]; then
  printf '%s' "$(msg ask)"
  antwort=""
  { read -r antwort </dev/tty; } 2>/dev/null || antwort="y"
  case "$antwort" in n|N|no|nein) msg aborted; exit 0 ;; esac
fi

# ---- parts: each one is its own script --------------------------------------
if [ "$DO_LAUNCHER" = "1" ]; then
  if [ -n "$IPK" ]; then
    "$HERE/install-launcher.sh" --tv "$TV" --ipk "$IPK" --yes
  else
    "$HERE/install-launcher.sh" --tv "$TV" --yes
  fi || exit 1
fi

if [ "$DO_HUB" = "1" ]; then
  "$HERE/install-hub.sh" --tv "$TV" --yes || exit 1
fi

exit 0
