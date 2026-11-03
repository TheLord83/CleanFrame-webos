#!/usr/bin/env python3
"""Erzeugt app/assets/qr-setup.js - den QR-Code fuer die Einrichtung im Browser.

Der Browser auf dem Fernseher ist Chromium 79; eine QR-Bibliothek im Paket
waere Ballast, den niemand ausser dieser einen Ansicht braucht. Deshalb rechnet
dieses Skript die Matrix aus und legt sie als Script-Datei ab - ein Script-Tag
ist auf dem Geraet zuverlaessiger als fetch auf eine lokale Datei (dieselbe
Ueberlegung wie bei assets/icons-catalog.js).

    python3 tools/make-qr.py                       # Standardadresse
    python3 tools/make-qr.py https://beispiel/     # andere Adresse
"""
import json
import sys

try:
    import segno
except ImportError:                     # pragma: no cover - Hinweis statt Traceback
    sys.exit("segno fehlt: pip install segno")

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://lg-home.piratopedia.de/'
OUT = 'app/assets/qr-setup.js'

def matrix(url):
    """Zeilen der QR-Matrix als Strings aus 0/1."""
    q = segno.make(url, error='m')
    return {'size': len(q.matrix),
            'rows': [''.join('1' if c else '0' for c in r) for r in q.matrix]}


def build(url):
    data = matrix(url)
    head = ('/* QR-Code fuer die Einrichtung: erzeugt aus %s, Fehlerkorrektur M.\n'
            ' * Erzeugt von tools/make-qr.py - nicht von Hand aendern. */\n'
            'window.CleanFrameQr = window.CleanFrameQr || {};\n'
            'window.CleanFrameQr.setup = { url: %s, size: %d, rows: [\n'
            % (url, json.dumps(url), data['size']))
    body = ',\n'.join("  '%s'" % row for row in data['rows'])
    return data, head + body + '\n]};\n'


if __name__ == '__main__':
    data, js = build(URL)
    with open(OUT, 'w') as fh:
        fh.write(js)
    print('%s: %d Zeilen, %d Bytes' % (OUT, data['size'], len(js)))
