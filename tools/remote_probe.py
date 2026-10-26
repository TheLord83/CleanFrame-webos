#!/usr/bin/env python3
"""Testet echte Fernbedienung über SSAP: Pointer-Input-Socket + Tastenrahmen.

Nutzt den gespeicherten Client-Key (/root/lgtv-prep/slopbro/<ip>.key). Ohne Key: Pairing mit
Bildschirm-Dialog.

Aufruf: python3 tools/remote_probe.py 192.168.1.50 down
"""
import base64
import json
import os
import socket
import struct
import sys
import time

IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.50"
KEY_NAME = sys.argv[2] if len(sys.argv) > 2 else "down"
KEYFILE = "/root/lgtv-prep/slopbro/%s.key" % IP


def load_key():
    try:
        return open(KEYFILE).read().strip()
    except IOError:
        return ""


class WS(object):
    def __init__(self, sock):
        self.s = sock
        self.buf = b""

    @classmethod
    def connect(cls, host, port, path="/", timeout=8.0):
        s = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (path, host, port, key))
        s.sendall(req.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = s.recv(4096)
            if not chunk:
                raise RuntimeError("Handshake abgebrochen")
            head += chunk
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError("Handshake: %s" % head.split(b"\r\n")[0].decode("utf-8", "replace"))
        rest = head.split(b"\r\n\r\n", 1)[1]
        ws = cls(s)
        ws.buf = rest
        return ws

    def send(self, text):
        data = text.encode() if isinstance(text, str) else text
        mask = os.urandom(4)
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        self.s.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _need(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise RuntimeError("Verbindung zu")
            self.buf += chunk

    def recv(self, timeout=8.0):
        self.s.settimeout(timeout)
        while True:
            self._need(2)
            b1, b2 = self.buf[0], self.buf[1]
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            off = 2
            if n == 126:
                self._need(4)
                n = struct.unpack(">H", self.buf[2:4])[0]
                off = 4
            elif n == 127:
                self._need(10)
                n = struct.unpack(">Q", self.buf[2:10])[0]
                off = 10
            self._need(off + n)
            payload = self.buf[off:off + n]
            self.buf = self.buf[off + n:]
            if opcode == 0x8:
                raise RuntimeError("Server hat geschlossen")
            if opcode in (0x1, 0x2):
                return payload.decode("utf-8", "replace")

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


MANIFEST = {
    "manifestVersion": 1,
    "appVersion": "1.1",
    "signed": {
        "created": "20140509",
        "appId": "com.lge.test",
        "vendorId": "com.lge",
        "localizedAppNames": {"": "LG Remote App"},
        "permissions": ["TEST_SECURE", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD",
                        "READ_INSTALLED_APPS", "CONTROL_SETTINGS", "READ_INPUT_DEVICE_LIST",
                        "READ_TV_CURRENT_TIME", "READ_POWER_STATE", "CONTROL_POWER"],
    },
}

ws = WS.connect(IP, 3000)
key = load_key()
print("Key vorhanden:", bool(key))

ws.send(json.dumps({"type": "register", "id": "reg0", "payload": {
    "forcePairing": False, "pairingType": "PROMPT", "client-key": key, "manifest": MANIFEST}}))
answer = json.loads(ws.recv())
print("register:", json.dumps(answer)[:200])
newkey = (answer.get("payload") or {}).get("client-key")
if newkey and newkey != key:
    print("Neuer Key:", newkey)
    try:
        open(KEYFILE, "w").write(newkey)
        os.chmod(KEYFILE, 0o600)
    except IOError as exc:
        print("Key nicht speicherbar:", exc)

ws.send(json.dumps({"type": "request", "id": "p1", "uri":
                    "ssap://com.webos.service.networkinput/getPointerInputSocket"}))
answer = json.loads(ws.recv())
print("Antwort:", json.dumps(answer)[:400])
path = (answer.get("payload") or {}).get("socketPath")
print("socketPath:", path)
ws.close()
if not path:
    sys.exit(1)

url = path.split("://", 1)[1]
hostport, _, rest = url.partition("/")
host, _, port = hostport.partition(":")
sock = WS.connect(host or IP, int(port or 3000), "/" + rest)
for frame in ({"type": "button", "name": KEY_NAME.upper()},
              {"type": "button", "name": KEY_NAME.upper()}):
    sock.send(json.dumps(frame))
    print("gesendet:", frame)
    time.sleep(0.6)
sock.close()
print("fertig")
