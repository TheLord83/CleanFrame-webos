#!/usr/bin/env python3
"""Watch the CleanFrame hub from the outside.

The hub writes a heartbeat next to its configuration every 30 seconds
(`/api/heartbeat` answers with the age). This script is the outside half: run it
from cron on a machine that is always on, and a hub that hangs, dies or was
never started turns into a message instead of a mystery.

    tools/watch-hub.py --url http://192.168.0.49:8484 --ntfy https://ntfy.sh/mytopic

Exit codes: 0 fine, 1 stale, 2 not reachable. Nothing is printed unless
something changed or `--always` is given, so the cron mail stays empty.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_STATE = "/var/tmp/cleanframe-watch-hub.json"


def fetch(url, timeout):
    """Return (kind, payload, error). kind is 'up', 'stale' or 'down'."""
    req = urllib.request.Request(url.rstrip("/") + "/api/heartbeat", headers={"User-Agent": "cleanframe-watch/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        return "down", None, str(e)
    if data.get("stale") is True:
        return "stale", data, ""
    return "up", data, ""


def describe(kind, data, err):
    if kind == "down":
        return "nicht erreichbar (%s)" % err
    age = data.get("ageSeconds")
    limit = data.get("staleAfterSeconds")
    if kind == "stale":
        return "haengt: letzter Herzschlag vor %s s (Grenze %s s), Prozess %s" % (age, limit, data.get("pid"))
    return "laeuft: Herzschlag vor %s s, Version %s, Prozess %s" % (age, data.get("hub"), data.get("pid"))


def notify(url, text):
    if not url:
        return
    body = json.dumps({"title": "CleanFrame Hub", "message": text, "tags": ["warning"]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=8).read()
    except Exception as e:  # noqa: BLE001 - a failed notification must not kill the check
        print("Hinweis konnte nicht gesendet werden: %s" % e, file=sys.stderr)


def load_state(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(path, state):
    try:
        with open(path, "w") as f:
            json.dump(state, f)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser(description="Watch the CleanFrame hub heartbeat.")
    ap.add_argument("--url", default="http://127.0.0.1:8484", help="hub address (the TV's IP while the app runs)")
    ap.add_argument("--ntfy", default="", help="ntfy topic URL for the message on a change")
    ap.add_argument("--state", default=DEFAULT_STATE, help="where the last known state is kept")
    ap.add_argument("--timeout", type=float, default=5.0)
    ap.add_argument("--always", action="store_true", help="print the result even when nothing changed")
    args = ap.parse_args()

    kind, data, err = fetch(args.url, args.timeout)
    text = describe(kind, data, err)
    state = load_state(args.state)
    before = state.get("kind")
    state.update({"kind": kind, "text": text, "when": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    save_state(args.state, state)

    changed = before != kind
    if changed and before is not None:
        notify(args.ntfy, text)
    if changed or args.always:
        print(text)

    return 0 if kind == "up" else (1 if kind == "stale" else 2)


if __name__ == "__main__":
    sys.exit(main())
