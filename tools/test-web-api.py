#!/usr/bin/env python3
"""API-Test fuer den CleanFrame-Config-Server.

Startet den Server mit einem Stub-Katalog und einer temporaeren Konfiguration,
prueft jeden Endpunkt ueber HTTP und meldet Abweichungen. Damit ist die Arbeit
ohne Fernseher und ohne Screenshot pruefbar: jeder Zustand hat einen Endpunkt.

Aufruf:  python3 tools/test-web-api.py
"""
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
STUB = os.path.join(WEB, "test", "fixtures", "apps-stub.json")

results = []

FAKE_STATES = [
    {"entity_id": "sensor.wohnzimmer_temperatur", "state": "21.4",
     "attributes": {"friendly_name": "Wohnzimmer Temperatur", "unit_of_measurement": "°C"}},
    {"entity_id": "light.wohnzimmer_decke", "state": "on",
     "attributes": {"friendly_name": "Wohnzimmer Decke"}},
    {"entity_id": "media_player.tv", "state": "playing",
     "attributes": {"friendly_name": "Fernseher"}},
    {"entity_id": "automation.nachtlicht", "state": "on",
     "attributes": {"friendly_name": "Nachtlicht"}},
    {"entity_id": "sensor.kaputt", "state": "unavailable", "attributes": {"friendly_name": "Kaputt"}},
]


class FakeHA(BaseHTTPRequestHandler):
    """Minimaler Home-Assistant-Ersatz: /api/ und /api/states."""

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.rstrip("/") in ("/api", ""):
            body = {"message": "API running."}
        elif self.path.startswith("/api/states"):
            if self.headers.get("Authorization") != "Bearer testtoken":
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"message":"Unauthorized"}')
                return
            body = FAKE_STATES
        else:
            self.send_response(404)
            self.end_headers()
            return
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def check(name, fn):
    try:
        fn()
        results.append((name, True, ""))
        print(f"  ok    {name}")
    except AssertionError as e:
        results.append((name, False, str(e)))
        print(f"  FAIL  {name}: {e}")
    except Exception as e:  # noqa: BLE001
        results.append((name, False, repr(e)))
        print(f"  FAIL  {name}: {e!r}")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_up(port, timeout=15.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.15)
    raise AssertionError("Server wurde nicht erreichbar")


