#!/usr/bin/env python3
"""Misst die tatsaechlich gezeichnete Flaeche jedes Logos.

Die Zahlen in app/assets/icons/metrics.js sagen dem Launcher, wo innerhalb seines
Feldes die Grafik liegt, wie gross sie ist und wie schwer sie wirkt. Sie muessen aus
dem gerenderten SVG kommen, nicht aus einer Annahme ueber das Koordinatensystem -
Prime Video zeichnet in einem 13x3.4-Raster, Netflix in 24x24 mit einem hochkanten
"N", und geratene Werte haben beide falsch stehen lassen.

`ink` ist die Strichstaerke: gezeichnete Pixel geteilt durch die Flaeche der eigenen
Bounding-Box. Das ist das, was das Auge als "schwer" oder "leicht" liest - ein
gefuellter Kreis wirkt schwerer als ein duenner Schriftzug gleicher Groesse. Anteil
am 240er-Quadrat waere dafuer falsch, weil ein flaches Logo dort immer leicht wirkt.

    python3 tools/measure-icons.py            # Bericht, zeigt Abweichungen
    python3 tools/measure-icons.py --write    # metrics.js neu schreiben
"""
import io
import json
import os
import re
import struct
import sys
import zlib

import resvg_py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "app", "assets", "icons")
GRID = 240          # Bezugsraster, in dem der Launcher rechnet
ALPHA_MIN = 8       # alles darunter gilt als leer


def decode_png(png):
    """PNG -> (Breite, Hoehe, Zeilen als RGBA-Bytes). resvg liefert RGBA8."""
    i, w, h, ctype = 8, 0, 0, 0
    idat = b""
    while i < len(png):
        length = struct.unpack(">I", png[i:i + 4])[0]
        kind = png[i + 4:i + 8]
        chunk = png[i + 8:i + 8 + length]
        if kind == b"IHDR":
            w, h, _, ctype = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        i += 12 + length
    if ctype != 6:
        raise SystemExit("erwartet RGBA (Farbtyp 6), bekommen %d" % ctype)
    raw = zlib.decompress(idat)
    stride = w * 4
    rows, prev, pos = [], bytearray(stride), 0
    for _ in range(h):
        filt = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filt == 1:
            for x in range(4, stride):
                line[x] = (line[x] + line[x - 4]) & 255
        elif filt == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif filt == 4:
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                b = prev[x]
                c = prev[x - 4] if x >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def ink_box(svg):
    """Lage, Groesse und Strichstaerke der Grafik im quadratisch gezogenen Feld."""
    px = GRID
    w, h, rows = decode_png(bytes(resvg_py.svg_to_bytes(svg_string=svg, width=px, height=px)))
    top = bot = left = right = None
    count = 0
    for y in range(h):
        row = rows[y]
        for x in range(w):
            if row[x * 4 + 3] > ALPHA_MIN:
                count += 1
                if top is None:
                    top = y
                bot = y
                if left is None or x < left:
                    left = x
                if right is None or x > right:
                    right = x
    if top is None or bot is None or left is None or right is None:
        raise SystemExit("nichts gezeichnet")
    scale = float(GRID) / px
    box_w = (right - left + 1) * scale
    box_h = (bot - top + 1) * scale
    return {
        "n": GRID,
        "x": round(left * scale, 1),
        "y": round(top * scale, 1),
        "w": round(box_w, 1),
        "h": round(box_h, 1),
        # Anteil der Tinte an der eigenen Box = wie dick die Striche sind
        "ink": round(count * scale * scale / max(box_w * box_h, 1.0), 3),
    }


def main():
    write = "--write" in sys.argv
    names = sorted(f[:-4] for f in os.listdir(ICONS) if f.endswith(".svg"))
    old = {}
    path = os.path.join(ICONS, "metrics.js")
    if os.path.exists(path):
        raw = io.open(path, encoding="utf-8").read()
        old = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])

    out, changed = {}, []
    for name in names:
        svg = io.open(os.path.join(ICONS, name + ".svg"), encoding="utf-8").read()
        box = ink_box(svg)
        out[name] = box
        prev = old.get(name)
        if prev and any(abs(prev.get(k, -1) - box[k]) > 1 for k in ("x", "y", "w", "h")):
            changed.append(name)
        vb = re.search(r'viewBox="([^"]+)"', svg)
        print("%-14s %-20s x=%6.1f y=%6.1f w=%6.1f h=%6.1f ink=%.3f%s" % (
            name, vb.group(1) if vb else "-> 24x24", box["x"], box["y"],
            box["w"], box["h"], box["ink"],
            "   <-- Lage geaendert" if name in changed else ""))

    if changed:
        print("\nLage geaendert: %s" % ", ".join(changed))
    if write:
        io.open(path, "w", encoding="utf-8").write(
            "/* Gemessen mit tools/measure-icons.py - nicht von Hand pflegen.\n"
            " * x/y/w/h: Lage und Groesse im 240er-Raster. ink: Strichstaerke\n"
            " * (gezeichnete Pixel / eigene Box) - daraus kommt das Gewicht. */\n"
            "window.FrameIconMetrics = "
            + json.dumps(out, separators=(",", ":"), sort_keys=True) + ";\n")
        print("\nmetrics.js geschrieben (%d Icons)" % len(out))
    elif changed:
        print("\n--write haette %d Eintraege korrigiert." % len(changed))


if __name__ == "__main__":
    main()
