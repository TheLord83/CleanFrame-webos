#!/usr/bin/env bash
# All checks in one run — locally and in CI.
#
# Order: first the fast, dependency-free checks (syntax, node 8 compatibility,
# icons), then the API tests, and last the checks that need a browser (keys and
# live adoption).
#
# Whatever the script starts itself is cleaned up again at the end.
#
# Usage:   tools/check-all.sh [--keep]   (--keep leaves server and Chrome running)
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
    echo "  info  server (port $PORT_SERVER) and Chrome (port $PORT_DEBUG) keep running"
    return
  fi
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
  rm -rf "$TMPDIR_RUN"
}
trap cleanup EXIT

step() { printf '\n=== %s\n' "$1"; }

# A check only counts as passed when it ends with 0 AND prints its summary.
# Otherwise a test that silently does nothing would be green — exactly that
# happened on 2026-10-25 (missing call to the main function).
run() {
  local name="$1"; shift
  local out rc line pass total
  out="$("$@" 2>&1)"; rc=$?
  printf '%s\n' "$out"
  # A check only counts as passed with exit code 0 AND a machine-readable
  # "RESULT <passed>/<total>" line where both numbers match. A human summary
  # alone is not enough: a run that printed "0/9 passed" used to count as green,
  # and once a test ended with 0 without running anything at all.
  line="$(printf '%s\n' "$out" | grep -E '^RESULT [0-9]+/[0-9]+$' | tail -1)"
  if [ "$rc" -ne 0 ] || [ -z "$line" ]; then
    echo "  --> $name: FAILED (exit $rc, no RESULT line)"
    FAILED=1
    return
  fi
  pass="${line#RESULT }"; pass="${pass%%/*}"
  total="${line##*/}"
  if [ "$pass" -ne "$total" ]; then
    echo "  --> $name: FAILED ($pass of $total)"
    FAILED=1
    return
  fi
  echo "  --> $name: passed ($pass/$total)"
}

# ---------------------------------------------------------------- Syntax
step "1/14 source syntax"
for f in app/*.js web/*.js web/lib/*.js web/assets/lang/*.js tools/*.js; do
  node --check "$f" || { echo "  syntax error: $f"; FAILED=1; }
done
[ "$FAILED" = "0" ] && echo "  --> all JavaScript files parse"

# ------------------------------------------------- Interface translations
step "2/14 interface translations (de/en)"
run "translation keys" node tools/check-lang.js

# ------------------------------------------------- node 8 (Fernseher)
step "3/14 compatibility with node 8.12 (TV)"
run "node-8 check" python3 tools/check-node8.py

# --------------------------------------------------------------- Icons
step "4/14 icon library"
run "icon check" python3 tools/check-icons.py

# ------------------------------------------------------------ API-Tests
step "5/14 config server (API)"
run "API checks" python3 tools/test-web-api.py

# --------------------------------------- Server + Chrome fuer die UI-Tests
step "6/14 interface (keys and live adoption)"
if ! curl -sf -m 3 "http://127.0.0.1:$PORT_SERVER/api/health" >/dev/null 2>&1; then
  echo "  starting config server on port $PORT_SERVER"
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
    echo "  --> interface checks: skipped (no Chrome found)"
    FAILED=1
  else
    echo "  starting Chrome on port $PORT_DEBUG ($CHROME)"
    "$CHROME" --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files \
      --remote-debugging-port="$PORT_DEBUG" about:blank >"$TMPDIR_RUN/chrome.log" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 60); do
      curl -sf -m 2 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1 && break
      sleep 0.25
    done
  fi
elif [ -z "${CHROME:-}" ]; then
  # Chrome already running: determine the path for the message
  CHROME="$(command -v google-chrome || echo 'running Chrome')"
fi

if curl -sf -m 3 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1; then
  run "key tests" node tools/test-ui-keys.js --port "$PORT_DEBUG" --config "http://127.0.0.1:$PORT_SERVER/api/config"
  run "live adoption" node tools/test-live-apply.js --port "$PORT_DEBUG" --server "http://127.0.0.1:$PORT_SERVER"
  # The page can check itself; that only counts when something calls it.
  # Locally it does, in CI the extra tab does not reach the server yet (the tab
  # ends up on its error page, title "127.0.0.1"), so the stage stays out of CI
  # until that is understood - and says so instead of silently passing.
  if [ -n "${CI:-}" ]; then
    echo "  skip  interface self-test: not run in CI (see docs/WEB.md, open point)"
  else
    run "interface self-test" python3 tools/check-selftest.py --chrome "${CHROME:-}" \
      --url "http://127.0.0.1:$PORT_SERVER/?selftest=ui"
  fi
fi

# --------------------------------------- Home Assistant status strip
step "7/14 status strip (chosen entities on the home screen)"
if curl -sf -m 3 "http://127.0.0.1:$PORT_DEBUG/json/list" >/dev/null 2>&1; then
  run "status strip" node tools/test-ha-strip.js --port "$PORT_DEBUG"
fi

# --------------------------------------------- post-exploit setup (fake TV)
step "8/14 rooted-TV setup (fake Telnet shell)"
run "tv setup" python3 tools/test_tvsetup.py

step "9/14 television search (what counts as a TV)"
run "discovery" python3 tools/test_discover.py

step "10/14 rooting: what the TV says without root"
run "tv info" python3 tools/test_tvinfo.py

step "11/14 rooting: does an exploit still match?"
run "root advice" python3 tools/test_rootaly.py

step "12/14 rooting: patched firmware is refused"
run "root gate" python3 tools/test-install-gate.py

step "13/14 bundled hub (app starts it, package carries it)"
run "hub boot decisions" node tools/test-hubboot.js
run "hub inside the package" python3 tools/check-ipk-hub.py

step "14/14 links in the documentation"
run "documentation links" python3 tools/check-links.py

# ------------------------------------------------------------- Ergebnis
printf '\n'
if [ "$FAILED" = "0" ]; then
  echo "All checks passed."
else
  echo "At least one check failed."
fi
exit "$FAILED"
