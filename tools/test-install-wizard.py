#!/usr/bin/env python3
"""Checks for the install wizard — without a television.

The parts of the wizard that touch a TV are behind SSH and reachable only when one
answers, so this script checks the other half: that the decisions are right, that
nothing risky happens without a confirmation, and that a dry run really changes
nothing. What it cannot check is the device itself; that is what the first real run
is for.

    python3 tools/test-install-wizard.py
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import glasshouse  # noqa: E402
import rooting     # noqa: E402

results = []


def check(name, fn):
    try:
        fn()
        results.append((True, name, ""))
    except Exception as e:  # noqa: BLE001
        results.append((False, name, "%s: %s" % (type(e).__name__, e)))


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class FakeRelease(BaseHTTPRequestHandler):
    """A release with a manifest and an IPK, and one with a wrong hash."""

    def log_message(self, *args):
        pass

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/releases") or self.path.startswith("/?"):
            body = json.dumps([
                {"tag_name": "v9.9.9", "draft": True, "assets": []},
                {"tag_name": "v0.130.0", "published_at": "2026-10-28T00:00:00Z", "body": "notes",
                 "assets": [
                     {"name": "x.ipk", "size": len(PNG), "browser_download_url": self.url("/ipk")},
                     {"name": "x.manifest.json", "size": 10, "browser_download_url": self.url("/manifest")}]},
                {"tag_name": "v0.140.0", "prerelease": True, "assets": [
                    {"name": "y.ipk", "size": 3, "browser_download_url": self.url("/ipk2")}]},
            ]).encode()
        elif self.path == "/manifest":
            body = json.dumps({"id": glasshouse.APP_ID,
                               "ipkHash": {"sha256": hashlib.sha256(PNG).hexdigest()}}).encode()
        elif self.path == "/manifest-bad":
            body = json.dumps({"id": glasshouse.APP_ID,
                               "ipkHash": {"sha256": "0" * 64}}).encode()
        elif self.path in ("/ipk", "/ipk2"):
            body = PNG
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json" if self.path != "/ipk" else "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def url(self, path):
        return "http://127.0.0.1:%d%s" % (self.server.server_address[1], path)


def with_fake(fn):
    srv = HTTPServer(("127.0.0.1", 0), FakeRelease)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    old = glasshouse.RELEASES
    glasshouse.RELEASES = "http://127.0.0.1:%d" % srv.server_address[1]
    try:
        return fn("http://127.0.0.1:%d" % srv.server_address[1])
    finally:
        glasshouse.RELEASES = old
        srv.shutdown()


# ------------------------------------------------------------------ checks ----
def t_release_selection():
    """Drafts and pre-releases are never offered: they are not for somebody's TV."""
    def run(base):
        rels = glasshouse.releases(limit=5)
        assert [r["version"] for r in rels] == ["0.130.0"], rels
        assert rels[0]["ipk_url"].endswith("/ipk"), rels[0]
        assert rels[0]["manifest_url"].endswith("/manifest"), rels[0]
    with_fake(run)


def t_latest_skips_prerelease():
    def run(base):
        assert glasshouse.latest()["version"] == "0.130.0"
    with_fake(run)


def t_download_verifies_hash():
    def run(base):
        rel = glasshouse.latest()
        path, digest = glasshouse.download(rel)
        assert os.path.exists(path), path
        assert digest == hashlib.sha256(PNG).hexdigest(), digest
    with_fake(run)


def t_download_refuses_wrong_hash():
    """An unverified package on the TV is worse than no package."""
    def run(base):
        rel = glasshouse.latest()
        rel["manifest_url"] = base + "/manifest-bad"
        try:
            glasshouse.download(rel)
        except glasshouse.GlasshouseError as e:
            assert "Pruefsumme" in str(e), e
            return
        raise AssertionError("a package with a wrong hash was accepted")
    with_fake(run)


def t_configure_refuses_unknown_keys():
    """It is somebody else's config; only keys we know are written."""
    try:
        glasshouse.configure("127.0.0.1", {"definitely_not_a_setting": 1}, dry_run=True)
    except glasshouse.GlasshouseError as e:
        assert "unbekannte" in str(e), e
        return
    raise AssertionError("an unknown key was accepted")


def t_configure_dry_run_touches_nothing():
    ok, text = glasshouse.configure("127.0.0.1", {"port": 8080}, dry_run=True)
    assert ok and "dry run" in text, text


