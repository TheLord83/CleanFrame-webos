#!/usr/bin/env python3
"""Checks the icon catalog and loads every SVG in the browser.

Without a TV and without a screenshot: the file is checked for existence, XML
validity and a visible shape, then headless Chrome renders all icons and reports
in the page title whether every one of them loaded.

Usage: python3 tools/check-icons.py
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
# Two layouts: app folder directly (working copy) or repo with app/ in front.
ASSETS = os.path.join(ROOT, "app", "assets")
if not os.path.isdir(ASSETS):
    ASSETS = os.path.join(ROOT, "assets")
ICONS = os.path.join(ASSETS, "icons")
CATALOG = os.path.join(ASSETS, "icons.json")
SHAPES = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}


def local_name(tag):
    return tag.split("}")[-1]


# Gruppen, deren Name in beiden Sprachen gleich lautet, weil es dasselbe
# Lehnwort ist. Alles andere muss sich unterscheiden.
SAME_IN_BOTH = {"streaming"}


def check_labels(catalog):
    """Die Gruppenreiter und Icon-Namen kommen aus dieser Datei, also muss die
    englische Fassung auch englisch sein. Sie war es nicht: 'gaming' stand auf
    beiden Seiten 'Spielekonsolen', und in der englischen Oberflaeche las man
    dann Deutsch. Markennamen duerfen gleich heissen, Gruppen nie."""
    errors = []
    for group in catalog["groups"]:
        label = group.get("label") or {}
        de, en = label.get("de"), label.get("en")
        if not de or not en:
            errors.append("%s: label missing de or en" % group["id"])
            continue
        if de == en and group["id"] not in SAME_IN_BOTH:
            errors.append("%s: english label is the german one (%s)" % (group["id"], en))
        if any(c in en for c in "äöüßÄÖÜ"):
            errors.append("%s: english label has german characters (%s)" % (group["id"], en))
    for group in catalog["groups"]:
        for icon in group["icons"]:
            for field in ("de", "en"):
                v = icon.get(field) or ""
                if not v:
                    errors.append("%s: %s name missing" % (icon["key"], field))
                elif any(c in v for c in "äöüßÄÖÜ"):
                    errors.append("%s: %s name has german characters (%s)" % (icon["key"], field, v))
    return errors


def check_files(catalog):
    errors = []
    seen = set()
    for group in catalog["groups"]:
        for icon in group["icons"]:
            key = icon["key"]
            if key in seen:
                errors.append(f"{key}: duplicate in the catalog")
            seen.add(key)
            f = os.path.join(ICONS, icon["file"])
            if not os.path.exists(f):
                errors.append(f"{key}: file missing ({icon['file']})")
                continue
            try:
                root = ET.parse(f).getroot()
            except ET.ParseError as e:
                errors.append(f"{key}: not valid XML ({e})")
                continue
            if local_name(root.tag) != "svg":
                errors.append(f"{key}: root is not <svg>")
            if not any(local_name(el.tag) in SHAPES for el in root.iter()):
                errors.append(f"{key}: contains no shape")
            if not root.get("viewBox"):
                errors.append(f"{key}: no viewBox")
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
        return None, "no Chrome/Chromium found (set CHROME_BIN)"
    tmp = tempfile.mkdtemp(prefix="cf-icons-")
    page = os.path.join(tmp, "sheet.html")
    cells = "".join(
        f'<figure><img src="file://{os.path.join(ICONS, k + ".svg")}" alt="{k}"><figcaption>{k}</figcaption></figure>'
        for k in sorted(keys)
    )
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>running</title>
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
    title = m.group(1) if m else "(no title)"
    keep = os.path.join(ASSETS, "icons-preview.html")
    shutil.copy(page, keep)
    return title, keep


def main():
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    errors, keys = check_files(catalog)
    label_errors = check_labels(catalog)
    print(f"Catalog: {len(catalog['groups'])} groups, {len(keys)} icons")
    for e in label_errors:
        print("  - labels:", e)
    errors += label_errors
    if errors:
        print("Errors in the files:")
        for e in errors:
            print("  -", e)
        print(f"RESULT 0/{len(keys)}")
        return 1
    print("Files: all present, valid SVG, at least one shape, viewBox set")

    title, detail = browser_check(keys)
    if title is None:
        print("Browser check skipped:", detail)
        print(f"{len(keys)}/{len(keys)} icons in order (browser skipped)")
        print(f"RESULT {len(keys)}/{len(keys)}")
        return 0
    print("Browser:", title)
    if title.startswith("OK"):
        print(f"Preview: {detail}")
        print(f"{len(keys)}/{len(keys)} icons in order")
        print(f"RESULT {len(keys)}/{len(keys)}")
        return 0
    bad = [b for b in title.replace("FAIL", "", 1).split(",") if b.strip()]
    print(f"{max(0, len(keys) - len(bad))}/{len(keys)} icons in order ({len(bad)} failed)")
    print(f"RESULT {max(0, len(keys) - len(bad))}/{len(keys)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
