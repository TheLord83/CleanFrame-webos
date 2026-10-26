#!/usr/bin/env python3
"""check-selftest.py — runs the interface's own self-test in a throwaway tab.

The page can test itself (`?selftest=ui`): it clicks, saves, reads the
configuration back and writes the result into `#out` and the page title. This
script opens that page in its own browser tab over the DevTools HTTP interface,
waits for the title and closes the tab again — no websocket, no screenshots.

`--dump-dom` was the obvious way and does not work with the bundled Chrome 149
(it hangs until the timeout), so the tab route it is.

Usage: python3 check-selftest.py [--port 9333] [--url URL] [--chrome PATH]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request


def http_json(url, method="GET", timeout=5):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as answer:
        body = answer.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def find_chrome(given):
    if given and os.path.isabs(given) and os.access(given, os.X_OK):
        return given
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        path = shutil.which(name)
        if path:
            return path
    root = os.path.expanduser("~/.agent-browser/browsers")
    if os.path.isdir(root):
        for entry in sorted(os.listdir(root)):
            candidate = os.path.join(root, entry, "chrome")
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return ""


def devtools_alive(port):
    try:
        http_json("http://127.0.0.1:%d/json/version" % port, timeout=3)
        return True
    except Exception:
        return False


def failed_steps(port, url, timeout_s=25.0):
    """Open a tab, wait for the title, close the tab, return the title."""
    # The URL goes in verbatim: /json/new?<url> takes it unencoded, a quoted one
    # arrives as a broken address and the tab ends up on an error page.
    target = http_json("http://127.0.0.1:%d/json/new?%s" % (port, url), "PUT", timeout=10)
    target_id = target.get("id", "")
    if not target_id:
        return ""
    title = ""
    deadline = time.time() + timeout_s
    try:
        while time.time() < deadline:
            time.sleep(0.5)
            for entry in http_json("http://127.0.0.1:%d/json/list" % port, timeout=5):
                if entry.get("id") == target_id:
                    title = (entry.get("title") or "").strip()
            if title in ("SELFTEST-OK", "SELFTEST-FAIL"):
                break
        return title
    finally:
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/close/%s" % (port, target_id), timeout=5).read()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9333)
    parser.add_argument("--url", default="")
    parser.add_argument("--chrome", default="")
    args = parser.parse_args()

    own_process = None
    if not devtools_alive(args.port):
        chrome = find_chrome(args.chrome)
        if not chrome:
            print("  FAIL  no Chrome found - the interface self-test needs a browser")
            print("RESULT 0/1")
            return 1
        profile = "/tmp/cf-selftest-profile-%d" % os.getpid()
        own_process = subprocess.Popen(
            [chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
             "--user-data-dir=" + profile, "--remote-debugging-port=%d" % args.port, "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 30
        while time.time() < deadline and not devtools_alive(args.port):
            time.sleep(0.4)
        if not devtools_alive(args.port):
            own_process.kill()
            print("  FAIL  browser did not come up on port %d" % args.port)
            print("RESULT 0/1")
            return 1

    url = args.url or "http://127.0.0.1:8484/?selftest=ui"
    try:
        title = failed_steps(args.port, url)
    finally:
        if own_process:
            own_process.kill()

    if title == "SELFTEST-OK":
        print("  ok    interface self-test is green  [%s]" % url)
        print("RESULT 1/1")
        return 0
    if title == "SELFTEST-FAIL":
        print("  FAIL  interface self-test reports failures  [see the last run of ?selftest=ui]")
    else:
        print("  FAIL  interface self-test did not finish  [title %r]" % title)
    print("RESULT 0/1")
    return 1


if __name__ == "__main__":
    sys.exit(main())
