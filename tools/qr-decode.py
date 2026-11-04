#!/usr/bin/env python3
"""Liest den QR-Code, den die App gebaut hat - mit einem fremden Decoder.

    tools/test-setup-qr.js | -> JSON auf stdin: {"rows": ["1010...", ...], "expect": "http://..."}
    python3 tools/qr-decode.py

Ausgabe:
    DECODED <text>     gelesen, Text wie im Code
    MISMATCH <text>    gelesen, aber anders als erwartet
    SKIP <grund>       Decoder fehlt (Rueckgabewert 2)

Warum ein zweiter Decoder und nicht der eigene Encoder als Zeuge: eine Matrix,
die nur zu sich selbst passt, beweist nichts. Gelesen wird mit zxing-cpp, einem
unabhaengigen Projekt. Gebraucht werden dafuer zxing-cpp und numpy; fehlen sie,
sagt das Skript SKIP, statt den Lauf rot zu faerben.
"""
import json
import sys

EXIT_SKIP = 2


def render(rows, quiet=4, scale=8):
    """Matrix als Graustufenbild: 4 Module Ruhezone, 8 Pixel je Modul."""
    import numpy as np

    n = len(rows)
    side = (n + 2 * quiet) * scale
    img = np.full((side, side), 255, dtype='uint8')
    for y in range(side):
        my = y // scale - quiet
        if not (0 <= my < n):
            continue
        for x in range(side):
            mx = x // scale - quiet
            if 0 <= mx < n and rows[my][mx] == '1':
                img[y, x] = 0
    return img


def main():
    try:
        import zxingcpp
    except ImportError:
        print('SKIP zxing-cpp fehlt')
        return EXIT_SKIP
    payload = json.load(sys.stdin)
    rows = payload.get('rows') or []
    expect = payload.get('expect') or ''
    if len(rows) < 21:
        print('MISMATCH keine Matrix')
        return 1
    try:
        img = render(rows)
    except ImportError:
        print('SKIP numpy fehlt')
        return EXIT_SKIP
    found = zxingcpp.read_barcodes(img)
    if not found:
        print('MISMATCH nichts gelesen')
        return 1
    text = found[0].text
    if text != expect:
        print('MISMATCH %s' % text)
        return 1
    print('DECODED %s' % text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
