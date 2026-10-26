#!/usr/bin/env python3
"""Pairing vom Gerät selbst (Loopback) versuchen.

Ein SSAP-Register, das über 127.0.0.1 hereinkommt, gilt als lokaler Client. Auf vielen
webOS-Builds entfällt dann der Bestätigungsdialog. Getestet über einen SSH-Tunnel, damit die
Verbindung auf der TV-Seite tatsächlich von 127.0.0.1 kommt.
"""
import json
import sys

sys.path.insert(0, "/root/cleanframe-webos/tools")
from pair_tv import MANIFEST, WS, save_key  # noqa: E402

HOST = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 13000

ws = WS.connect(HOST, PORT)
ws.send(json.dumps({"type": "register", "id": "reg", "payload": {
    "forcePairing": False, "pairingType": "PROMPT", "manifest": MANIFEST}}))
try:
    answer = json.loads(ws.recv(timeout=25))
except Exception as exc:  # noqa: BLE001
    print("keine Antwort:", exc)
    sys.exit(1)
print("Antwort:", json.dumps(answer)[:300])
key = (answer.get("payload") or {}).get("client-key") or ""
if not key:
    print("kein Key im ersten Paket, warte auf zweites")
    try:
        answer = json.loads(ws.recv(timeout=40))
        print("Antwort 2:", json.dumps(answer)[:300])
        key = (answer.get("payload") or {}).get("client-key") or ""
    except Exception as exc:  # noqa: BLE001
        print("keine zweite Antwort:", exc)
if key:
    save_key("192.168.1.50", key)
    ws.send(json.dumps({"type": "request", "id": "ptr", "uri":
                        "ssap://com.webos.service.networkinput/getPointerInputSocket"}))
    try:
        print("pointer:", json.dumps(json.loads(ws.recv(timeout=10)))[:200])
    except Exception as exc:  # noqa: BLE001
        print("pointer-Fehler:", exc)
    print("KEY OK")
else:
    print("KEIN KEY")
ws.close()
