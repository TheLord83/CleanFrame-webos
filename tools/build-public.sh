#!/usr/bin/env bash
# Builds a shareable source package of the webOS port.
#
#   ./tools/build-public.sh              -> dist/cleanframe-webos-<version>/
#                                          dist/cleanframe-webos-<version>.tar.gz
#
# Included: app sources (index.html, style.css, main.js, device.js, assets/),
# appinfo.json, LICENSE, THIRD_PARTY_NOTICES.md, README.md and the source lists
# of the photos and icons. Not included: built IPKs, checksum scratch files.
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

# App sources
cp -a "$APP"/. "$STAGE"/
rm -f "$STAGE"/.packageinfo.json

# License and provenance documents
cp "$REL/LICENSE" "$STAGE/LICENSE"
cp "$REL/README.md" "$STAGE/README.md"
cp "$REL/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
cp "$REL/wallpaper-SOURCES.json" "$STAGE/wallpaper-SOURCES.json"
cp "$REL/icon-SOURCES.json" "$STAGE/icon-SOURCES.json" 2>/dev/null || true

# Quick check: the license files of the assets must be included
for f in assets/manrope-OFL.txt assets/icons/SIMPLE-ICONS-LICENSE.txt \
         assets/icons/CUSTOM-BRAND-ICONS-LICENSE.txt; do
  [ -e "$STAGE/$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"

echo "Source package: $OUT/$NAME.tar.gz"
echo "Files:      $(find "$STAGE" -type f | wc -l)"
echo "Size:       $(du -sh "$STAGE" | cut -f1) unpacked, $(du -h "$OUT/$NAME.tar.gz" | cut -f1) packed"
echo "SHA256:     $(sha256sum "$OUT/$NAME.tar.gz" | cut -d' ' -f1)"
