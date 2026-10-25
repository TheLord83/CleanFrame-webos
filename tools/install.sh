#!/usr/bin/env bash
# install.sh — put CleanFrame (launcher) and CleanFrame Hub (configuration server)
# on a rooted LG TV running webOS 6 or newer.
#
#   ./tools/install.sh 192.168.1.50              # launcher + hub, asks once
#   ./tools/install.sh 192.168.1.50 --dry-run    # detect and check only, changes nothing
#   ./tools/install.sh 192.168.1.50 --lang de    # German prompts
#   ./tools/install.sh --tv 192.168.1.50 --ipk dist/cleanframe_all.ipk --yes
#
# Flow: detect -> check -> plan -> confirm -> install -> verify -> report.
# What it cannot do is written down in docs/INSTALL.md: the rooting itself needs a
# person with the remote control. Everything after that is handled here.
#
# Requires: bash, ssh, scp, python3. No other software, no npm, no luna-send
# (luna-send does not work from the webOS shell on 6.5).
set -uo pipefail

TV="${TV:-}"
IPK="${IPK:-}"
LANG_CODE="${CF_LANG:-en}"
DO_LAUNCHER=1
DO_HUB=1
DO_ROOT=0
DO_INFO=0
SSH_KEY="${CF_SSH_KEY:-}"
DRY=0
YES=0
WAKE=0
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APPID_DEFAULT="com.blackpearl.cleanframe"

usage() { sed -n '2,16p' "$0"; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tv)          TV="${2:-}"; shift 2 ;;
    --ipk)         IPK="${2:-}"; shift 2 ;;
    --lang)        LANG_CODE="${2:-en}"; shift 2 ;;
    --root)        DO_ROOT=1; shift ;;
    --info)        DO_INFO=1; shift ;;
    --ssh-key)     SSH_KEY="${2:-}"; shift 2 ;;
    --no-launcher) DO_LAUNCHER=0; shift ;;
    --no-hub)      DO_HUB=0; shift ;;
    --wake)        WAKE=1; shift ;;
    --yes|-y)      YES=1; shift ;;
    --dry-run)     DRY=1; shift ;;
    -h|--help)     usage ;;
    -*)            echo "unknown option: $1" >&2; exit 2 ;;
    *)             TV="$1"; shift ;;
  esac
done

