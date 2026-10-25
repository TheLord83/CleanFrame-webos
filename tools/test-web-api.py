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
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
STUB = os.path.join(WEB, "test", "fixtures", "apps-stub.json")

results = []


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
    })
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
                payload = resp.read().decode()
                ctype = resp.headers.get("Content-Type", "")
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
            # Browser ohne Preflight zugestellt und muss deshalb abgelehnt werden.
            st, d, _ = req("POST", "/api/backup", "lang=de", headers={"Content-Type": "text/plain"}, raw=True)
            assert st == 415, f"text/plain haette abgelehnt werden muessen, war {st}"
            st2, d2, _ = req("POST", "/api/config", {}, raw=False)
            assert st2 == 405, f"POST auf /api/config ist keine Route und muss 405 sein, war {st2}"

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

        def t_restart():
            st, d, _ = req("POST", "/api/system/restart", {})
            assert st == 202, st
            assert d["restarting"] is True

        for name, fn in [
            ("/ liefert die Oberflaeche", t_static),
            ("/api/health meldet Pfad und Version", t_health),
            ("Standardkonfiguration ist leer und gueltig", t_config_default),
            ("Katalog kommt aus dem Stub und enthaelt System-Apps", t_catalog),
            ("PUT /api/config speichert, redigiert Token, entdoppelt", t_put_config),
            ("Konfiguration liegt vollstaendig auf der Platte", t_persisted_on_disk),
            ("leeres Token in der Oberflaeche leert das Geheimnis nicht", t_token_kept_when_empty),
            ("POST ohne application/json wird abgelehnt (415)", t_posts_need_json),
            ("fremde Origin wird abgelehnt (403)", t_cross_origin_refused),
            ("kaputtes JSON wird abgelehnt (400)", t_invalid_json),
            ("Backup wird als Download ausgeliefert", t_backup_download),
            ("Backup laesst sich importieren", t_backup_import),
            ("fremde Sicherungsdatei wird abgelehnt", t_backup_wrong_kind),
            ("Selbsttest im Server ist gruen", t_selftest),
            ("Diagnose prueft Ordner und Glasshouse", t_diag),
            ("Icon-Katalog und SVG-Auslieferung", t_icons),
            ("CORS fuer die TV-App (Origin: null)", t_tv_cors),
            ("Neustart wird angenommen (202)", t_restart),
        ]:
            check(name, fn)

    finally:
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
