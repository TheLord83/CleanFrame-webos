#!/usr/bin/env python3
"""Laeuft die Einstellungsseiten am Fernseher ab und sucht Stellen, an denen eine
Richtung ins Leere geht.

    python3 tools/sweep-flow.py --tv 192.168.0.49 [--out /tmp/cf-sweep.json]

Arbeitet ueber die Zustands-API des Hubs (`POST /api/ui/press`, `GET /api/ui/state`),
also ohne Bildschirmfotos.

Zwei Lehren aus dem ersten Anlauf:

1. Nie blind OK druecken. Auf einer Kachel startet OK eine App, auf dem
   Bildschirmschoner-Eintrag den Schoner. Es wird nur gedrueckt, wenn der Zustand
   vorher passt (`util.settings` fuehrt in die Einstellungen).
2. Waechter. Liefert zweimal hintereinander kein Druck eine Aenderung, ist nicht
   die App im Vordergrund, sondern die TV-Oberflaeche (dann landen die Tasten im
   LG-Menue). Der Lauf holt CleanFrame per `/api/tv/launch` nach vorne und bricht
   ab, wenn es danach still bleibt, statt weiterzudruecken.

Ausgabe: eine Zeile pro Seite, Zusammenfassung, vollstaendige Liste als JSON.
"""
import json
import sys
import time
import urllib.request

TV = "192.168.0.49"
OUT = "/tmp/cf-sweep.json"
WAIT = 0.9
APP_ID = "com.blackpearl.cleanframe"
for i, a in enumerate(sys.argv):
    if a == "--tv":
        TV = sys.argv[i + 1]
    elif a == "--out":
        OUT = sys.argv[i + 1]
    elif a == "--wait":
        WAIT = float(sys.argv[i + 1])

HUB = "http://%s:8484" % TV
STUCK = {"n": 0}
responses = {"ok": True}


