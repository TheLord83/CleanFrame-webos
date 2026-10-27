#!/usr/bin/env bash
# Builds a shareable source package of the webOS port.
#
#   ./tools/build-public.sh             -> dist/cleanframe-webos-<version>/
#                                          dist/cleanframe-webos-<version>.tar.gz
#
# Everything comes from this repository: the app directory, the licence documents and
# the source lists of photographs and icons. Built IPKs, check scratch files and
# private fonts stay out.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="$SRC/app"
VERSION="$(python3 -c "import json;print(json.load(open('$APP/appinfo.json'))['version'])")"
NAME="cleanframe-webos-$VERSION"
OUT="$SRC/dist"
STAGE="$OUT/$NAME"

rm -rf "$STAGE"
mkdir -p "$STAGE"

# The app, without the development leftovers
cp -a "$APP"/. "$STAGE"/
rm -f "$STAGE"/.packageinfo.json "$STAGE"/assets/icons-preview.html
find "$STAGE" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" \( -name '*.pyc' -o -name '.DS_Store' \) -delete 2>/dev/null || true

# Repository documents that belong into a source package
for f in LICENSE THIRD_PARTY_NOTICES.md README.md README.de.md SECURITY.md CHANGELOG.md; do
  [ -e "$SRC/$f" ] && cp "$SRC/$f" "$STAGE/$f"
done

# Licence files of the bundled material have to be there, or the package is not shippable
for f in assets/manrope-OFL.txt assets/icons/SIMPLE-ICONS-LICENSE.txt \
         assets/icons/CUSTOM-BRAND-ICONS-LICENSE.txt; do
  [ -e "$STAGE/$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

# No private fonts, no local scratch files
if find "$STAGE" \( -name '.local' -o -name '*.local.*' \) | grep -q .; then
  echo "REFUSING: a .local file slipped into the package" >&2
  exit 1
fi

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" "$NAME"

echo "Source package: $OUT/$NAME.tar.gz"
echo "Files:      $(find "$STAGE" -type f | wc -l)"
echo "Size:       $(du -sh "$STAGE" | cut -f1) unpacked, $(du -h "$OUT/$NAME.tar.gz" | cut -f1) packed"
echo "SHA256:     $(sha256sum "$OUT/$NAME.tar.gz" | cut -d' ' -f1)"
