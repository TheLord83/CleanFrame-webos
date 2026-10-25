#!/usr/bin/env python3
"""Prueft den Icon-Katalog und laedt jedes SVG im Browser.

Ohne Fernseher und ohne Screenshot: die Datei wird auf Existenz, XML-Gueltigkeit
und sichtbare Form geprueft, danach rendert headless Chrome alle Icons und meldet
im Seitentitel, ob jedes geladen wurde.

Aufruf: python3 tools/check-icons.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Zwei Layouts: App-Ordner direkt (Arbeitsstand) oder Repo mit app/ davor.
ASSETS = os.path.join(ROOT, "app", "assets")
if not os.path.isdir(ASSETS):
    ASSETS = os.path.join(ROOT, "assets")
ICONS = os.path.join(ASSETS, "icons")
CATALOG = os.path.join(ASSETS, "icons.json")
SHAPES = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}


def local_name(tag):
    return tag.split("}")[-1]


def check_files(catalog):
    errors = []
    seen = set()
    for group in catalog["groups"]:
        for icon in group["icons"]:
            key = icon["key"]
            if key in seen:
                errors.append(f"{key}: doppelt im Katalog")
            seen.add(key)
            f = os.path.join(ICONS, icon["file"])
            if not os.path.exists(f):
                errors.append(f"{key}: Datei fehlt ({icon['file']})")
                continue
            try:
                root = ET.parse(f).getroot()
            except ET.ParseError as e:
                errors.append(f"{key}: kein gueltiges XML ({e})")
                continue
            if local_name(root.tag) != "svg":
                errors.append(f"{key}: Wurzel ist nicht <svg>")
            if not any(local_name(el.tag) in SHAPES for el in root.iter()):
                errors.append(f"{key}: enthaelt keine Form")
            if not root.get("viewBox"):
                errors.append(f"{key}: kein viewBox")
    return errors, seen


def chrome_binary():
    explicit = os.environ.get("CHROME_BIN")
    if explicit and os.path.exists(explicit):
        return explicit
    for candidate in sorted(
        (os.path.join(os.path.expanduser("~/.cache/ms-playwright"), d, "chrome-linux64", "chrome")
         for d in os.listdir(os.path.expanduser("~/.cache/ms-playwright"))
         if d.startswith("chromium-")),
        reverse=True,
    ):
        if os.path.exists(candidate):
            return candidate
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    return None


def browser_check(keys):
    chrome = chrome_binary()
    if not chrome:
        return None, "kein Chrome/Chromium gefunden (CHROME_BIN setzen)"
    tmp = tempfile.mkdtemp(prefix="cf-icons-")
    page = os.path.join(tmp, "sheet.html")
    cells = "".join(
        f'<figure><img src="file://{os.path.join(ICONS, k + ".svg")}" alt="{k}"><figcaption>{k}</figcaption></figure>'
        for k in sorted(keys)
    )
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>laeuft</title>
<style>body{{background:#14161a;color:#e9edf2;font:13px system-ui;margin:0;padding:16px;
display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px}}
figure{{margin:0;background:#1c1f25;border:1px solid #2a2f38;border-radius:8px;padding:10px;text-align:center}}
img{{width:48px;height:48px;filter:invert(0)}}figcaption{{margin-top:6px;font-size:11px;color:#99a3b2}}</style></head>
<body>{cells}
<script>
  var imgs = Array.prototype.slice.call(document.images);
  function done() {{
    var bad = imgs.filter(function (i) {{ return !i.complete || i.naturalWidth === 0; }}).map(function (i) {{ return i.alt; }});
    document.title = bad.length ? ('FAIL ' + bad.join(',')) : ('OK ' + imgs.length);
  }}
  var left = imgs.length;
  imgs.forEach(function (i) {{ i.onload = i.onerror = function () {{ if (--left === 0) done(); }}; }});
  if (!imgs.length) done();
  setTimeout(done, 4000);
</script></body></html>"""
    with open(page, "w", encoding="utf-8") as f:
        f.write(html)
    out = subprocess.run(
        [chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
         "--allow-file-access-from-files", "--virtual-time-budget=5000", "--dump-dom",
         "file://" + page],
        capture_output=True, text=True, timeout=90,
    ).stdout
    m = re.search(r"<title>([^<]*)</title>", out)
    title = m.group(1) if m else "(kein Titel)"
    keep = os.path.join(ASSETS, "icons-preview.html")
    shutil.copy(page, keep)
    return title, keep


def main():
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    errors, keys = check_files(catalog)
    print(f"Katalog: {len(catalog['groups'])} Gruppen, {len(keys)} Icons")
    if errors:
        print("Fehler in den Dateien:")
        for e in errors:
            print("  -", e)
        return 1
    print("Dateien: alle vorhanden, gueltiges SVG, mindestens eine Form, viewBox gesetzt")

    title, detail = browser_check(keys)
    if title is None:
        print("Browser-Pruefung uebersprungen:", detail)
        print(f"{len(keys)}/{len(keys)} Icons in Ordnung (Browser uebersprungen)")
        return 0
    print("Browser:", title)
    if title.startswith("OK"):
        print(f"Vorschau: {detail}")
        print(f"{len(keys)}/{len(keys)} Icons in Ordnung")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