# ---- texts -------------------------------------------------------------------
# Two languages, English default. Add a language by extending t() below.
t() {
  local key="$1"
  if [ "$LANG_CODE" = "de" ]; then
    case "$key" in
      need_tv)       echo "Aufruf: $0 [<tv-ip>] [--root] [--info] [--lang de] [--dry-run]" ;;
      find)          echo "==> Fernseher im Netz suchen" ;;
      find_one)      echo "    gefunden: %s" ;;
      find_many)     echo "    mehrere Kandidaten gefunden - bitte mit <ip> oder --tv auswaehlen:" ;;
      find_none)     echo "FEHLER: kein LG-Fernseher gefunden. Wach? Gleiches Netz? Siehe docs/TROUBLESHOOTING.md" ;;
      info)          echo "==> Zustand des Fernsehers" ;;
      info_root)     echo "    root: %s" ;;
      root_stage)    echo "==> Rooten (SlopBro)" ;;
      root_skip)     echo "    schon gerootet, SSH funktioniert" ;;
      root_need_tv)  echo "    Der Fernseher muss an sein und im selben Netz. Developer Mode ist NICHT noetig." ;;
      root_pair)     echo "    Gleich erscheint am Fernseher ein Kopplungsdialog - mit der Fernbedienung bestaetigen." ;;
      root_pair_hint) echo "    Erscheint er nicht: Einstellungen > Verbindung > LG Connect Apps / Mobile Verbindungsverwaltung einschalten." ;;
      root_wait)     echo "    warte auf die Root-Shell (Telnet 23) ..." ;;
      root_timeout)  echo "FEHLER: keine Root-Shell bekommen. SlopBro-Log oben pruefen (falsche webOS-Version?)." ;;
      root_setup)    echo "==> SSH-Schluessel setzen, Telnet schliessen, Updates sperren" ;;
      key_missing)   echo "FEHLER: oeffentlicher Schluessel fehlt: %s (mit --ssh-key angeben)" ;;
      detect)        echo "==> Fernseher suchen" ;;
      tv_off)        echo "    Port 22 zu. Fernseher im Standby? Mit --wake wecken." ;;
      tv_on)         echo "    Fernseher antwortet (SSH offen)" ;;
      check)         echo "==> Voraussetzungen pruefen" ;;
      no_ssh)        echo "FEHLER: SSH auf root@%s nicht moeglich. Ist der Fernseher gerootet und der Schluessel hinterlegt? Siehe docs/INSTALL.md" ;;
      no_node)       echo "FEHLER: node fehlt auf dem Fernseher oder ist zu alt (gefunden: %s, gebraucht: 8+)" ;;
      no_glass)      echo "FEHLER: Glasshouse antwortet nicht auf Port 8080 - ohne Glasshouse laesst sich kein IPK installieren." ;;
      glass_ok)      echo "    Glasshouse antwortet (%s)" ;;
      node_ok)       echo "    node %s" ;;
      plan)          echo "==> Vorhaben" ;;
      plan_launcher) echo "    Launcher als IPK installieren: %s" ;;
      plan_hub)      echo "    Hub einrichten: /var/lib/cleanframe, Autostart, Port 8484" ;;
      ask)           echo "Ausfuehren? [J/n]" ;;
      aborted)       echo "Abgebrochen, nichts veraendert." ;;
      launcher)      echo "==> Launcher installieren" ;;
      hub)           echo "==> Hub einrichten" ;;
      verify)        echo "==> Nachpruefen" ;;
      ok_health)     echo "    Hub antwortet: %s" ;;
      ok_app)        echo "    Launcher haengt im Katalog: %s %s" ;;
      fail_app)      echo "FEHLER: Installation gemeldet, aber %s fehlt im Katalog" ;;
      fail_health)   echo "FEHLER: Hub antwortet nicht auf Port 8484" ;;
      report)        echo "==> Ergebnis" ;;
      next)          echo "    Oberflaeche: http://%s:8484/   Start: curl -sS -X POST http://%s:8080/api/control -H 'Content-Type: application/json' -d '{\"action\":\"launchApp\",\"value\":\"%s\"}'" ;;
      dry)           echo "(Probelauf: nichts wurde veraendert)" ;;
      *)             echo "$key" ;;
    esac
  else
    case "$key" in
      need_tv)       echo "usage: $0 [<tv-ip>] [--root] [--info] [--lang de] [--dry-run]" ;;
      find)          echo "==> Looking for a TV on the network" ;;
      find_one)      echo "    found: %s" ;;
      find_many)     echo "    several candidates - pick one with <ip> or --tv:" ;;
      find_none)     echo "ERROR: no LG TV found. Awake? Same network? See docs/TROUBLESHOOTING.md" ;;
      info)          echo "==> State of the TV" ;;
      info_root)     echo "    root: %s" ;;
      root_stage)    echo "==> Rooting (SlopBro)" ;;
      root_skip)     echo "    already rooted, SSH works" ;;
      root_need_tv)  echo "    The TV must be on and on the same network. Developer Mode is NOT needed." ;;
      root_pair)     echo "    A pairing prompt will appear on the TV - accept it with the remote." ;;
      root_pair_hint) echo "    If it does not: Settings > Connection > LG Connect Apps / Mobile Connection Management on." ;;
      root_wait)     echo "    waiting for the root shell (Telnet 23) ..." ;;
      root_timeout)  echo "ERROR: no root shell. Check the SlopBro output above (wrong webOS version?)." ;;
      root_setup)    echo "==> Installing the SSH key, closing Telnet, blocking updates" ;;
      key_missing)   echo "ERROR: public key not found: %s (pass --ssh-key)" ;;
      detect)        echo "==> Looking for the TV" ;;
      tv_off)        echo "    port 22 closed. TV in standby? Use --wake." ;;
      tv_on)         echo "    TV answers (SSH open)" ;;
      check)         echo "==> Checking prerequisites" ;;
      no_ssh)        echo "ERROR: cannot ssh root@%s. Is the TV rooted and the key installed? See docs/INSTALL.md" ;;
      no_node)       echo "ERROR: node missing on the TV or too old (found: %s, need: 8+)" ;;
      no_glass)      echo "ERROR: Glasshouse does not answer on port 8080 - without it no IPK can be installed." ;;
      glass_ok)      echo "    Glasshouse answers (%s)" ;;
      node_ok)       echo "    node %s" ;;
      plan)          echo "==> Plan" ;;
      plan_launcher) echo "    install the launcher IPK: %s" ;;
      plan_hub)      echo "    set up the hub: /var/lib/cleanframe, autostart, port 8484" ;;
      ask)           echo "Proceed? [Y/n]" ;;
      aborted)       echo "Aborted, nothing changed." ;;
      launcher)      echo "==> Installing the launcher" ;;
      hub)           echo "==> Setting up the hub" ;;
      verify)        echo "==> Verifying" ;;
      ok_health)     echo "    hub answers: %s" ;;
      ok_app)        echo "    launcher is in the app list: %s %s" ;;
      fail_app)      echo "ERROR: install reported, but %s is missing from the app list" ;;
      fail_health)   echo "ERROR: hub does not answer on port 8484" ;;
      report)        echo "==> Result" ;;
      next)          echo "    interface: http://%s:8484/   start: curl -sS -X POST http://%s:8080/api/control -H 'Content-Type: application/json' -d '{\"action\":\"launchApp\",\"value\":\"%s\"}'" ;;
      dry)           echo "(dry run: nothing was changed)" ;;
      *)             echo "$key" ;;
    esac
  fi
}

