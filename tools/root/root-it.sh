#!/usr/bin/env bash
# root-it.sh — root an LG TV with SlopBro, then hand it an SSH key.
#
# NOT part of installing CleanFrame, and not supported. Use it only if you know
# what it does to your TV:
#
#   * it runs an exploit against a specific firmware version. If the firmware is
#     newer than the exploit supports, nothing happens - or worse, the TV ends up
#     in a state you have to recover by hand.
#   * it opens Telnet while it works, then closes it again and installs an SSH key.
#   * it can void your warranty and it may affect DRM playback.
#
# The supported way to a homebrew-capable TV is the Homebrew Channel:
# https://github.com/webosbrew/webos-homebrew-channel - their guide explains
# rooting for each generation, and their community knows the failure modes.
#
# This script exists because it was used to bring up this repository's test TV.
# It is kept here so the path is documented instead of remembered. No support, no
# warranty, and do not run it on a TV that is not yours.
#
#   ./tools/root/root-it.sh --tv 192.168.1.50
#   ./tools/root/root-it.sh --tv 192.168.1.50 --firmware 03.51.16   # scripted
#   ./tools/root/root-it.sh --tv 192.168.1.50 --dry-run              # gate only
#
# Requires: bash, ssh, scp, python3, git (SlopBro is fetched on demand).
#
# SlopBro is checked out at SLOPBRO_COMMIT below. The default is the commit that was verified on
# the 43NANO779PA in this repository's notes; a different one is a decision, not an update.
# See docs/ROOTING.md.
set -uo pipefail

TV="${TV:-}"
FIRMWARE_ARG="${CF_FIRMWARE:-}"
MODEL_ARG=""
SSH_KEY="${CF_SSH_KEY:-}"
FORCE=0
DRY=0
CF_LANG="${CF_LANG:-en}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/.." && pwd)"
export CF_LANG

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,28p' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tv)          TV="${2:-}"; shift 2 ;;
    --model)       MODEL_ARG="${2:-}"; shift 2 ;;
    --firmware)    FIRMWARE_ARG="${2:-}"; shift 2 ;;
    --force)       FORCE=1; shift ;;
    --ssh-key)     SSH_KEY="${2:-}"; shift 2 ;;
    --dry-run)     DRY=1; shift ;;
    --lang)        CF_LANG="${2:-en}"; shift 2 ;;
    -h|--help)     usage ;;
    -*)            echo "unknown option: $1" >&2; exit 2 ;;
    *)             TV="$1"; shift ;;
  esac
done

[ -n "$TV" ] || { echo "usage: $0 --tv <ip> [--firmware <version>]" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || fail "python3 is required for the firmware check"

if [ -z "$SSH_KEY" ]; then
  for candidate in "$HOME/.ssh/lgtv.pub" "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"; do
    [ -f "$candidate" ] && SSH_KEY="$candidate" && break
  done
fi

is_rooted() {
  timeout 3 bash -c "echo >/dev/tcp/$TV/22" 2>/dev/null || return 1
  [ "$(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes "root@$TV" 'id -u' 2>/dev/null | tr -d '\r')" = "0" ]
}

if is_rooted; then
  say "already rooted, SSH works - nothing to do"
  exit 0
fi

# ---- what the TV says about itself, and whether it can be rooted at all ------
TVMODEL=""; TVWEBOS=""; TVFW=""
PROBE="$(python3 "$TOOLS/tvinfo.py" "$TV" --json 2>/dev/null)"
if [ -n "$PROBE" ]; then
  read -r TVMODEL TVWEBOS TVFW <<EOV
$(printf '%s' "$PROBE" | python3 -c 'import json,sys
d = json.load(sys.stdin)
print(d.get("modelName") or d.get("modelNumber") or "-", d.get("webOs") or "-", d.get("firmware") or "-")' 2>/dev/null || echo "- - -")
EOV
fi
[ -n "$MODEL_ARG" ] && { [ "$TVMODEL" = "-" ] || [ -z "$TVMODEL" ]; } && TVMODEL="$MODEL_ARG"

say "==> Can this TV be rooted?"
VERDICT="$(python3 "$HERE/rootaly.py" --model "$TVMODEL" --webos "$TVWEBOS" --firmware "$TVFW" --json 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin).get("verdict","unknown"))' 2>/dev/null || echo unknown)"
say "    verdict:   $VERDICT"

# The firmware decides, and it is the one thing a stock TV will not hand out unpaired.
# So ask for it instead of guessing - or take --firmware in scripts.
if [ -n "$TVFW" ] && [ "$TVFW" != "-" ]; then
  : # read from the TV itself, that beats anything typed in
elif [ -n "$FIRMWARE_ARG" ]; then
  TVFW="$FIRMWARE_ARG"
else
  printf 'Firmware version from the TV (Settings > General > Devices > TV Management > TV Information), empty = skip: '
  fwantwort=""
  { read -r fwantwort </dev/tty; } 2>/dev/null || fwantwort=""
  case "$fwantwort" in
    "") : ;;
    *[0-9]*.[0-9]*) TVFW="$fwantwort" ;;
    *) say "    That does not look like a firmware version (example: 03.51.16) - ignored." ;;
  esac
