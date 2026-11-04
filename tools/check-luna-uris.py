#!/usr/bin/env python3
"""Prueft, dass jeder Luna-Aufruf den Methodennamen IM URI traegt.

    python3 tools/check-luna-uris.py [app/device.js ...]

Warum: auf dem Pruefstand gibt es kein Luna, ein falsch geformter Aufruf faellt
dort also niemandem auf. Auf dem Fernseher faellt er auch nicht auf - er haengt
einfach: PalmServiceBridge bekommt auf `luna://com.webos.service.eim` mit
`{method: 'getAllInputStatus', parameters: {...}}` keine Antwort, und nach acht
Sekunden meldet die Oberflaeche "keine Eingaenge", obwohl der Dienst laeuft.

Richtig ist `luna://<dienst>/<methode>` mit den Parametern als zweitem Argument:

    luna('luna://com.webos.service.eim/getAllInputStatus', { subscribe: false }, cb)

Geprueft wird beides: der URI braucht nach dem Dienstnamen einen Methodenteil,
und in den Parametern darf kein Schluessel `method`/`parameters` stehen.
"""
import glob
import os
import re
import sys

CALL = re.compile(r"""luna\(\s*(['"])(luna://[^'"]+)\1\s*,\s*(\{.*?\})\s*,""", re.S)
BAD_PARAMS = re.compile(r"""(^|[,{\s])(method|parameters)\s*:""")


def check(path):
    problems = []
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    for m in CALL.finditer(src):
        uri, params = m.group(2), m.group(3)
        line = src.count("\n", 0, m.start()) + 1
        rest = uri[len("luna://"):]
        if "/" not in rest or not rest.split("/", 1)[1].strip("/"):
            problems.append((path, line, uri, "kein Methodenteil im URI"))
        if BAD_PARAMS.search(params):
            problems.append((path, line, uri, "method/parameters in den Parametern"))
    return problems


def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join("app", "*.js")))
    allp = []
    total = 0
    for path in files:
        if not os.path.exists(path):
            print("FEHL  %s fehlt" % path)
            return 1
        with open(path, encoding="utf-8") as fh:
            total += len(CALL.findall(fh.read()))
        allp += check(path)
    for path, line, uri, why in allp:
        print("FEHL  %s:%d  %s  (%s)" % (path, line, uri, why))
    print("RESULT %d/%d" % (total - len(allp), total))
    return 0 if not allp else 1


if __name__ == "__main__":
    sys.exit(main())