# Pick an existing public key instead of demanding a path.
if [ -z "$SSH_KEY" ]; then
  for candidate in "$HOME/.ssh/lgtv.pub" "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub" "$HOME/.ssh/id_ecdsa.pub"; do
    [ -f "$candidate" ] && SSH_KEY="$candidate" && break
  done
fi

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

# ---- 0. find the TV when no address was given -------------------------------
if [ -z "$TV" ]; then
  say "$(t find)"
  DISC="$(python3 "$HERE/discover.py" --json 2>/dev/null)"
  COUNT="$(printf '%s' "$DISC" | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin).get("hosts", [])))
except Exception: print(0)' 2>/dev/null)"
  case "${COUNT:-0}" in
    0) fail "$(t find_none)" ;;
    1) TV="$(printf '%s' "$DISC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["hosts"][0]["ip"])')"
       say "$(printf "$(t find_one)" "$TV")" ;;
    *) say "$(t find_many)"
       printf '%s' "$DISC" | python3 -c 'import json,sys
for host in json.load(sys.stdin)["hosts"]:
    print("      %-15s %-24s %s" % (host["ip"], host.get("name") or host.get("model") or "",
                                    ", ".join(host.get("ports", {}).keys())))'
       exit 2 ;;
  esac
fi

SSH=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes "root@$TV")
tcp() { timeout 3 bash -c "echo >/dev/tcp/$TV/$1" 2>/dev/null; }

# ---- state of the TV --------------------------------------------------------
if [ "$DO_INFO" = "1" ]; then
  say "$(t info)"
  if tcp 22; then
    "${SSH[@]}" 'echo "model:   $(grep -o "\"modelName\"[^,]*" /var/run/nyx/os_info.json 2>/dev/null | head -1)"
echo "webos:   $(grep -o "\"webos_name\"[^,]*" /var/run/nyx/os_info.json 2>/dev/null | head -1)"
echo "node:    $(/usr/bin/node -v 2>/dev/null)"
echo "rooted:  yes"; true' 2>/dev/null || true
    say "$(printf "$(t info_root)" "yes")"
  else
    say "$(printf "$(t info_root)" "no")"
  fi
