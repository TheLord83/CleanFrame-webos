#!/usr/bin/env python3
"""API test for the CleanFrame config server.

Starts the server with a stub catalog and a temporary configuration, checks every
endpoint over HTTP and reports deviations. That makes the work verifiable
without a TV and without a screenshot: every state has an endpoint.

Usage:  python3 tools/test-web-api.py
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
OSINFO = os.path.join(WEB, "test", "fixtures", "os_info.json")
DEVINFO = os.path.join(WEB, "test", "fixtures", "device_info.json")

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
    """Minimal Home Assistant stand-in: /api/, /api/states and service calls."""

    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        """Service calls. The answer is the list of changed states, as Home
        Assistant does it, so the hub can show the new value at once."""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw or "{}")
        except Exception:  # noqa: BLE001
            payload = {}
        parts = self.path.strip("/").split("/")
        if len(parts) < 4 or parts[0] != "api" or parts[1] != "services":
            self.send_response(404)
            self.end_headers()
            return
        domain, service = parts[2], parts[3]
        entity_id = payload.get("entity_id", "")
        FakeHA.calls.append({"domain": domain, "service": service, "entity_id": entity_id,
                             "auth": self.headers.get("Authorization")})
        changed = []
        for st in FAKE_STATES:
            if st["entity_id"] == entity_id:
                st["state"] = "off" if st["state"] == "on" else "on"
                changed.append({"entity_id": st["entity_id"], "state": st["state"]})
        raw_out = json.dumps(changed).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw_out)))
        self.end_headers()
        self.wfile.write(raw_out)

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


class FakeWx(BaseHTTPRequestHandler):
    """Open-Meteo stand-in: the forecast and the geocoding search.

    Deliberately separate from FakeHA so a weather outage cannot be mistaken for
    a Home Assistant one.
    """

    requests = []

    def log_message(self, *args):
        pass

    def _send(self, body):
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        FakeWx.requests.append(self.path)
        if self.path.startswith("/v1/forecast"):
            return self._send({"current_weather": {"temperature": 17.6, "weathercode": 3},
                               "daily": {"temperature_2m_max": [19.4], "temperature_2m_min": [11.2]}})
        if self.path.startswith("/v1/search"):
            if "name=Nowhere" in self.path:
                return self._send({})
            return self._send({"results": [{"name": "Kiel", "country_code": "DE",
                                            "latitude": 54.3233, "longitude": 10.1228}]})
        self.send_response(404)
        self.end_headers()


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
    raise AssertionError("server could not be reached")


def main():
    port = free_port()
    tmpdir = tempfile.mkdtemp(prefix="cf-web-test-")
    cfg_path = os.path.join(tmpdir, "config.json")
    env = dict(os.environ)
    env.update({
        "CF_PORT": str(port),
        "CF_CONFIG": cfg_path,
        "CF_STUB_APPS": STUB,
        "CF_GLASSHOUSE": "http://127.0.0.1:9",  # deliberately dead: the stub wins
        "CF_ICONS_JSON": os.path.join(WEB, "assets", "icons.json"),
        "CF_ICONS_DIR": os.path.join(ROOT, "app", "assets", "icons"),
        "CF_WALL_DIR": os.path.join(ROOT, "app", "assets", "wallpapers"),
        # Port without a counterpart: the screenshot test should exercise the error
        # path, not hit some forwarding that happens to run on the machine.
        "CF_OS_INFO": OSINFO,
        "CF_DEVICE_INFO": DEVINFO,
        "CF_SCREENSHOT_STUB": "1",
        "CF_DEVTOOLS_PORT": str(free_port()),
    })
    ha_server = HTTPServer(("127.0.0.1", 0), FakeHA)
    ha_port = ha_server.server_address[1]
    threading.Thread(target=ha_server.serve_forever, daemon=True).start()

    wx_server = HTTPServer(("127.0.0.1", 0), FakeWx)
    wx_base = "http://127.0.0.1:%d" % wx_server.server_address[1]
    threading.Thread(target=wx_server.serve_forever, daemon=True).start()
    env["CF_WEATHER_BASE"] = wx_base
    env["CF_WEATHER_GEO"] = wx_base

    proc = subprocess.Popen([sys.executable.replace("python3", "node") if False else "node", "server.js"],
                            cwd=WEB, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"

    def cfg_now():
        """The configuration as the hub would hand it to the interface."""
        code, d, _ = req("GET", "/api/config")
        assert code == 200 and d.get("ok") is True, d
        return d["config"]

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
        print(f"\nServer on port {port}, configuration {cfg_path}\n")

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
            """holdMs is accepted (without a device: 503), invalid keys stay 400."""
            st, d, _ = req("POST", "/api/tv/key", {"keys": ["ok"], "holdMs": 900})
            assert st in (200, 503), (st, d)

        def t_rev_conflict():
            """An older revision must not overwrite the newer one (409)."""
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
            """Without DevTools on the test machine: a clear error instead of a crash."""
            st, d, _ = req("GET", "/api/tv/snapshot")
            assert st in (503, 200), st
            if st == 503:
                assert d["ok"] is False and "error" in d, d

        def t_tv_info():
            """Model, webOS and firmware come from os_info.json on the TV."""
            st, d, _ = req("GET", "/api/tv/info")
            assert st == 200, st
            assert d["ok"] is True, d
            assert d["modelName"] == "43NANO779PA", d
            assert d["webOs"] == "webOS TV Lite 6.5.0", d
            assert d["firmware"] == "03.51.16", d
            assert d["kernel"].startswith("4.4.84"), d
            assert d["codename"] == "kisscurl-koli", d
            assert "serial" not in d, "the serial number is nobody's business on the LAN"
            assert "hardwareId" not in d, d
            assert "osPath" not in d and "devicePath" not in d, d
            assert d["board"] and d["ram"], d
            assert d["hub"] == "0.5.7", d
            assert d["node"], d

        def t_tv_screenshot():
            st, d, _ = req("POST", "/api/tv/screenshot", {"format": "PNG", "width": 1920, "height": 1080})
            assert st == 200, (st, d)
            assert d["ok"] is True, d
            assert d["bytes"] > 0, d
            assert d["width"] == 1920 and d["height"] == 1080, d
            assert d["file"].endswith(".png"), d

        def t_tv_screenshot_png():
            st, body, hdrs = req("GET", "/api/tv/screenshot.png", raw=True)
            assert st == 200, st
            assert "image/png" in hdrs.get("Content-Type", ""), hdrs
            assert "PNG" in body[:8], body[:8]
            assert len(body) > 50, len(body)

        def t_health():
            st, d, _ = req("GET", "/api/health")
            assert st == 200, st
            assert d["ok"] is True
            assert d["name"] == "cleanframe-web"
            assert d["configPath"] == os.path.basename(cfg_path), "no directories in the reply"

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
                assert must in ids, f"{must} missing from the catalog"

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
            # Redaction: the token must not come back
            assert cfg["integrations"]["ha"]["token"] == "", "token was returned"
            assert cfg["integrations"]["ha"]["hasToken"] is True
            assert len(cfg["home"]) == 2, f"duplicate not removed: {cfg['home']}"
            assert cfg["home"][1]["name"] == "PlayStation"
            assert cfg["look"]["apps"] == "icons"

        def t_persisted_on_disk():
            with open(cfg_path, encoding="utf-8") as f:
                raw = json.load(f)
            assert raw["integrations"]["ha"]["token"] == "geheim-123", "token not stored"
            assert raw["home"][0]["name"] == "Filme"

        def t_token_kept_when_empty():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"]["token"] = ""          # interface sends empty
            cfg["integrations"]["ha"]["url"] = "http://neu:8123"
            st, d2, _ = req("PUT", "/api/config", {"config": cfg})
            assert st == 200, (st, d2)
            with open(cfg_path, encoding="utf-8") as f:
                raw = json.load(f)
            assert raw["integrations"]["ha"]["token"] == "geheim-123", "token was cleared"
            assert raw["integrations"]["ha"]["url"] == "http://neu:8123"

        def t_posts_need_json():
            # Glasshouse postGuard principle: a "simple" content type is delivered
            # by the browser without a preflight. It is only allowed for the TV app
            # (127.0.0.1 + Origin: null), rejected otherwise.
            st, d, _ = req("POST", "/api/backup", "lang=de", headers={"Content-Type": "text/plain"}, raw=True)
            assert st == 415, f"text/plain should have been rejected, was {st}"
            # The TV app writes via POST + text/plain (no preflight under Chromium 79).
            # What is written is always the complete configuration — as in the app.
            _, cur, _ = req("GET", "/api/config")
            full = cur["config"]
            full.pop("rev", None)   # like a client without a revision claim
            full["look"]["apps"] = "icons"
            st2, d2, _ = req("POST", "/api/config", {"config": full},
                             headers={"Content-Type": "text/plain;charset=UTF-8", "Origin": "null"})
            assert st2 == 200, f"POST /api/config from the TV app should have been 200, was {st2}"
            assert d2["config"]["look"]["apps"] == "icons"
            full.pop("rev", None)
            full["look"]["apps"] = "both"
            st3, d3, _ = req("POST", "/api/config", {"config": full})
            assert st3 == 200, f"POST /api/config with JSON should have been 200, was {st3}"
            assert d3["config"]["look"]["apps"] == "both"

        def t_post_plain_from_foreign_origin():
            # text/plain from a foreign page (Origin set) must not write
            st, d, _ = req("POST", "/api/config", {"config": {"look": {"apps": "text"}}},
                           headers={"Content-Type": "text/plain", "Origin": "http://evil.example"})
            assert st == 403, f"foreign origin should have been 403, was {st}"

        def t_cross_origin_refused():
            st, d, _ = req("PUT", "/api/config", {"config": {}},
                           headers={"Origin": "http://evil.example"})
            assert st == 403, f"foreign origin should have been 403, was {st}"

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
            # Glasshouse deliberately does not run here -> the check must be false
            gh = [c for c in d["checks"] if "Glasshouse" in c["name"]][0]
            assert gh["ok"] is False, "dead port 9 should have failed"

        def t_invalid_json():
            st, d, _ = req("PUT", "/api/config", "{kaputt", raw=True)
            assert st == 400, st

        def t_weather_off_by_default():
            """Without the switch the answer says so, and nobody asks Open-Meteo."""
            before = len(FakeWx.requests)
            code, d, _ = req("GET", "/api/weather")
            assert code == 200 and d.get("enabled") is False, d
            assert len(FakeWx.requests) == before, "weather was fetched although it is off"

        def t_weather_forecast():
            """Switched on: one call, rounded values, a word instead of a code."""
            cfg = cfg_now()
            cfg["integrations"]["weather"].update({"enabled": True, "place": "Kiel, DE",
                                                   "lat": 54.32, "lon": 10.12, "unit": "c"})
            code, _, _ = req("POST", "/api/config", {"config": cfg})
            assert code == 200
            code, d, _ = req("GET", "/api/weather")
            assert code == 200 and d.get("ok") is True, d
            assert d.get("temp") == 18, d          # 17,6 gerundet
            assert d.get("high") == 19 and d.get("low") == 11, d
            assert d.get("text") in ("bedeckt", "overcast"), d
            assert d.get("celsius") is True, d

        def t_weather_cached():
            """A second look inside the quarter hour does not hit the network again."""
            req("GET", "/api/weather")
            before = len([r for r in FakeWx.requests if r.startswith("/v1/forecast")])
            req("GET", "/api/weather")
            after = len([r for r in FakeWx.requests if r.startswith("/v1/forecast")])
            assert after == before, "cached answer was fetched again"

        def t_weather_style():
            """How the line looks is a setting, and a bad value falls back instead of breaking."""
            cfg = cfg_now()
            cfg["integrations"]["weather"].update({"enabled": True, "style": "icon", "size": "large",
                                                   "quiet": False, "pos": "end", "unit": "f"})
            code, _, _ = req("POST", "/api/config", {"config": cfg})
            assert code == 200
            w = cfg_now()["integrations"]["weather"]
            assert (w["style"], w["size"], w["quiet"], w["pos"]) == ("icon", "large", False, "end"), w
            # Fahrenheit gibt es nicht mehr: die Einheit wird verworfen, nicht gespeichert.
            assert "unit" not in w, w
            cfg = cfg_now()
            cfg["integrations"]["weather"].update({"style": "quatsch", "size": "riesig", "pos": "irgendwo"})
            code, _, _ = req("POST", "/api/config", {"config": cfg})
            assert code == 200
            w = cfg_now()["integrations"]["weather"]
            assert w["style"] == "icon-temp" and w["size"] == "normal" and w["pos"] == "right", w

        def t_weather_geocode():
            """The place is turned into coordinates once and stored."""
            code, d, _ = req("POST", "/api/weather/place", {"name": "Kiel"})
            assert code == 200 and d.get("ok") is True, d
            assert d.get("place") == "Kiel, DE" and abs(d.get("lat") - 54.3233) < 0.001, d
            w = cfg_now()["integrations"]["weather"]
            assert w["lat"] and w["lon"], w

        def t_weather_unknown_place():
            code, d, _ = req("POST", "/api/weather/place", {"name": "Nowhere"})
            assert code == 200 and d.get("ok") is False, d
            assert "not found" in (d.get("error") or ""), d

        def t_ha_check():
            # A check against a foreign address has to bring its own token ...
            st, d, _ = req("POST", "/api/ha/check", {"url": f"http://127.0.0.1:{ha_port}", "token": "testtoken"})
            assert st == 200, st
            assert d["ok"] is True, d
            # ... otherwise the stored token would travel to whatever URL the body names.
            st2, d2, _ = req("POST", "/api/ha/check", {"url": f"http://127.0.0.1:{ha_port}"})
            assert st2 == 400, f"foreign URL must not get the stored token, was {st2}: {d2}"
            assert "eigenen Token" in d2.get("error", ""), d2
            # The stored URL itself may be checked without a token.
            st3, d3, _ = req("GET", "/api/config")
            cfg = d3["config"]
            cfg["integrations"]["ha"]["url"] = f"http://127.0.0.1:{ha_port}"
            st4, d4, _ = req("PUT", "/api/config", {"config": cfg})
            assert st4 == 200, (st4, d4)
            st5, d5, _ = req("POST", "/api/ha/check", {"url": f"http://127.0.0.1:{ha_port}"})
            assert st5 == 200 and d5["ok"] is True, (st5, d5)

        def t_backup_has_no_secrets():
            """The backup is a download anyone in the LAN can fetch."""
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"]["token"] = "HA-GEHEIM-123"
            cfg["integrations"]["mqtt"]["password"] = "MQTT-GEHEIM-456"
            st2, d2, _ = req("PUT", "/api/config", {"config": cfg})
            assert st2 == 200, (st2, d2)
            st3, d3, _ = req("GET", "/api/backup")
            assert st3 == 200, st3
            blob = json.dumps(d3["config"])
            assert "HA-GEHEIM-123" not in blob, "backup hands out the HA token"
            assert "MQTT-GEHEIM-456" not in blob, "backup hands out the MQTT password"
            assert d3["config"]["integrations"]["ha"]["hasToken"] is True, d3["config"]["integrations"]["ha"]
            # and the file on disk still has them
            with open(cfg_path, encoding="utf-8") as f:
                raw = json.load(f)
            assert raw["integrations"]["ha"]["token"] == "HA-GEHEIM-123"

        def t_ha_entities():
            # Set credentials so the server uses them
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
            assert "automation.nachtlicht" not in ids, "automations do not belong in the selection"
            temp = [e for e in d["entities"] if e["id"].endswith("temperatur")][0]
            assert temp["unit"] == "°C" and temp["state"] == "21.4", temp
            kaputt = [e for e in d["entities"] if e["id"] == "sensor.kaputt"][0]
            assert kaputt["state"] == "unavailable", "the raw state stays readable for the interface"

        def t_ha_values():
            st, d, _ = req("GET", "/api/ha/values?entities=sensor.wohnzimmer_temperatur,light.wohnzimmer_decke,unbekannt.x")
            assert st == 200, st
            assert d["ok"] is True, d
            by = {v["id"]: v for v in d["values"]}
            assert by["sensor.wohnzimmer_temperatur"]["state"] == "21.4"
            assert by["light.wohnzimmer_decke"]["state"] == "on"
            assert by["unbekannt.x"]["state"] == "unknown", "an unknown entity must not be missing"

        def t_ha_shown_roundtrip():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"] = {
                "url": f"http://127.0.0.1:{ha_port}", "token": "testtoken",
                "entities": [{"id": "light.wohnzimmer_decke", "label": "", "shown": False},
                             {"id": "sensor.wohnzimmer_temperatur", "label": "Temperatur"}]}
            st, d, _ = req("PUT", "/api/config", {"config": cfg})
            assert st == 200, (st, d)
            st, d, _ = req("GET", "/api/config")
            ents = d["config"]["integrations"]["ha"]["entities"]
            assert ents[0]["shown"] is False, ents
            assert ents[1]["shown"] is True, ents

        def t_ha_toggle():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"] = {"url": f"http://127.0.0.1:{ha_port}", "token": "testtoken",
                                         "entities": [{"id": "light.wohnzimmer_decke", "label": ""}]}
            req("PUT", "/api/config", {"config": cfg})
            FakeHA.calls.clear()
            st, d, _ = req("POST", "/api/ha/toggle", {"entity_id": "light.wohnzimmer_decke"})
            assert st == 200, (st, d)
            assert d["ok"] is True, d
            assert d["state"] == "off", d
            assert FakeHA.calls and FakeHA.calls[0]["domain"] == "light", FakeHA.calls
            assert FakeHA.calls[0]["service"] == "toggle", FakeHA.calls
            assert FakeHA.calls[0]["entity_id"] == "light.wohnzimmer_decke", FakeHA.calls
            assert FakeHA.calls[0]["auth"] == "Bearer testtoken", "the stored token must be used"

        def t_ha_toggle_refused():
            FakeHA.calls.clear()
            st, d, _ = req("POST", "/api/ha/toggle", {"entity_id": "cover.rollladen"})
            assert st == 400, (st, d)
            assert d["ok"] is False and "nicht schalten" in d["error"], d
            st, d, _ = req("POST", "/api/ha/toggle", {})
            assert st == 400, (st, d)
            assert not FakeHA.calls, "a refused entity must not reach Home Assistant"

        def t_ha_wrong_token():
            st, d, _ = req("GET", "/api/config")
            cfg = d["config"]
            cfg["integrations"]["ha"]["token"] = ""
            req("PUT", "/api/config", {"config": cfg})
            # Token is kept (empty = unchanged) -> set a wrong token explicitly
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

            # Default is: wizard open
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
            assert st3 in (400, 404), f"path traversal not rejected: {st3}"

        def t_tv_cors():
            # The launcher app runs from file:// and sends Origin: null.
            # Requests from 127.0.0.1 (that is, from the TV) must pass.
            st, d, hdrs = req("PUT", "/api/config", {"config": {"lang": "en"}},
                              headers={"Origin": "null"})
            assert st == 200, f"Origin null should have been allowed, was {st}"
            assert hdrs.get("Access-Control-Allow-Origin") == "null", hdrs.get("Access-Control-Allow-Origin")
            st2, _, _ = req("OPTIONS", "/api/config", headers={"Origin": "null"})
            assert st2 == 204, st2

        def t_tv_views():
            # Without a TV there is no image, but the view list and the rejection
            # of unknown names must be correct here too: the interface builds its
            # buttons from them.
            st, d, _ = req("GET", "/api/tv/views")
            assert st == 200, st
            assert d["views"] == ["home", "settings", "appearance"], d
            st2, d2, _ = req("POST", "/api/tv/view", {"view": "hack"})
            assert st2 == 400, f"unknown view should have been 400, was {st2}"
            assert "unbekannte Ansicht" in d2.get("error", ""), d2

        def t_restart():
            st, d, _ = req("POST", "/api/system/restart", {})
            assert st == 202, st
            assert d["restarting"] is True

        def t_missing_luna_send_is_an_error_not_a_crash():
            """0.5.1 died on this: the capture helper was missing, the spawn error
            arrived as an event, and the unhandled 'error' took the hub with it.
            The endpoint has to answer 502 and the process has to stay up."""
            port2 = free_port()
            tmp2 = tempfile.mkdtemp(prefix="cf-luna-")
            env2 = dict(os.environ)
            env2.update({
                "CF_PORT": str(port2),
                "CF_CONFIG": os.path.join(tmp2, "config.json"),
                "CF_STUB_APPS": STUB,
                "CF_GLASSHOUSE": "http://127.0.0.1:9",
                "CF_ICONS_JSON": os.path.join(WEB, "assets", "icons.json"),
                "CF_ICONS_DIR": os.path.join(ROOT, "app", "assets", "icons"),
                "CF_WALL_DIR": os.path.join(ROOT, "app", "assets", "wallpapers"),
                "CF_OS_INFO": OSINFO,
                "CF_DEVICE_INFO": DEVINFO,
                "CF_LUNA_SEND": "/nonexistent/luna-send",
                "CF_SHOT_DIR": tmp2,
                "CF_DEVTOOLS_PORT": str(free_port()),
                "CF_FORWARD_CMD": "",
            })
            env2.pop("CF_SCREENSHOT_STUB", None)
            p2 = subprocess.Popen(["node", "server.js"], cwd=WEB, env=env2,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                wait_up(port2)
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port2}/api/tv/screenshot.png", timeout=40) as r:
                        st, body = r.status, r.read().decode("utf-8", "replace")
                except urllib.error.HTTPError as e:
                    st, body = e.code, e.read().decode("utf-8", "replace")
                assert st == 502, f"expected 502 without luna-send, got {st}: {body[:200]}"
                assert "ENOENT" in body, body[:200]
                assert p2.poll() is None, "the hub died on a missing luna-send"
                with urllib.request.urlopen(f"http://127.0.0.1:{port2}/api/health", timeout=5) as r:
                    assert r.status == 200, r.status
            finally:
                p2.send_signal(signal.SIGTERM)
                try:
                    p2.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p2.kill()

        for name, fn in [
            ("/ serves the interface", t_static),
            ("/api/health reports path and version", t_health),
            ("schema delivers all display axes", t_schema),
            ("wallpaper preview is served", t_wall_thumb),
            ("long-press parameter is accepted", t_hold_parameter),
            ("remote control knows the key names", t_tv_keys),
            ("invalid keys are rejected", t_tv_key_invalid),
            ("screenshot without a device reports an error", t_tv_snapshot_without_tv),
            ("/api/tv/info returns model, webOS and firmware", t_tv_info),
            ("POST /api/tv/screenshot captures the whole screen", t_tv_screenshot),
            ("GET /api/tv/screenshot.png delivers the picture", t_tv_screenshot_png),
            ("default configuration is empty and valid", t_config_default),
            ("catalog comes from the stub and contains system apps", t_catalog),
            ("PUT /api/config saves, redacts token, removes duplicates", t_put_config),
            ("configuration is fully on disk", t_persisted_on_disk),
            ("empty token in the interface does not clear the secret", t_token_kept_when_empty),
            ("POST without application/json is rejected (415), TV app may use text/plain", t_posts_need_json),
            ("text/plain from a foreign origin is rejected (403)", t_post_plain_from_foreign_origin),
            ("foreign origin is rejected (403)", t_cross_origin_refused),
            ("broken JSON is rejected (400)", t_invalid_json),
            ("backup is served as a download", t_backup_download),
            ("backup contains no secrets", t_backup_has_no_secrets),
            ("backup can be imported", t_backup_import),
            ("foreign backup file is rejected", t_backup_wrong_kind),
            ("self-test in the server is green", t_selftest),
            ("diagnostics check folder and Glasshouse", t_diag),
            ("weather is off until it is switched on", t_weather_off_by_default),
            ("weather line shows rounded values", t_weather_forecast),
            ("weather answer is cached for fifteen minutes", t_weather_cached),
            ("the look of the weather line is a setting", t_weather_style),
            ("a place name becomes coordinates", t_weather_geocode),
            ("an unknown place is reported", t_weather_unknown_place),
            ("Home Assistant connection is checked", t_ha_check),
            ("HA entities are filtered and translated", t_ha_entities),
            ("HA values for the tile", t_ha_values),
            ("a value hidden on the TV stays hidden in the hub", t_ha_shown_roundtrip),
            ("HA toggle switches exactly the chosen entity", t_ha_toggle),
            ("HA toggle refuses what needs more than a button", t_ha_toggle_refused),
            ("wrong HA token is reported", t_ha_wrong_token),
            ("screensaver limits and entity selection", t_config_screensaver_and_entities),
            ("senior mode, text size and wizard state", t_config_ui_and_onboarding),
            ("icon catalog and SVG delivery", t_icons),
            ("CORS for the TV app (Origin: null)", t_tv_cors),
            ("views on the TV: list and rejection", t_tv_views),
            ("restart is accepted (202)", t_restart),
            ("stale revision is rejected (409)", t_rev_conflict),
            ("a missing luna-send is an error, not a crash", t_missing_luna_send_is_an_error_not_a_crash),
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
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    print(f"RESULT {len(results) - len(failed)}/{len(results)}")
    if failed:
        for name, _, err in failed:
            print(f"  - {name}: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
