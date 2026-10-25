#!/usr/bin/env bash
# Generates docs/PORT-CHANGES.patch: the difference between the original and
# this port. That makes it possible to follow a new upstream release without
# hunting for the changes by hand.
#
# Usage:   tools/make-port-patch.sh [path-to-upstream-clone]
# Without an argument the original is cloned to /tmp/cf-upstream.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${1:-}"

if [ -z "$UP" ]; then
  UP=/tmp/cf-upstream
  rm -rf "$UP"
  git clone -q --depth 1 https://github.com/nthnclrk/CleanFrame.git "$UP"
fi

cd "$ROOT"
: > docs/PORT-CHANGES.patch

# Code only; the images under app/assets/ are byte-identical and stay out.
for f in main.js device.js style.css index.html i18n.js appinfo.json; do
  src=""
  for kandidat in "$UP/app/$f" "$UP/src/$f" "$UP/$f"; do
    [ -f "$kandidat" ] && src="$kandidat" && break
  done
  [ -n "$src" ] || continue
  if [ -f "app/$f" ]; then
    diff -u --label "upstream/app/$f" --label "port/app/$f" "$src" "app/$f" >> docs/PORT-CHANGES.patch || true
  else
    printf 'Only in the port: app/%s\n' "$f" >> docs/PORT-CHANGES.patch
  fi
done

echo "docs/PORT-CHANGES.patch: $(wc -l < docs/PORT-CHANGES.patch) lines, $(grep -c '^+++' docs/PORT-CHANGES.patch || true) files"
