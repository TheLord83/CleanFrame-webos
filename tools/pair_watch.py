#!/usr/bin/env python3
"""Pairing-Versuch mit forcePairing und Bildschirm-Beobachtung.

Startet das Pairing und macht alle 3 s ein Bildschirmfoto, damit man sieht, ob der Fernseher
einen Dialog zeigt. Speichert den Schlüssel, wenn einer zurückkommt.
"""
import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pair_tv import MANIFEST, WS, keyfile, save_key  # noqa: E402

IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.50"
FORCE = "--force" in sys.argv
WATCH = "--watch" in sys.argv


def screens():
    i = 0
    while i < 12:
        path = "/root/.hermes/cache/scratch/pair_screen_%02d.png" % i
        os.system("curl -sS -m 30 -o %s 'http://%s:8484/api/tv/screenshot.png' >/dev/null 2>&1" % (path, IP))
        print("shot %s" % path, flush=True)
        i += 1
        time.sleep(3)


if WATCH:
    threading.Thread(target=screens, daemon=True).start()

ws = WS.connect(IP, 3000)
ws.send(json.dumps({"type": "register", "id": "reg", "payload": {
    "forcePairing": bool(FORCE), "pairingType": "PROMPT", "manifest": MANIFEST}}))
deadline = time.time() + 60
key = ""
while time.time() < deadline:
    try:
        answer = json.loads(ws.recv(timeout=max(2, deadline - time.time())))
    except Exception as exc:  # noqa: BLE001
        print("Abbruch: %s" % exc, flush=True)
        break
    print("Antwort: %s" % json.dumps(answer)[:250], flush=True)
    key = (answer.get("payload") or {}).get("client-key") or ""
    if key:
        break
if key:
    save_key(IP, key)
    print("KEY OK", flush=True)
else:
    print("kein Key", flush=True)
ws.close()
