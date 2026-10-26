#!/usr/bin/env python3
"""Pair with the TV once and then drive it like a remote control.

Why: `ssap://com.webos.service.networkinput/getPointerInputSocket` is the documented way to send
real button presses (that is what pylgtv, aiowebostv and Home Assistant use). It needs a client
key that was paired with the permission CONTROL_MOUSE_AND_KEYBOARD — the key SlopBro uses for
rooting does not have it, so it answers "401 insufficient permissions".

The first run therefore shows a prompt on the TV. Accept it once with the remote; the key is
stored and every later run works without a prompt.

    python3 tools/pair_tv.py 192.168.1.50 --pair        # pair (prompt on the TV), store the key
    python3 tools/pair_tv.py 192.168.1.50 down ok back  # send buttons
"""
import argparse
import base64
import json
import os
import socket
import struct
import sys
import time

MANIFEST = {
    "manifestVersion": 1,
    "appVersion": "1.1",
    "signed": {
        "created": "20140509",
        "appId": "com.lge.test",
        "vendorId": "com.lge",
        "localizedAppNames": {"": "CleanFrame Remote"},
        "permissions": [
            "TEST_SECURE", "CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD",
            "READ_INSTALLED_APPS", "READ_INPUT_DEVICE_LIST", "READ_TV_CURRENT_TIME",
            "READ_POWER_STATE", "CONTROL_POWER", "CONTROL_AUDIO", "CONTROL_TV_SCREEN",
        ],
    },
}


class WS(object):
    def __init__(self, sock):
        self.s = sock
        self.buf = b""

    @classmethod
    def connect(cls, host, port, path="/", timeout=10.0):
        s = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall(("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                   % (path, host, port, key)).encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = s.recv(4096)
            if not chunk:
                raise RuntimeError("handshake aborted")
            head += chunk
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError("handshake: %s" % head.split(b"\r\n")[0].decode("utf-8", "replace"))
        ws = cls(s)
        ws.buf = head.split(b"\r\n\r\n", 1)[1]
        return ws

    def send(self, text):
        data = text.encode() if isinstance(text, str) else text
        mask = os.urandom(4)
        n = len(data)
        header = bytearray([0x81])
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
                raise RuntimeError("connection closed")
            self.buf += chunk

    def recv(self, timeout=60.0):
        self.s.settimeout(timeout)
        while True:
            self._need(2)
            opcode = self.buf[0] & 0x0F
            n = self.buf[1] & 0x7F
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
                raise RuntimeError("server closed")
            if opcode in (0x1, 0x2):
                return payload.decode("utf-8", "replace")

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


def keyfile(ip):
    return os.environ.get("CF_TV_KEYFILE") or os.path.expanduser("~/.cleanframe/%s.key" % ip)


def load_key(ip):
    try:
        return open(keyfile(ip)).read().strip()
    except IOError:
        return ""


def save_key(ip, key):
    path = keyfile(ip)
    try:
        os.makedirs(os.path.dirname(path))
    except OSError:
        pass
    handle = open(path, "w")
    handle.write(key)
    handle.close()
    os.chmod(path, 0o600)
    print("key stored in %s" % path)


def register(ws, key):
    ws.send(json.dumps({"type": "register", "id": "reg", "payload": {
        "forcePairing": False, "pairingType": "PROMPT", "client-key": key, "manifest": MANIFEST}}))
    return json.loads(ws.recv())


def main(argv=None):
    parser = argparse.ArgumentParser(description="Pair with the TV and send button presses")
    parser.add_argument("ip", nargs="?", default="192.168.1.50")
    parser.add_argument("keys", nargs="*", default=[],
                        help="buttons to press: up down left right ok back menu exit home "
                             "play pause stop volup voldown chup chdown")
    parser.add_argument("--pair", action="store_true", help="pair now (prompt on the TV)")
    parser.add_argument("--wait", type=int, default=60, help="seconds to wait for the prompt")
    parser.add_argument("--hold", type=float, default=0.6, help="seconds between two presses")
    args = parser.parse_args(argv)

    key = "" if args.pair else load_key(args.ip)
    ws = WS.connect(args.ip, 3000)
    if key:
        answer = register(ws, key)
        state = answer.get("type")
        print("register with stored key: %s" % state)
        if state != "registered":
            print("stored key rejected, pairing needed: %s" % json.dumps(answer)[:200])
            ws.close()
            return 1
    else:
        print("pairing - a prompt should appear on the TV, accept it with the remote")
        ws.send(json.dumps({"type": "register", "id": "reg", "payload": {
            "forcePairing": False, "pairingType": "PROMPT", "manifest": MANIFEST}}))
        # The TV first acknowledges the request, then (after someone accepts on screen) sends the
        # key in a second message - so keep reading instead of taking the first answer.
        deadline = time.time() + args.wait
        key = ""
        while time.time() < deadline:
            try:
                answer = json.loads(ws.recv(timeout=max(2, deadline - time.time())))
            except Exception as exc:  # noqa: BLE001
                print("nothing more within %ss (%s)" % (args.wait, exc))
                break
            print("answer: %s" % json.dumps(answer)[:200])
            key = (answer.get("payload") or {}).get("client-key") or ""
            if key:
                break
        if not key:
            print("no client key - the prompt was not accepted")
            ws.close()
            return 1
        save_key(args.ip, key)

    ws.send(json.dumps({"type": "request", "id": "ptr", "uri":
                        "ssap://com.webos.service.networkinput/getPointerInputSocket"}))
    answer = json.loads(ws.recv(timeout=10))
    path = (answer.get("payload") or {}).get("socketPath")
    if not path:
        print("no pointer socket: %s" % json.dumps(answer)[:300])
        ws.close()
        return 1
    print("pointer socket: %s" % path)
    ws.close()

    url = path.split("://", 1)[1]
    hostport, _, rest = url.partition("/")
    host, _, port = hostport.partition(":")
    sock = WS.connect(host or args.ip, int(port or 3000), "/" + rest)
    for name in args.keys:
        sock.send(json.dumps({"type": "button", "name": name.upper()}))
        print("pressed %s" % name.upper())
        time.sleep(args.hold)
    sock.close()
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
