#!/usr/bin/env python3
"""Pairing über den gesicherten Port 3001 (wss) versuchen.

Home Assistant (aiowebostv) verbindet sich mit 3001/ssl und hat damals einen Dialog am
Fernseher erzeugt. Unsere Versuche liefen über 3000/ws — hier derselbe Ablauf über 3001,
mit Bildschirmfoto-Beobachtung.
"""
import json
import socket
import ssl
import struct
import sys
import threading
import time
import base64
import os

sys.path.insert(0, "/root/cleanframe-webos/tools")
from pair_tv import MANIFEST, WS  # noqa: E402

IP = "192.168.1.50"
WATCH = "/root/.hermes/cache/scratch/pair_secure_%02d.png"


def screens():
    for i in range(10):
        os.system("curl -sS -m 25 -o %s 'http://%s:8484/api/tv/screenshot.png' >/dev/null 2>&1"
                  % (WATCH % i, IP))
        time.sleep(3)


def ws_connect(host, port):
    ctx = ssl._create_unverified_context()
    raw = socket.create_connection((host, port), timeout=10)
    sock = ctx.wrap_socket(raw, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(("GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                  % (host, port, key)).encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("handshake abgebrochen")
        head += chunk
    if b"101" not in head.split(b"\r\n")[0]:
        raise RuntimeError("handshake: %s" % head.split(b"\r\n")[0].decode("utf-8", "replace"))
    ws = WS(sock)
    ws.buf = head.split(b"\r\n\r\n", 1)[1]
    return ws


threading.Thread(target=screens, daemon=True).start()
ws = ws_connect(IP, 3001)
print("verbunden über 3001 (wss), sende register", flush=True)
ws.send(json.dumps({"type": "register", "id": "reg", "payload": {
    "forcePairing": True, "pairingType": "PROMPT", "manifest": MANIFEST}}))
deadline = time.time() + 90
key = ""
while time.time() < deadline:
    try:
        answer = json.loads(ws.recv(timeout=max(2, deadline - time.time())))
    except Exception as exc:  # noqa: BLE001
        print("Abbruch:", exc, flush=True)
        break
    print("Antwort:", json.dumps(answer)[:250], flush=True)
    key = (answer.get("payload") or {}).get("client-key") or ""
    if key:
        break
print("KEY:", "ja" if key else "nein", flush=True)
if key:
    path = os.path.expanduser("~/.cleanframe/%s.key" % IP)
    try:
        os.makedirs(os.path.dirname(path))
    except OSError:
        pass
    open(path, "w").write(key)
    os.chmod(path, 0o600)
    print("gespeichert in", path, flush=True)
ws.close()
