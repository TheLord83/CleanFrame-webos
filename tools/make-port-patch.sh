#!/usr/bin/env bash
# Erzeugt docs/PORT-CHANGES.patch: der Unterschied zwischen dem Original und
# dieser Portierung. Damit laesst sich ein neues Upstream-Release nachziehen,
# ohne die Aenderungen von Hand zu suchen.
#
# Aufruf:  tools/make-port-patch.sh [pfad-zum-upstream-klon]
# Ohne Argument wird das Original nach /tmp/cf-upstream geklont.
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

# Nur der Code; die Bilder unter app/assets/ sind byte-identisch und bleiben weg.
for f in main.js device.js style.css index.html i18n.js appinfo.json; do
  src=""
  for kandidat in "$UP/app/$f" "$UP/src/$f" "$UP/$f"; do
    [ -f "$kandidat" ] && src="$kandidat" && break
  done
  [ -n "$src" ] || continue
  if [ -f "app/$f" ]; then
    diff -u --label "upstream/app/$f" --label "port/app/$f" "$src" "app/$f" >> docs/PORT-CHANGES.patch || true
  else
    printf 'Nur in der Portierung: app/%s\n' "$f" >> docs/PORT-CHANGES.patch
  fi
done

echo "docs/PORT-CHANGES.patch: $(wc -l < docs/PORT-CHANGES.patch) Zeilen, $(grep -c '^+++' docs/PORT-CHANGES.patch || true) Dateien"
