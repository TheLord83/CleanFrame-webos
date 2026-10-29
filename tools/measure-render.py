"""Misst die Logos so, wie sie WIRKLICH auf dem Bild stehen.

Nimmt einen Screenshot der Startseite auf einfarbigem Grund, sucht die weissen Pixel
(die Marken und die Namen), teilt sie in sechs Spalten und trennt innerhalb jeder
Spalte die Marke vom Namen durch die groesste senkrechte Luecke. Keine geratenen
Koordinaten: was hier herauskommt, ist das, was der Nutzer sieht.

    PLAIN=1 node tools/shots-home.js /tmp/shots
    python3 tools/measure-render.py /tmp/shots/1-apps.png
"""

import sys
from PIL import Image

WHITE = 170          # ab hier gilt ein Pixel als Marke/Text
GAP = 6              # px Luecke, die Marke und Namen trennt


def main():
    path = sys.argv[1]
    img = Image.open(path).convert("RGB")
    px = img.load()
    W, H = img.size

    # Nur die untere Bildhaelfte: oben stehen Uhr und die drei Werkzeuge, die wuerden
    # sonst als eigene Spalten mitgezaehlt (erster Versuch: 4 statt 6 Spalten).
    TOP = int(H * 0.55)
    cols = {}
    for x in range(W):
        for y in range(TOP, H):
            r, g, b = px[x, y]
            if r > WHITE and g > WHITE and b > WHITE:
                cols[x] = cols.get(x, 0) + 1
    if not cols:
        raise SystemExit("keine weissen Pixel - Hintergrund nicht einfarbig?")

    # Spalten zu Gruppen zusammenfassen (Luecken > 40 px trennen Kacheln)
    xs = sorted(cols)
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] > 40:
            groups.append((cur[0], cur[-1]))
            cur = [x]
        else:
            cur.append(x)
    groups.append((cur[0], cur[-1]))
    groups = [g for g in groups if g[1] - g[0] > 20]
    print("Bild %dx%d, %d Spalten gefunden" % (W, H, len(groups)))
    print("%-4s %-28s %-14s %s" % ("#", "Marke l/t/r/b (Kachelmitte)", "Groesse", "Unterkante/Label"))

    marks = []
    for i, (gx0, gx1) in enumerate(groups):
        rows = {}
        for y in range(TOP, H):
            for x in range(gx0, gx1 + 1):
                r, g, b = px[x, y]
                if r > WHITE and g > WHITE and b > WHITE:
                    rows[y] = rows.get(y, 0) + 1
        ys = sorted(rows)
        if not ys:
            continue
        # Baender bilden
        bands, cur = [], [ys[0]]
        for y in ys[1:]:
            if y - cur[-1] > GAP:
                bands.append((cur[0], cur[-1]))
                cur = [y]
            else:
                cur.append(y)
        bands.append((cur[0], cur[-1]))
        # Das unterste Band ist der Name, alles darueber die Marke
        label = bands[-1]
        mark = bands[0] if len(bands) == 1 else (bands[0][0], bands[-2][1])
        # enge Bounding-Box der Marke
        ml = mr = None
        for y in range(mark[0], mark[1] + 1):
            for x in range(gx0, gx1 + 1):
                r, g, b = px[x, y]
                if r > WHITE and g > WHITE and b > WHITE:
                    if ml is None or x < ml:
                        ml = x
                    if mr is None or x > mr:
                        mr = x
        if ml is None:
            continue
        w = mr - ml + 1
        h = mark[1] - mark[0] + 1
        center = (ml + mr) / 2.0
        tiles = len(groups)
        print("%-4d l=%4d t=%4d r=%4d b=%4d      %3dx%-3d        unten %4d, Name %4d..%4d" % (
            i + 1, ml, mark[0], mr, mark[1], w, h, mark[1], label[0], label[1]))
        marks.append({"i": i + 1, "w": w, "h": h, "cx": center, "bottom": mark[1],
                      "label": label[0], "col": (gx0, gx1)})

    if not marks:
        raise SystemExit("keine Marken gefunden")

    # Kachelmitten: Mitte zwischen den Spaltenmittelpunkten
    centers = [(m["col"][0] + m["col"][1]) / 2.0 for m in marks]
    print("\n%-4s %-10s %-10s %-12s %s" % ("#", "Breite", "Hoehe", "Flaeche", "Mitte-Abw. zur Spalte"))
    for m in marks:
        print("%-4d %-10d %-10d %-12d %+6.1f px   Abstand Marke-Name: %d px" % (
            m["i"], m["w"], m["h"], m["w"] * m["h"], m["cx"] - ((m["col"][0] + m["col"][1]) / 2.0),
            m["label"] - m["bottom"]))

    areas = [m["w"] * m["h"] for m in marks]
    heights = [m["h"] for m in marks]
    bottoms = [m["bottom"] for m in marks]
    gaps = [m["label"] - m["bottom"] for m in marks]
    print("\nFlaeche:       min %d  max %d  Streuung %.0f%%" % (
        min(areas), max(areas), 100.0 * (max(areas) - min(areas)) / max(areas)))
    print("Hoehe:         min %d  max %d" % (min(heights), max(heights)))
    print("Unterkanten:   min %d  max %d  Streuung %d px" % (
        min(bottoms), max(bottoms), max(bottoms) - min(bottoms)))
    print("Abstand Name:  min %d  max %d" % (min(gaps), max(gaps)))


if __name__ == "__main__":
    main()
