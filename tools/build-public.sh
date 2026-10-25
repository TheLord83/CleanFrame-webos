#!/usr/bin/env bash
# Baut ein weitergebbares Quellpaket der webOS-Portierung.
#
#   ./release/build-public.sh            -> dist/cleanframe-webos-<version>/
#                                          dist/cleanframe-webos-<version>.tar.gz
#
# Enthalten: App-Quellen (index.html, style.css, main.js, device.js, assets/),
# appinfo.json, LICENSE, THIRD_PARTY_NOTICES.md, README.md und die Quellenlisten
# der Fotos und Icons. Nicht enthalten: gebaute IPKs, Prüfsummen-Zwischendateien.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="$SRC/cleanframe-webos"
REL="$SRC/release"
VERSION="$(python3 -c "import json;print(json.load(open('$APP/appinfo.json'))['version'])")"
NAME="cleanframe-webos-$VERSION"
OUT="$SRC/dist"
STAGE="$OUT/$NAME"

rm -rf "$STAGE"
mkdir -p "$STAGE"

# App-Quellen
cp -a "$APP"/. "$STAGE"/
rm -f "$STAGE"/.packageinfo.json

# Lizenz- und Herkunftsunterlagen
cp "$REL/LICENSE" "$STAGE/LICENSE"
cp "$REL/README.md" "$STAGE/README.md"
cp "$REL/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
cp "$REL/wallpaper-SOURCES.json" "$STAGE/wallpaper-SOURCES.json"
cp "$REL/icon-SOURCES.json" "$STAGE/icon-SOURCES.json" 2>/dev/null || true

# Kurzcheck: Lizenzdateien der Assets müssen mit
for f in assets/manrope-OFL.txt assets/icons/SIMPLE-ICONS-LICENSE.txt \
         assets/icons/CUSTOM-BRAND-ICONS-LICENSE.txt; do
  [ -e "$STAGE/$f" ] || { echo "FEHLT: $f" >&2; exit 1; }
done

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"

echo "Quellpaket: $OUT/$NAME.tar.gz"
echo "Dateien:    $(find "$STAGE" -type f | wc -l)"
echo "Groesse:    $(du -sh "$STAGE" | cut -f1) entpackt, $(du -h "$OUT/$NAME.tar.gz" | cut -f1) gepackt"
echo "SHA256:     $(sha256sum "$OUT/$NAME.tar.gz" | cut -d' ' -f1)"