def _post(path, body, wait):
    req = urllib.request.Request(HUB + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception:  # noqa: BLE001
        pass
    time.sleep(wait)


def press(keys, wait=None):
    """Tasten schicken und den Zustand danach liefern."""
    w = WAIT if wait is None else wait
    req = urllib.request.Request(HUB + "/api/ui/press",
                                 data=json.dumps({"keys": keys, "waitMs": int(w * 1000)}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as exc:  # noqa: BLE001
        print("  (Druck %s fehlgeschlagen: %s)" % (keys, exc))
        return {}
    time.sleep(w)
    return r.get("state") or {}


def state():
    try:
        r = json.loads(urllib.request.urlopen(HUB + "/api/ui/state", timeout=20).read())
    except Exception:  # noqa: BLE001
        return {}
    return r.get("state") or {}


def key(s):
    return (s.get("view"), s.get("action"), s.get("row"), s.get("column"))


def guarded(keys, wait=None):
    """Drucken und pruefen, ob sich etwas bewegt hat.

    Zweimal ohne Aenderung heisst: nicht CleanFrame hat den Fokus, sondern die
    TV-Oberflaeche. Dann die App nach vorne holen und den Druck wiederholen. Erst
    wenn es danach immer noch still bleibt, ist wirklich etwas kaputt - dann
    bricht der Lauf ab, statt weiter in fremde Menues zu tippen.
    """
    before = state()
    after = press(keys, wait)
    if key(after) != key(before):
        STUCK["n"] = 0
        return after
    STUCK["n"] += 1
    if STUCK["n"] < 2:
        return after
    print("  ! keine Reaktion, hole CleanFrame nach vorne")
    _post("/api/tv/home", {}, 3)
    _post("/api/tv/launch", {"appId": APP_ID}, 10)
    STUCK["n"] = 0
    return press(keys, wait)


def to_settings():
    s = state()
    for _ in range(8):
        view = s.get("view")
        if view == "settings":
            return s
        if view == "home":
            action = str(s.get("action") or "")
            if action == "util.settings":
                s = guarded(["ok"], 1.6)
                continue
            if action.startswith("util."):
                return s
            s = guarded(["down"])
            continue
        s = guarded(["back"])
    return s


def to_first_row():
    """An den Anfang der Einstellungsliste, schrittweise und mit Pruefung."""
    s = to_settings()
    if s.get("view") != "settings":
        return s
    for _ in range(14):
        prev = s.get("action")
        s = guarded(["up"], 0.8)
        if s.get("view") != "settings":
            s = to_settings()
            break
        if s.get("action") == prev:
            break
    return s


def sweep_page(name, label):
    s = guarded(["ok"], 1.8)
    rows = s.get("rows") or []
    out = {"page": name, "label": label, "view": s.get("view"), "rows": rows,
           "fits": s.get("fits"), "air": s.get("air"), "dead": [], "note": None}
    if not rows:
        out["note"] = "keine Zeilenliste (view=%s action=%s)" % (s.get("view"), s.get("action"))
        guarded(["back"], 1.2)
        return out
    index = int(s.get("row") or 0)
    for r in range(len(rows)):
        while index < r:
            nxt = guarded(["down"])
            new_index = int(nxt.get("row") or index)
            if new_index == index:
                break
            index = new_index
            s = nxt
        if index != r or len(rows[r]) < 2:
            continue
        before = s.get("column")
        # Am letzten Eintrag einer Reihe darf rechts nichts passieren - das ist
        # der Rand, kein toter Weg.
        if before is not None and before >= len(rows[r]) - 1:
            continue
        s2 = guarded(["right"])
        if s2.get("column") == before:
            out["dead"].append({"row": r, "options": len(rows[r]),
                                "action": s.get("action"), "labels": rows[r]})
        else:
            s2 = guarded(["left"])
        s = s2
    guarded(["back"], 1.2)
    return out


PAGES = [
    ("settings.group.background", "Hintergrund"),
    ("settings.group.layout", "Anordnung"),
    ("settings.group.typography", "Schrift"),
    ("settings.group.focus", "Fokus"),
    ("settings.editor", "Apps auf der Startseite"),
    ("settings.group.clocklang", "Uhr und Sprache"),
    ("settings.group.text", "Textgroesse"),
    ("settings.group.weather", "Wetter"),
    ("settings.group.ent", "Werte auf der Startseite"),
    ("settings.group.setup", "Einrichtung"),
]


def restore_onboarding():
    """Der Test darf die Einrichtung nicht scharf zuruecklassen."""
    try:
        cfg = json.loads(urllib.request.urlopen(HUB + "/api/config", timeout=20).read())["config"]
        ob = cfg.get("onboarding") or {}
        if ob.get("done") is False:
            cfg["onboarding"] = {"done": True, "version": ob.get("version") or 1}
            req = urllib.request.Request(HUB + "/api/config", data=json.dumps(cfg).encode(),
                                         headers={"Content-Type": "application/json"}, method="PUT")
            urllib.request.urlopen(req, timeout=20).read()
            print("  Einrichtung wieder auf erledigt gesetzt")
    except Exception as exc:  # noqa: BLE001
        print("  (Einrichtung nicht zurueckgesetzt: %s)" % exc)


def main():
    """Feste Seitenliste statt "immer weiter runter": die Liste faengt unten wieder
    oben an, und wo der Lauf startet, haengt sonst davon ab, wo er zuletzt stand."""
    pages = []
    for action, label in PAGES:
        s = to_settings()
        if s.get("view") != "settings":
            print("komme nicht in die Einstellungen (view=%s)" % s.get("view"))
            return 2
        # Aus der aktuellen Position nach unten suchen, sonst nach oben. Am Ende
        # der Liste bewirkt runter nichts (Rand, kein Haenger).
        found = s.get("action") == action
        for direction in ("down", "up"):
            if found:
                break
            for _ in range(16):
                if found:
                    break
                nxt = guarded([direction], 0.8)
                if nxt.get("view") != "settings":
                    s = to_settings()
                    if s.get("view") != "settings":
                        break
                    continue
                if nxt.get("action") == (s.get("action") or ""):
                    break
                s = nxt
                found = s.get("action") == action
        if not found:
            pages.append({"page": action, "label": label, "error": "nicht erreichbar",
                          "at": s.get("action"), "dead": [], "rows": []})
            continue
        if action in ("settings.group.setup", "settings.group.samsung"):
            # OK auf diesen beiden Zeilen startet etwas (Einrichtung bzw. LG Home),
            # bevor die Seite messbar ist - deshalb nur der Zustand.
            pages.append({"page": action, "label": label, "view": s.get("view"),
                          "rows": [], "dead": [],
                          "note": "nicht geoeffnet: OK startet hier eine Aktion"})
            continue
        try:
            res = sweep_page(action, label)
        except RuntimeError as exc:
            print("abgebrochen bei %s: %s" % (action, exc))
            break
        pages.append(res)

    dead = [p for p in pages if p.get("dead") or p.get("error")]
    print("%d Seiten abgelaufen" % len(pages))
    for p in pages:
        if p.get("error"):
            print("  FEHLT %-24s %s" % (p["page"], p["error"]))
            continue
        mark = "TOT " if p.get("dead") else "ok  "
        extra = ("  tot: " + ", ".join(str(d["action"]) for d in p["dead"])) if p.get("dead") else ""
        note = ("  " + p["note"]) if p.get("note") else ""
        print("  %s%-24s %-12s rows=%d fits=%s air=%s%s%s" % (
            mark, p["page"].replace("settings.group.", "").replace("settings.", ""),
            p.get("view"), len(p.get("rows") or []), p.get("fits"), p.get("air"), extra, note))
    restore_onboarding()
    _post("/api/tv/home", {}, 3)
    _post("/api/tv/launch", {"appId": APP_ID}, 8)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(pages, fh, ensure_ascii=False, indent=1)
    print("JSON: %s" % OUT)
    print("RESULT %d/%d" % (len(pages) - len(dead), len(pages)))
    return 0 if not dead else 1


if __name__ == "__main__":
    sys.exit(main())