fi

if [ -n "$TVFW" ] && [ "$TVFW" != "-" ]; then
  ADVICE="$(python3 "$HERE/rootaly.py" --model "$TVMODEL" --webos "$TVWEBOS" --firmware "$TVFW" --json 2>/dev/null)"
  VERDICT="$(printf '%s' "$ADVICE" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("verdict","unknown"))' 2>/dev/null || echo unknown)"
  printf '%s' "$ADVICE" | python3 -c 'import json,sys
d = json.load(sys.stdin)
if d.get("method"): print("    method:    " + d["method"])
print("    reason:    " + d.get("reason", ""))
if d.get("link"): print("    check:     " + d["link"])' 2>/dev/null
  say "    verdict:   $VERDICT"
fi

if [ "$VERDICT" = "no" ] && [ "$FORCE" != "1" ]; then
  fail "ERROR: by the published rules this firmware is patched - not rooting. Use --force to try anyway."
fi

# ---- SlopBro ----------------------------------------------------------------
say "==> Rooting (SlopBro)"
SLOPBRO_COMMIT="${SLOPBRO_COMMIT:-21023d56ca424607bb03d2939609cc658c655fc7}"  # 2026-09-28, the one verified here
if [ "$DRY" = "1" ]; then
  say "    [dry run] python3 slopbro.py $TV"
  say "(dry run: gate checked, nothing changed)"
  exit 0
fi
say "    The TV must be on and on the same network. A pairing prompt appears on the TV - accept it with the remote."
SB="${CF_SLOPBRO:-}"
if [ -z "$SB" ]; then
  for candidate in "$HOME/.cache/cleanframe/slopbro" /root/lgtv-prep/slopbro; do
    [ -f "$candidate/slopbro.py" ] && SB="$candidate" && break
  done
fi
if [ -z "$SB" ]; then
  SB="$HOME/.cache/cleanframe/slopbro"
  mkdir -p "$HOME/.cache/cleanframe"
  say "    fetching SlopBro into $SB"
  # Pinned: an exploit that runs as root on the TV should not change under us.
  # Bumping this line is a deliberate decision, not a side effect of `git pull`.
  git clone -q https://github.com/throwaway96/slopbro.git "$SB" \
    || fail "could not fetch SlopBro (no git or no network)"
  ( cd "$SB" && git -c advice.detachedHead=false checkout -q "$SLOPBRO_COMMIT" ) \
    || fail "SlopBro has no commit $SLOPBRO_COMMIT - the pin in this script needs a look"
fi
( cd "$SB" && python3 slopbro.py "$TV" ) || say "    SlopBro exited with an error - still looking for a root shell"
say "    waiting for the root shell ..."
for _ in $(seq 1 60); do
  { timeout 2 bash -c "echo >/dev/tcp/$TV/23" 2>/dev/null || timeout 2 bash -c "echo >/dev/tcp/$TV/22" 2>/dev/null; } && break
  sleep 3
done
{ timeout 2 bash -c "echo >/dev/tcp/$TV/23" 2>/dev/null || timeout 2 bash -c "echo >/dev/tcp/$TV/22" 2>/dev/null; } \
  || fail "ERROR: no root shell. Check the SlopBro output above (wrong webOS version?)."

say "==> Installing the SSH key, closing Telnet"
if [ -z "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
  fail "no public key found - create one with: ssh-keygen -t ed25519 -N '' -f ~/.ssh/lgtv"
fi
python3 "$HERE/tvsetup.py" --tv "$TV" --key "$SSH_KEY" || fail "SSH key or Telnet step failed"

say ""
say "Rooted. Next: ./tools/install-hub.sh --tv $TV   (and the launcher: ./tools/install-launcher.sh --tv $TV)"