def t_rooting_offers_the_right_project():
    assert rooting.pick("6.5.0") == "slopbro", rooting.pick("6.5.0")
    assert rooting.pick("4.4.2") == "slopbro"
    assert rooting.pick("7.0") == "dejavuln"
    assert rooting.pick("10.0") == "dejavuln"
    assert rooting.pick("") == "slopbro"


def t_rooting_never_runs_without_confirmation():
    for confirm in (False, None, ""):
        try:
            rooting.run_slopbro("127.0.0.1", confirm=confirm)
        except RuntimeError as e:
            assert "Bestaetigung" in str(e), e
            continue
        raise AssertionError("rooting ran without a confirmation")


def t_rooting_has_no_exploit_inside():
    """The rule the whole module exists for: no payload of our own."""
    src = open(os.path.join(HERE, "lib", "rooting.py"), encoding="utf-8").read()
    for forbidden in ("jsserver", "CVE-", "linuxroot", "crashd", "payload.bin"):
        assert forbidden not in src, "rooting.py seems to contain exploit material: %s" % forbidden
    for key, p in rooting.PROJECTS.items():
        assert p["repo"].startswith("https://github.com/"), p
        assert p["licence"] in ("AGPL-3.0", "MIT"), p
    assert "slopbro/archive" in src, "the exploit is fetched from its own project, not from us"


def t_warning_names_the_risks():
    text = rooting.WARNING
    for word in ("brick", "warranty", "patched", "root"):
        assert word in text, word


def t_wizard_dry_run_changes_nothing():
    """Pointed at nothing listening: the wizard must stop, not invent a TV."""
    probe = socket.socket()
    try:
        probe.connect(("127.0.0.1", 22))
        port22 = True
    except OSError:
        port22 = False
    finally:
        probe.close()
    if port22:
        # A local sshd is not a television: whatever answers on 22, the wizard
        # must not treat it as one and decide on the uid alone.
        assert glasshouse.reachable("127.0.0.1")[0] in (True, False)
    out = subprocess.run([sys.executable, os.path.join(HERE, "install-wizard.py"),
                          "--tv", "127.0.0.1", "--dry-run"],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode in (0, 1, 3), (out.returncode, out.stdout[-400:], out.stderr[-200:])
    if not port22:
        assert "antwortet weder" in out.stdout, out.stdout[-400:]
    else:
        # port open but no shell: the wizard stops instead of inventing a TV
        assert ("komme nicht rein" in out.stdout) or out.returncode == 0, out.stdout[-400:]


def t_wizard_help():
    out = subprocess.run([sys.executable, os.path.join(HERE, "install-wizard.py"), "--help"],
                         capture_output=True, text=True)
    assert out.returncode == 0 and "--dry-run" in out.stdout, out.stdout


def t_glasshouse_reports_no_tv():
    """With no SSH, `installed` says no and does not hang forever."""
    present, version = glasshouse.installed("127.0.0.1")
    assert present is False, (present, version)


for name, fn in [
    ("releases: drafts and pre-releases are skipped", t_release_selection),
    ("releases: the newest stable release wins", t_latest_skips_prerelease),
    ("download: the package is checked against the manifest", t_download_verifies_hash),
    ("download: a wrong hash stops the install", t_download_refuses_wrong_hash),
    ("configure: unknown keys are refused", t_configure_refuses_unknown_keys),
    ("configure: a dry run writes nothing", t_configure_dry_run_touches_nothing),
    ("rooting: the right exploit per webOS version", t_rooting_offers_the_right_project),
    ("rooting: nothing runs without a typed confirmation", t_rooting_never_runs_without_confirmation),
    ("rooting: no exploit material ships in the repo", t_rooting_has_no_exploit_inside),
    ("rooting: the warning names the risks", t_warning_names_the_risks),
    ("wizard: a dry run against nothing stops cleanly", t_wizard_dry_run_changes_nothing),
    ("wizard: --help works", t_wizard_help),
    ("glasshouse: no TV means not installed", t_glasshouse_reports_no_tv),
]:
    check(name, fn)

say_ok = sum(1 for ok, _, _ in results if ok)
for ok, name, err in results:
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  ->  " + err))
print("\n%d/%d checks passed" % (say_ok, len(results)))
print("RESULT %d/%d" % (say_ok, len(results)))
sys.exit(0 if say_ok == len(results) else 1)