fi

# ---- root the TV (SlopBro does the work, one press on the remote) -----------
if [ "$DO_ROOT" = "1" ]; then
  say "$(t root_stage)"
  if tcp 22; then
    say "$(t root_skip)"
  else
    say "$(t root_need_tv)"
    say "$(t root_pair)"
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
      git clone -q --depth 1 https://github.com/throwaway96/slopbro.git "$SB" \
        || fail "could not fetch SlopBro (no git or no network)"
    fi
    if [ "$DRY" = "1" ]; then
      say "    [dry run] python3 $SB/slopbro.py $TV"
    else
      ( cd "$SB" && python3 slopbro.py "$TV" ) || say "    SlopBro exited with an error - still looking for a root shell"
      say "$(t root_wait)"
      for _ in $(seq 1 60); do tcp 23 && break; tcp 22 && break; sleep 3; done
      tcp 23 || tcp 22 || fail "$(t root_timeout)"
    fi
    say "$(t root_setup)"
    if [ -z "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
      if [ "$DRY" = "1" ]; then
        say "    [dry run] no public key found - create one with: ssh-keygen -t ed25519 -N '' -f ~/.ssh/lgtv"
        exit 0
      fi
      fail "$(printf "$(t key_missing)" "${SSH_KEY:-~/.ssh/lgtv.pub}")"
    fi
    if [ "$DRY" = "1" ]; then
      python3 "$HERE/tvsetup.py" --tv "$TV" --key "$SSH_KEY" --dry-run
    else
      python3 "$HERE/tvsetup.py" --tv "$TV" --key "$SSH_KEY" || fail "SSH key or Telnet step failed"
    fi
  fi
fi

if [ -z "$IPK" ]; then
  for kandidat in "$ROOT/dist/cleanframe_all.ipk" "$ROOT/ipk/cleanframe_all.ipk"; do
    [ -f "$kandidat" ] && IPK="$kandidat" && break
  done
  if [ -z "$IPK" ] && command -v python3 >/dev/null && [ -d "$ROOT/app" ]; then
    IPK="$ROOT/dist/cleanframe_all.ipk"
    if [ "$DRY" -eq 0 ]; then
      say "==> Building the IPK (dist/cleanframe_all.ipk)"
      mkdir -p "$ROOT/dist"
      python3 "$ROOT/tools/build-ipk.py" "$ROOT/app" "$IPK" || fail "IPK build failed"
    fi
  fi
fi
[ "$DO_LAUNCHER" -eq 1 ] && [ -z "$IPK" ] && fail "no IPK: pass --ipk <file> or build one with tools/build-ipk.py"

# ---- 1. detect ---------------------------------------------------------------
say "$(t detect)"
if ! tcp 22; then
  say "$(t tv_off)"
  if [ "$WAKE" -eq 1 ] && [ "$DRY" -eq 0 ]; then
    command -v python3 >/dev/null && python3 "$HERE/wake-tv.py" "$TV" 2>/dev/null \
      || fail "wake-tv.py not available; wake the TV by hand"
    for i in $(seq 1 20); do tcp 22 && break; sleep 2; done
  fi
  if ! tcp 22; then
    if [ "$DRY" = "1" ]; then say "$(t dry)"; exit 0; fi
    fail "$(printf "$(t no_ssh)" "$TV")"
  fi
fi
say "$(t tv_on)"

# ---- 2. check ----------------------------------------------------------------
say "$(t check)"
NODEVER="$("${SSH[@]}" '/usr/bin/node -v' 2>/dev/null | tr -d '\r' | tr -d 'v')" \
  || fail "$(printf "$(t no_ssh)" "$TV")"
case "$NODEVER" in ''|*[!0-9.]*) fail "$(printf "$(t no_node)" "${NODEVER:-?}")" ;; esac
[ "${NODEVER%%.*}" -ge 8 ] 2>/dev/null || fail "$(printf "$(t no_node)" "$NODEVER")"
say "$(printf "$(t node_ok)" "$NODEVER")"