def main():
    port = free_port()
    tmpdir = tempfile.mkdtemp(prefix="cf-web-test-")
    cfg_path = os.path.join(tmpdir, "config.json")
    env = dict(os.environ)
    env.update({
        "CF_PORT": str(port),
        "CF_CONFIG": cfg_path,
        "CF_STUB_APPS": STUB,
        "CF_GLASSHOUSE": "http://127.0.0.1:9",  # absichtlich tot: Stub gewinnt
        "CF_ICONS_JSON": os.path.join(WEB, "assets", "icons.json"),
        "CF_ICONS_DIR": os.path.join(ROOT, "app", "assets", "icons"),
        "CF_WALL_DIR": os.path.join(ROOT, "app", "assets", "wallpapers"),
        # Port ohne Gegenstelle: der Bildschirmfoto-Test soll den Fehlerpfad pruefen,
        # nicht eine zufaellig laufende Weiterleitung auf dem Rechner treffen.
        "CF_DEVTOOLS_PORT": str(free_port()),
    })
    ha_server = HTTPServer(("127.0.0.1", 0), FakeHA)
    ha_port = ha_server.server_address[1]
    threading.Thread(target=ha_server.serve_forever, daemon=True).start()

    proc = subprocess.Popen([sys.executable.replace("python3", "node") if False else "node", "server.js"],
                            cwd=WEB, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"

    def req(method, path, body=None, headers=None, raw=False):
        data = None
        h = dict(headers or {})
        if body is not None:
            data = body.encode() if raw else json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        r = urllib.request.Request(base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                raw_body = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                payload = raw_body.decode("utf-8", "replace")
                return resp.status, (json.loads(payload) if "json" in ctype else payload), dict(resp.headers)
        except urllib.error.HTTPError as e:
            payload = e.read().decode()
            try:
                return e.code, json.loads(payload), dict(e.headers)
            except json.JSONDecodeError:
                return e.code, payload, dict(e.headers)

    try:
        wait_up(port)
        print(f"\nServer auf Port {port}, Konfiguration {cfg_path}\n")

        def t_schema():
            st, d, _ = req("GET", "/api/schema")
            assert st == 200, st
            sch = d["schema"]
            for key in ("bg", "layout", "apps", "controls", "focus", "material", "fonts", "walls"):
                assert key in sch["look"], key
            assert len(sch["look"]["walls"]) >= 10, len(sch["look"]["walls"])
            assert len(sch["langs"]) == 3, sch["langs"]

        def t_wall_thumb():
            st, d, hdrs = req("GET", "/api/wall/misty")
            assert st == 200, st
            assert "image" in hdrs.get("Content-Type", ""), hdrs
            st2, d2, _ = req("GET", "/api/wall/gibtsnicht")
            assert st2 == 404, st2

        def t_hold_parameter():
            """holdMs wird angenommen (ohne Geraet: 503), ungueltige Tasten bleiben 400."""
            st, d, _ = req("POST", "/api/tv/key", {"keys": ["ok"], "holdMs": 900})
            assert st in (200, 503), (st, d)

        def t_rev_conflict():
            """Ein veralteter Stand darf den neueren nicht ueberschreiben (409)."""
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            current = cfg.get("rev", 0)
            stale = dict(cfg)
            stale["rev"] = max(0, (current or 1) - 1)
            stale["home"] = [{"appId": "netflix", "name": "Veraltet"}]
            st2, d2, _ = req("POST", "/api/config", {"config": stale})
            assert st2 == 409, (st2, d2)
            st3, d3, _ = req("GET", "/api/config")
            assert d3["config"].get("rev") == current, (d3["config"].get("rev"), current)

        def t_tv_keys():
            st, d, _ = req("GET", "/api/tv/keys")
            assert st == 200, st
            for k in ("up", "down", "ok", "back"):
                assert k in d["keys"], k

        def t_tv_key_invalid():
            st, d, _ = req("POST", "/api/tv/key", {"keys": []})
            assert st == 400, (st, d)
            st, d, _ = req("POST", "/api/tv/key", {"keys": ["quatsch"]})
            assert st == 400, (st, d)

        def t_tv_snapshot_without_tv():
            """Ohne DevTools am Testrechner: klare Fehlermeldung statt Absturz."""
            st, d, _ = req("GET", "/api/tv/snapshot")
            assert st in (503, 200), st
            if st == 503:
                assert d["ok"] is False and "error" in d, d

        def t_health():
            st, d, _ = req("GET", "/api/health")
            assert st == 200, st
            assert d["ok"] is True
            assert d["name"] == "cleanframe-web"
            assert d["configPath"] == cfg_path

        def t_static():
            st, body, hdrs = req("GET", "/")
            assert st == 200, st
            assert "CleanFrame" in body
            assert "text/html" in hdrs.get("Content-Type", "")
            st2, _, _ = req("GET", "/nichtvorhanden.txt")
            assert st2 == 404, st2

        def t_config_default():
            st, d, _ = req("GET", "/api/config")
            assert st == 200
            assert d["config"]["lang"] == "system"
            assert d["config"]["home"] == []
            assert d["schemaVersion"] == 1

        def t_catalog():
            st, d, _ = req("GET", "/api/apps")
            assert st == 200, st
            assert d["ok"] is True and d["source"] == "stub", d.get("source")
            ids = {a["appId"] for a in d["apps"]}
            for must in ("netflix", "org.jellyfin.webos", "com.webos.app.enactbrowser",
                         "org.webosbrew.hbchannel", "com.webos.app.hdmi2"):
                assert must in ids, f"{must} fehlt im Katalog"

        def t_put_config():
            body = {"config": {
                "lang": "de",
                "look": {"layout": "list", "apps": "icons", "wall": "misty", "clock": False},
                "home": [
                    {"appId": "netflix", "name": "Filme"},
                    {"appId": "com.webos.app.hdmi2", "name": "PlayStation"},
                    {"appId": "netflix"},
                ],
                "integrations": {"ha": {"url": "http://192.168.1.30:8123", "token": "geheim-123"}},
            }}
            st, d, _ = req("PUT", "/api/config", body)
            assert st == 200, (st, d)
            assert d["ok"] is True
            cfg = d["config"]
            # Redaktion: Token darf nicht zurueckkommen
            assert cfg["integrations"]["ha"]["token"] == "", "Token wurde zurueckgegeben"
            assert cfg["integrations"]["ha"]["hasToken"] is True
            assert len(cfg["home"]) == 2, f"Duplikat nicht entfernt: {cfg['home']}"
            assert cfg["home"][1]["name"] == "PlayStation"
            assert cfg["look"]["apps"] == "icons"

        def t_persisted_on_disk():
            with open(cfg_path, encoding="utf-8") as f:
                raw = json.load(f)
            assert raw["integrations"]["ha"]["token"] == "geheim-123", "Token nicht gespeichert"
            assert raw["home"][0]["name"] == "Filme"

        def t_token_kept_when_empty():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"]["token"] = ""          # Oberflaeche schickt leer
            cfg["integrations"]["ha"]["url"] = "http://neu:8123"
            st, d2, _ = req("PUT", "/api/config", {"config": cfg})
            assert st == 200, (st, d2)
            with open(cfg_path, encoding="utf-8") as f:
                raw = json.load(f)
            assert raw["integrations"]["ha"]["token"] == "geheim-123", "Token wurde geleert"
            assert raw["integrations"]["ha"]["url"] == "http://neu:8123"

        def t_posts_need_json():
            # Glasshouse-PostGuard-Prinzip: "einfacher" Content-Type wird vom
            # Browser ohne Preflight zugestellt. Erlaubt ist er nur der
            # Fernseher-App (127.0.0.1 + Origin: null), sonst abgelehnt.
            st, d, _ = req("POST", "/api/backup", "lang=de", headers={"Content-Type": "text/plain"}, raw=True)
            assert st == 415, f"text/plain haette abgelehnt werden muessen, war {st}"
            # Die TV-App schreibt per POST + text/plain (kein Preflight unter Chromium 79).
            # Geschrieben wird immer die vollstaendige Konfiguration — wie in der App.
            _, cur, _ = req("GET", "/api/config")
            full = cur["config"]
            full.pop("rev", None)   # wie ein Client ohne Revisionsanspruch
            full["look"]["apps"] = "icons"
            st2, d2, _ = req("POST", "/api/config", {"config": full},
                             headers={"Content-Type": "text/plain;charset=UTF-8", "Origin": "null"})
            assert st2 == 200, f"POST /api/config von der TV-App haette 200 sein muessen, war {st2}"
            assert d2["config"]["look"]["apps"] == "icons"
            full.pop("rev", None)
            full["look"]["apps"] = "both"
            st3, d3, _ = req("POST", "/api/config", {"config": full})
            assert st3 == 200, f"POST /api/config mit JSON haette 200 sein muessen, war {st3}"
            assert d3["config"]["look"]["apps"] == "both"

        def t_post_plain_from_foreign_origin():
            # text/plain von einer fremden Seite (Origin gesetzt) darf nicht schreiben
            st, d, _ = req("POST", "/api/config", {"config": {"look": {"apps": "text"}}},
                           headers={"Content-Type": "text/plain", "Origin": "http://evil.example"})
            assert st == 403, f"fremde Origin haette 403 sein muessen, war {st}"

        def t_cross_origin_refused():
            st, d, _ = req("PUT", "/api/config", {"config": {}},
                           headers={"Origin": "http://evil.example"})
            assert st == 403, f"fremde Origin haette 403 sein muessen, war {st}"

        def t_backup_download():
            st, d, hdrs = req("GET", "/api/backup")
            assert st == 200
            assert "attachment" in hdrs.get("Content-Disposition", "")
            assert "cleanframe-backup-" in hdrs.get("Content-Disposition", "")
            assert d["kind"] == "cleanframe-backup"
            assert d["config"]["lang"] == "de"

        def t_backup_import():
            payload = {"kind": "cleanframe-backup", "schemaVersion": 1, "config": {
                "lang": "en", "home": [{"appId": "youtube.leanback.v4", "name": "Videos"}],
                "look": {"layout": "dock", "apps": "both", "wall": "dunes"},
            }}
            st, d, _ = req("POST", "/api/backup", payload)
            assert st == 200, (st, d)
            assert d["config"]["lang"] == "en"
            st, d2, _ = req("GET", "/api/config")
            assert d2["config"]["home"][0]["name"] == "Videos"

        def t_backup_wrong_kind():
            st, d, _ = req("POST", "/api/backup", {"kind": "irgendwas", "config": {}})
            assert st == 400, st

        def t_selftest():
            st, d, _ = req("GET", "/api/selftest")
            assert st == 200
            assert d["ok"] is True, d
            assert len(d["checks"]) >= 6

        def t_diag():
            st, d, _ = req("GET", "/api/diag")
            assert st == 200
            names = [c["name"] for c in d["checks"]]
            assert any("Konfigurationsordner" in n for n in names), names
            assert any("Glasshouse" in n for n in names), names
            # Glasshouse laeuft hier absichtlich nicht -> Pruefung muss false sein
            gh = [c for c in d["checks"] if "Glasshouse" in c["name"]][0]
            assert gh["ok"] is False, "toter Port 9 haette fehlschlagen muessen"

        def t_invalid_json():
            st, d, _ = req("PUT", "/api/config", "{kaputt", raw=True)
            assert st == 400, st

        def t_ha_check():
            st, d, _ = req("POST", "/api/ha/check", {"url": f"http://127.0.0.1:{ha_port}", "token": "testtoken"})
            assert st == 200, st
            assert d["ok"] is True, d
            st2, d2, _ = req("POST", "/api/ha/check", {"url": f"http://127.0.0.1:{ha_port}"})
            assert d2["ok"] is True, d2

        def t_ha_entities():
            # Zugangsdaten setzen, damit der Server sie benutzt
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"] = {"url": f"http://127.0.0.1:{ha_port}", "token": "testtoken", "entities": []}
            st, d, _ = req("PUT", "/api/config", {"config": cfg})
            assert st == 200, (st, d)
            st, d, _ = req("GET", "/api/ha/entities")
            assert st == 200, st
            assert d["ok"] is True, d
            ids = [e["id"] for e in d["entities"]]
            assert "sensor.wohnzimmer_temperatur" in ids, ids
            assert "automation.nachtlicht" not in ids, "Automatisierungen gehoeren nicht in die Auswahl"
            temp = [e for e in d["entities"] if e["id"].endswith("temperatur")][0]
            assert temp["unit"] == "°C" and temp["state"] == "21.4", temp
            kaputt = [e for e in d["entities"] if e["id"] == "sensor.kaputt"][0]
            assert kaputt["state"] == "–", "unavailable muss als – erscheinen"

        def t_ha_values():
            st, d, _ = req("GET", "/api/ha/values?entities=sensor.wohnzimmer_temperatur,light.wohnzimmer_decke,unbekannt.x")
            assert st == 200, st
            assert d["ok"] is True, d
            by = {v["id"]: v for v in d["values"]}
            assert by["sensor.wohnzimmer_temperatur"]["state"] == "21.4"
            assert by["light.wohnzimmer_decke"]["state"] == "on"
            assert by["unbekannt.x"]["state"] == "–", "unbekannte Entitaet darf nicht fehlen"

        def t_ha_wrong_token():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"]["token"] = ""
            req("PUT", "/api/config", {"config": cfg})
            # Token bleibt erhalten (leer = unveraendert) -> falsches Token explizit setzen
            st, d, _ = req("PUT", "/api/config", {"config": {
                "integrations": {"ha": {"url": f"http://127.0.0.1:{ha_port}", "token": "falsch"}}}})
            st, d, _ = req("GET", "/api/ha/entities")
            assert d["ok"] is False, d
            assert "401" in str(d.get("error", "")), d.get("error")

        def t_config_screensaver_and_entities():
            st, d, _ = req("PUT", "/api/config", {"config": {
                "screensaver": {"enabled": True, "minutes": 999, "variant": "starfield"},
                "integrations": {"ha": {"url": "http://x", "entities": [
                    "sensor.a", {"id": "light.b", "label": "Decke"}, "sensor.a", "kaputt", "Gross.Buchstabe"]}},
            }})
            assert st == 200, (st, d)
            cfg = d["config"]
            assert cfg["screensaver"]["minutes"] == 120, cfg["screensaver"]
            assert cfg["screensaver"]["enabled"] is True
            ents = [e["id"] for e in cfg["integrations"]["ha"]["entities"]]
            assert ents == ["sensor.a", "light.b"], ents
            assert cfg["integrations"]["ha"]["entities"][1]["label"] == "Decke"

        def t_config_ui_and_onboarding():
            st, d, _ = req("PUT", "/api/config", {"config": {
                "ui": {"senior": True, "textScale": 999, "cursor": "quatsch"},
                "onboarding": {"done": True},
            }})
            assert st == 200, (st, d)
            cfg = d["config"]
            assert cfg["ui"]["senior"] is True
            assert cfg["ui"]["textScale"] == 200, cfg["ui"]
            assert cfg["ui"]["cursor"] == "focus", cfg["ui"]
            assert cfg["onboarding"]["done"] is True

            st, d, _ = req("PUT", "/api/config", {"config": {"ui": {"textScale": 10}}})
            assert d["config"]["ui"]["textScale"] == 50, d["config"]["ui"]

            # Standard ist: Assistent offen
            st, d, _ = req("PUT", "/api/config", {"config": {}})
            assert d["config"]["onboarding"]["done"] is False, d["config"]["onboarding"]
            assert d["config"]["ui"]["senior"] is False

        def t_icons():
            st, d, _ = req("GET", "/api/icons")
            assert st == 200, st
            assert d["ok"] is True, d
            assert len(d["groups"]) >= 3, d.get("groups")
            keys = [i["key"] for g in d["groups"] for i in g["icons"]]
            assert "playstation" in keys and "ard" in keys, keys[:10]
            st2, svg, hdrs = req("GET", "/icons/playstation.svg")
            assert st2 == 200, st2
            assert "svg" in hdrs.get("Content-Type", ""), hdrs.get("Content-Type")
            st3, _, _ = req("GET", "/icons/../../etc/passwd.svg")
            assert st3 in (400, 404), f"Pfadausbruch nicht abgelehnt: {st3}"

        def t_tv_cors():
            # Die Launcher-App laeuft aus file:// und schickt Origin: null.
            # Anfragen von 127.0.0.1 (also vom Fernseher) muessen durchgehen.
            st, d, hdrs = req("PUT", "/api/config", {"config": {"lang": "en"}},
                              headers={"Origin": "null"})
            assert st == 200, f"Origin null haette erlaubt sein muessen, war {st}"
            assert hdrs.get("Access-Control-Allow-Origin") == "null", hdrs.get("Access-Control-Allow-Origin")
            st2, _, _ = req("OPTIONS", "/api/config", headers={"Origin": "null"})
            assert st2 == 204, st2

        def t_tv_views():
            # Ohne Fernseher gibt es kein Bild, aber die Ansichten-Liste und die
            # Ablehnung unbekannter Namen muessen auch hier stimmen: die
            # Oberflaeche baut ihre Knoepfe daraus.
            st, d, _ = req("GET", "/api/tv/views")
            assert st == 200, st
            assert d["views"] == ["home", "settings", "appearance"], d
            st2, d2, _ = req("POST", "/api/tv/view", {"view": "hack"})
            assert st2 == 400, f"unbekannte Ansicht haette 400 sein muessen, war {st2}"
            assert "unbekannte Ansicht" in d2.get("error", ""), d2

        def t_restart():
            st, d, _ = req("POST", "/api/system/restart", {})
            assert st == 202, st
            assert d["restarting"] is True

        for name, fn in [
            ("/ liefert die Oberflaeche", t_static),
            ("/api/health meldet Pfad und Version", t_health),
            ("Schema liefert alle Darstellungs-Achsen", t_schema),
            ("Wandbild-Vorschau wird ausgeliefert", t_wall_thumb),
            ("Langdruck-Parameter wird angenommen", t_hold_parameter),
            ("Fernbedienung kennt die Tastennamen", t_tv_keys),
            ("ungueltige Tasten werden abgelehnt", t_tv_key_invalid),
            ("Bildschirmfoto ohne Geraet meldet einen Fehler", t_tv_snapshot_without_tv),
            ("Standardkonfiguration ist leer und gueltig", t_config_default),
            ("Katalog kommt aus dem Stub und enthaelt System-Apps", t_catalog),
            ("PUT /api/config speichert, redigiert Token, entdoppelt", t_put_config),
            ("Konfiguration liegt vollstaendig auf der Platte", t_persisted_on_disk),
            ("leeres Token in der Oberflaeche leert das Geheimnis nicht", t_token_kept_when_empty),
            ("POST ohne application/json wird abgelehnt (415), TV-App darf text/plain", t_posts_need_json),
            ("text/plain von fremder Origin wird abgelehnt (403)", t_post_plain_from_foreign_origin),
            ("fremde Origin wird abgelehnt (403)", t_cross_origin_refused),
            ("kaputtes JSON wird abgelehnt (400)", t_invalid_json),
            ("Backup wird als Download ausgeliefert", t_backup_download),
            ("Backup laesst sich importieren", t_backup_import),
            ("fremde Sicherungsdatei wird abgelehnt", t_backup_wrong_kind),
            ("Selbsttest im Server ist gruen", t_selftest),
            ("Diagnose prueft Ordner und Glasshouse", t_diag),
            ("Home-Assistant-Verbindung wird geprueft", t_ha_check),
            ("HA-Entitaeten werden gefiltert und uebersetzt", t_ha_entities),
            ("HA-Werte fuer die Kachel", t_ha_values),
            ("falsches HA-Token wird gemeldet", t_ha_wrong_token),
            ("Bildschirmschoner-Grenzen und Entitaets-Auswahl", t_config_screensaver_and_entities),
            ("Senioren-Modus, Schriftgroesse und Assistent-Zustand", t_config_ui_and_onboarding),
            ("Icon-Katalog und SVG-Auslieferung", t_icons),
            ("CORS fuer die TV-App (Origin: null)", t_tv_cors),
            ("Ansichten am Fernseher: Liste und Ablehnung", t_tv_views),
            ("Neustart wird angenommen (202)", t_restart),
            ("Veralteter Stand wird abgewiesen (409)", t_rev_conflict),
        ]:
            check(name, fn)

    finally:
        ha_server.shutdown()
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} Pruefungen bestanden")
    if failed:
        for name, _, err in failed:
            print(f"  - {name}: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
