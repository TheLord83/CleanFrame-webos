#!/usr/bin/env python3
"""Baut das Startbild des Pakets aus dem Standard-Wallpaper.

webOS zeigt beim Start das Bild aus appinfo.json (bgImage, splashBackground),
bevor die Web-App laeuft. Ein weisser Blitz passt zu nichts; deshalb ist das
Startbild eine stark weichgezeichnete Fassung des Wallpapers, das danach kommt.

Das eigene Wallpaper des Nutzers kann hier nicht stehen (das Paket ist signiert
und das Bild liegt im Paket). Dafuer legt der Launcher beim Start eine eigene
Ebene mit dem gewaehlten Bild darueber, siehe .boot-wall in style.css.

Aufruf:
    python3 tools/make-splash.py                 # nimmt das erste Wallpaper
    python3 tools/make-splash.py --wall misty
    python3 tools/make-splash.py --check         # meldet, ob das Bild zum Wallpaper passt
"""
import argparse
import glob
import hashlib
import json
import os
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    print("FAIL: Pillow fehlt (python3 -m pip install pillow)")
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WALLS = os.path.join(ROOT, "app", "assets", "wallpapers")
OUT = os.path.join(ROOT, "app", "splash.png")
STAMP = os.path.join(ROOT, "app", "assets", "splash-source.json")
W, H = 1920, 1080


def default_wall():
    """Erstes Wallpaper aus dem Katalog: das ist der Auslieferungszustand."""
    catalog = os.path.join(WALLS, "catalog.js")
    if os.path.exists(catalog):
        with open(catalog) as f:
            text = f.read()
        marker = '"id":'
        i = text.find(marker)
        if i > 0:
            rest = text[i + len(marker):].lstrip()
            if rest.startswith('"'):
                return rest[1:rest.index('"', 1)]
    files = sorted(glob.glob(os.path.join(WALLS, "*.jpg")))
    return os.path.basename(files[0]).split("-")[0].rsplit(".", 1)[0] if files else "misty"


def source_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def build(wall):
    src = os.path.join(WALLS, wall + ".jpg")
    if not os.path.exists(src):
        print("FAIL: kein Wallpaper %s" % src)
        return 1
    img = Image.open(src).convert("RGB")
    # Klein rechnen, weichzeichnen, gross zurueckskalieren: ergibt eine ruhige
    # Flaeche ohne erkennbare Kanten, die zum Bild danach passt.
    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
    small = img.resize((120, 68), resample).filter(ImageFilter.GaussianBlur(6))
    out = small.resize((W, H), resample)
    out.save(OUT, "PNG", optimize=True)
    with open(STAMP, "w") as f:
        json.dump({"wall": wall, "source": source_hash(src), "size": [W, H]}, f, indent=1)
        f.write("\n")
    print("geschrieben: %s aus %s.jpg (%d Bytes)" % (os.path.relpath(OUT, ROOT), wall, os.path.getsize(OUT)))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wall")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    wall = args.wall or default_wall()
    if args.check:
        src = os.path.join(WALLS, wall + ".jpg")
        if not os.path.exists(STAMP) or not os.path.exists(OUT):
            print("FAIL: Startbild fehlt (python3 tools/make-splash.py)")
            return 1
        with open(STAMP) as f:
            stamp = json.load(f)
        if stamp.get("source") != source_hash(src):
            print("FAIL: Startbild passt nicht mehr zu %s.jpg (python3 tools/make-splash.py)" % wall)
            return 1
        print("ok Startbild stammt aus %s.jpg" % wall)
        return 0
    return build(wall)


if __name__ == "__main__":
    sys.exit(main())