GLASS="$(curl -sS -m 6 "http://$TV:8080/api/apps" 2>/dev/null | head -c 200)"
[ -n "$GLASS" ] || fail "$(t no_glass)"
say "$(printf "$(t glass_ok)" "$TV:8080")"

# ---- 3. plan -----------------------------------------------------------------
say "$(t plan)"
[ "$DO_LAUNCHER" -eq 1 ] && say "$(printf "$(t plan_launcher)" "$IPK")"
[ "$DO_HUB" -eq 1 ] && say "$(t plan_hub)"

if [ "$DRY" -eq 1 ]; then
  say ""
  say "$(t dry)"
  exit 0
fi

# ---- 4. confirm --------------------------------------------------------------
if [ "$YES" -eq 0 ]; then
  printf '%s ' "$(t ask)"
  read -r antwort </dev/tty || antwort="y"
  case "$antwort" in n|N|no|nein) say "$(t aborted)"; exit 0 ;; esac
fi

# ---- 5. install --------------------------------------------------------------
if [ "$DO_LAUNCHER" -eq 1 ]; then
  say "$(t launcher)"
  python3 "$HERE/install-ipk.py" --tv "$TV" --ipk "$IPK" || fail "launcher install failed"
fi

if [ "$DO_HUB" -eq 1 ]; then
  say "$(t hub)"
  "$HERE/install-web.sh" "$TV" >/dev/null || fail "hub install failed"
fi

# ---- 6. verify ---------------------------------------------------------------
say "$(t verify)"
HEALTH=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  HEALTH="$(curl -sS -m 5 "http://$TV:8484/api/health" 2>/dev/null)"
  [ -n "$HEALTH" ] && break
  sleep 1
done
[ -n "$HEALTH" ] || fail "$(t fail_health)"
say "$(printf "$(t ok_health)" "$(printf '%s' "$HEALTH" | head -c 120)")"

if [ "$DO_LAUNCHER" -eq 1 ]; then
  APP="$(curl -sS -m 10 "http://$TV:8080/api/apps" 2>/dev/null | python3 -c '
import json, sys
try:
    apps = json.load(sys.stdin).get("installed", [])
except Exception:
    sys.exit(1)
for a in apps:
    if a.get("id") == "com.blackpearl.cleanframe":
        print(a.get("version", "?"))
        break
' 2>/dev/null)"
  [ -n "$APP" ] || fail "$(printf "$(t fail_app)" "$APPID_DEFAULT")"
  say "$(printf "$(t ok_app)" "$APPID_DEFAULT" "$APP")"
fi

# ---- 7. start it once and report --------------------------------------------
if [ "$DO_LAUNCHER" -eq 1 ]; then
  # Installing replaces the app folder, so a running instance is gone afterwards.
  # Start it here and wait until the hub can take a picture of it - that is the
  # difference between "installed" and "actually on screen".
  curl -sS -m 10 -X POST "http://$TV:8080/api/control" \
    -H 'Content-Type: application/json' \
    -d "{\"action\":\"launchApp\",\"value\":\"$APPID_DEFAULT\"}" >/dev/null 2>&1
  SHOT=""
  for i in $(seq 1 20); do
    SHOT="$(curl -sS -m 6 -o /dev/null -w '%{http_code}' "http://$TV:8484/api/tv/snapshot" 2>/dev/null)"
    [ "$SHOT" = "200" ] && break
    sleep 1
  done
  if [ "$SHOT" = "200" ]; then say "    launcher is on screen (live picture available)"; else say "    note: launcher started, but no live picture yet - open it on the TV"; fi
fi

# ---- 8. report ---------------------------------------------------------------
say ""
say "$(t report)"
say "$(printf "$(t next)" "$TV" "$TV" "$APPID_DEFAULT")"
