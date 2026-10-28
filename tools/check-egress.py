#!/usr/bin/env python3
"""Welche HTTP-Verbindungen geht der Launcher nach draussen?

Laedt app/ in einem eigenen Chrome, laesst Chromium alle Requests in ein Netlog
schreiben und wertet das Netlog aus. Alles, was nicht auf 127.0.0.1, localhost
oder ::1 geht, ist eine Verbindung ins Internet.

Aufruf:
    python3 tools/check-egress.py            # nur pruefen, Exit 1 bei Treffern
    python3 tools/check-egress.py --keep     # Netlog und Server-Ordner behalten

Chromium selbst telefoniert von sich aus (Komponenten-Updates, Sync-Probes).
Die Flags unten schalten das ab, damit ein Treffer wirklich aus dem Launcher
kommt. Bleibt trotzdem etwas uebrig, steht es mit Host in der Liste und muss
einzeln bewertet werden.
"""
import argparse
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
LOCAL = {"127.0.0.1", "localhost", "::1", "0.0.0.0", ""}

# Chromium telefoniert von sich aus nach Hause, unabhaengig von der Seite:
# Konto-Probes, Komponenten-Updates, Push-Kanal, Suchleisten-Hintergrund. Diese
# Hosts werden als Browser-Verkehr ausgewiesen und nicht dem Launcher
# zugerechnet. Auf dem Fernseher gibt es kein Chromium-Telemetrie, dort zaehlt
# der Blick auf die echten Verbindungen (siehe tools/check-egress-device.sh).
BROWSER_HOSTS = (
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "gvt1.com",
    "gvt2.com",
    "googleusercontent.com",
    "mtalk.google.com",
    "clients2.google.com",
    "clients4.google.com",
    "accounts.google.com",
    "update.googleapis.com",
    "optimizationguide-pa.googleapis.com",
)


def find_chrome():
    env = os.environ.get("CHROME")
    if env and os.path.exists(env):
        return env
    for cand in (
        os.path.expanduser("~/.agent-browser/browsers"),
        "/opt/google/chrome",
        "/usr/bin",
    ):
        if os.path.isdir(cand):
            for dirpath, _dirs, files in os.walk(cand):
                for f in files:
                    if f in ("chrome", "chromium", "google-chrome"):
                        p = os.path.join(dirpath, f)
                        if os.access(p, os.X_OK):
                            return p
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        p = shutil.which(name)
        if p:
            return p
    return None


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def log_message(self, *a):  # kein Zugriffslog
        pass


def serve():
    port = free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def run_chrome(chrome, url, netlog, workdir, seconds):
    args = [
        chrome,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-client-side-phishing-detection",
        "--no-pings",
        "--metrics-recording-only",
        "--user-data-dir=" + os.path.join(workdir, "profile"),
        "--log-net-log=" + netlog,
        "--net-log-capture-mode=Default",
        url,
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(seconds)
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def parse_netlog(path):
    """Zieht alle angefragten URLs aus dem Netlog.

    Bewusst per Regex und nicht per json.load: Chromium schreibt das Netlog
    fortlaufend, und ein beendeter Prozess hinterlaesst regelmaessig eine halb
    geschriebene Datei. Die Regex findet die URLs auch im abgeschnittenen Teil.
    """
    with open(path, "r", errors="replace") as f:
        raw = f.read()
    urls = set()
    for m in re.finditer(r'"url"\s*:\s*"((?:[^"\\]|\\.)*)"', raw):
        value = m.group(1).encode().decode("unicode_escape", "ignore")
        if "://" in value:
            urls.add(value)
    # SOCKET-Events tragen Host und Schema getrennt. Nur echte Hostnamen
    # uebernehmen: im Netlog steht an dieser Stelle auch mal das Schema selbst
    # ("http"), das waere sonst ein Phantom-Treffer.
    for m in re.finditer(r'"host"\s*:\s*"((?:[^"\\]|\\.)*)"', raw):
        host = m.group(1)
        if not host or host in ("http", "https", "ws", "wss", "quic", "ftp"):
            continue
        if "://" in host:
            # Manche Ereignisse tragen an dieser Stelle die ganze URL. Die ist
            # oben schon erfasst, ein zweiter Eintrag waere nur ein Phantom.
            continue
        if "." in host or host in LOCAL:
            urls.add("http://%s/" % host)
    return urls


def host_of(url):
    rest = url.split("://", 1)[-1]
    host = rest.split("/", 1)[0].split("@")[-1]
    if host.startswith("["):
        host = host[: host.index("]") + 1].strip("[]")
    else:
        host = host.split(":")[0]
    return host.lower()


def is_browser(host):
    return any(host == h or host.endswith("." + h) for h in BROWSER_HOSTS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="Arbeitsordner behalten")
    ap.add_argument("--seconds", type=int, default=18, help="Laufzeit des Launchers")
    args = ap.parse_args()

    chrome = find_chrome()
    if not chrome:
        print("FAIL: kein Chrome gefunden (CHROME=<pfad> setzen)")
        return 2

    workdir = tempfile.mkdtemp(prefix="cf-egress-")
    netlog = os.path.join(workdir, "netlog.json")
    httpd, port = serve()
    url = "http://127.0.0.1:%d/index.html" % port
    try:
        run_chrome(chrome, url, netlog, workdir, args.seconds)
        httpd.shutdown()
        if not os.path.exists(netlog):
            print("FAIL: kein Netlog geschrieben (%s)" % netlog)
            return 2
        urls = parse_netlog(netlog)
        internal, browser, app_out = [], [], []
        for u in sorted(urls):
            host = host_of(u)
            if host in LOCAL:
                internal.append(u)
            elif is_browser(host):
                browser.append(u)
            else:
                app_out.append(u)
        print("Launcher: %s" % APP)
        print("Requests insgesamt: %d (lokal %d, Chromium eigen %d, Launcher extern %d)"
              % (len(urls), len(internal), len(browser), len(app_out)))
        if app_out:
            print("\nVom Launcher nach draussen:")
            for u in app_out:
                print("  %s  %s" % (host_of(u), u[:110]))
        else:
            print("\nVom Launcher nach draussen: nichts.")
        if browser:
            hosts = sorted({host_of(u) for u in browser})
            print("\nChromium-eigener Verkehr (nicht der Launcher): %s" % ", ".join(hosts))
        print("\nLokal angefragt: %d Dateien, alle aus %s" % (len(internal), APP))
        if app_out:
            print("\nRESULT: %d externe Requests aus dem Launcher" % len(app_out))
            return 1
        print("\nRESULT: 0 externe Requests aus dem Launcher")
        return 0
    finally:
        if args.keep:
            print("\nArbeitsordner: %s" % workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
