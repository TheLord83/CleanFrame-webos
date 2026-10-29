#!/usr/bin/env python3
"""Stimmen VERSION, app/appinfo.json und web/server.js ueberein?

Drei Builds lang stand im Paket 0.6.15, waehrend der Arbeitsbaum 0.6.17 sagte:
der Versions-Bump traf die Stellen nicht, ohne zu meckern. Diese Pruefung macht
so einen Fehlgriff laut, statt ihn durchzuwinken.
"""
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
want = (root / "VERSION").read_text(encoding="utf-8").strip()
server = (root / "web" / "server.js").read_text(encoding="utf-8")
m = re.search(r"var VERSION = '([0-9.]+)';", server)
found = {
    "VERSION": want,
    "app/appinfo.json": json.loads((root / "app" / "appinfo.json").read_text(encoding="utf-8"))["version"],
    "web/server.js": m.group(1) if m else "?",
}
bad = {k: v for k, v in found.items() if v != want}
for k, v in found.items():
    print("  %-18s %s%s" % (k, v, "" if v == want else "   <- erwartet " + want))
if bad:
    print("FAILED: die Versionen laufen auseinander")
    sys.exit(1)
print("Version %s ueberall gleich" % want)
print("RESULT 1/1")
