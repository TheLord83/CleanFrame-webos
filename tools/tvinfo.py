#!/usr/bin/env python3
"""What can we learn about an LG TV without root and without touching its screen?

Three unauthenticated sources are tried, in this order:

1. **SSDP description** — the TV's own device description (LOCATION from the M-SEARCH
   answer, or http://<ip>:1900/). Gives friendlyName, modelName, modelNumber, manufacturer
   and, on some TVs, a software version field.
2. **DIAL** — `urn:dial-multiscreen-org:service:dial:1` description, same idea.
3. **AirPlay (mDNS)** — `_airplay._tcp.local`; LG TVs that support AirPlay 2 publish
   `model=` and often a version-ish field in their TXT record.
4. **SSAP handshake** — port 3000/3001: proves it is a webOS TV that speaks SSAP (the
   launcher/hub will need that later anyway). No pairing, no prompt.

What this tool deliberately does NOT do: pretend it knows the firmware when the TV does not
tell it. `webos` and `firmware` stay empty if no source answers, because a guessed version
would be worse than none — rooting depends on it.

    python3 tools/tvinfo.py 192.168.1.50
    python3 tools/tvinfo.py 192.168.1.50 --json

Exit codes: 0 = at least one source answered, 1 = nothing answered, 2 = bad arguments.
"""
import argparse
import base64
import hashlib
import json
import re
import socket
import sys
import urllib.request
import xml.etree.ElementTree as ET

SSDP_ADDR = ("239.255.255.250", 1900)
SSAP_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
VERSION_KEYS = ("firmwareVersion", "swVersion", "softwareVersion", "version",
                "webosversion", "webosVersion", "osVersion", "deviceVersion")


def _http(url, timeout=3.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.read(200000).decode("utf-8", "replace")
    except Exception:
        return ""


def _xml_fields(text):
    """Pull every element we care about out of a UPnP description."""
    out = {}
    if not text:
        return out
    try:
        root = ET.fromstring(text)
    except Exception:
        root = None
    if root is not None:
        for element in root.iter():
            tag = element.tag.split("}")[-1]
            if not tag or element.text is None:
                continue
            value = element.text.strip()
            if not value:
                continue
            out.setdefault(tag, value)
    for key in VERSION_KEYS:
        if key not in out:
            match = re.search(r"<%s[^>]*>([^<]+)</%s>" % (key, key), text, re.I)
            if match:
                out[key] = match.group(1).strip()
    return out


def ssdp_search(ip, timeout=2.0):
    """Ask the TV itself for its description (unicast M-SEARCH, then the LOCATION)."""
    targets = [
        "urn:dial-multiscreen-org:service:dial:1",
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "ssdp:all",
    ]
    found = {}
    for target in targets:
        msg = ("M-SEARCH * HTTP/1.1\r\nHOST: %s:%d\r\nMAN: \"ssdp:discover\"\r\n"
               "MX: 1\r\nST: %s\r\nUSER-AGENT: cleanframe-tvinfo/1\r\n\r\n"
               % (SSDP_ADDR[0], SSDP_ADDR[1], target))
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            sock.sendto(msg.encode(), (ip, SSDP_ADDR[1]))
            while True:
                data, _addr = sock.recvfrom(65507)
                text = data.decode("utf-8", "replace")
                headers = {}
                for line in text.split("\r\n")[1:]:
                    if ":" in line:
                        key, value = line.split(":", 1)
                        headers[key.strip().lower()] = value.strip()
                for key, value in headers.items():
                    if key in ("location", "st", "server", "usn") and key not in found:
                        found[key] = value
                if not headers:
                    break
            sock.close()
        except Exception:
            pass
    # The description itself: whatever LOCATION said, plus LG's usual 1900 root
    for url in [found.get("location"), "http://%s:1900/" % ip, "http://%s:1900/rootDesc.xml" % ip]:
        if not url:
            continue
        fields = _xml_fields(_http(url, timeout=3.0))
        if fields:
            found["descriptionUrl"] = url
            found["description"] = fields
            break
    return found


def airplay(ip, timeout=2.0):
    """mDNS query for _airplay._tcp.local — LG advertises model= and a version field."""
    query = bytearray(b"\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00")
    for label in ("_airplay", "_tcp", "local"):
        query.append(len(label))
        query.extend(label.encode())
    query.extend(b"\x00\x00\x0c\x00\x01")

    def read_name(data, pos):
        parts = []
        while True:
            if pos >= len(data):
                raise ValueError
            length = data[pos]
            pos += 1
            if length == 0:
                break
            if length & 0xC0:
                pos += 1
                break
            parts.append(data[pos:pos + length].decode("utf-8", "replace"))
            pos += length
        return ".".join(parts), pos

    result = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        sock.sendto(bytes(query), ("224.0.0.251", 5353))
        while True:
            data, addr = sock.recvfrom(9000)
            if addr[0] != ip:
                continue
            try:
                answers = int.from_bytes(data[6:8], "big")
                pos = 12
                for _ in range(answers):
                    _name, pos = read_name(data, pos)
                    rtype = int.from_bytes(data[pos:pos + 2], "big")
                    rdlen = int.from_bytes(data[pos + 8:pos + 10], "big")
                    rdata = data[pos + 10:pos + 10 + rdlen]
                    pos += 10 + rdlen
                    if rtype == 16:  # TXT
                        text = rdata.decode("utf-8", "replace")
                        for part in re.finditer(r"[\x20-\x7e]{2,}", text):
                            chunk = part.group(0)
                            if "=" in chunk:
                                key, value = chunk.split("=", 1)
                                result.setdefault(key.strip(), value.strip())
                    elif rtype == 1 and len(rdata) == 4:
                        result.setdefault("address", ".".join(str(b) for b in rdata))
            except Exception:
                break
            if result:
                break
        sock.close()
    except Exception:
        pass
    return result


def ssap_handshake(ip, port=3000, timeout=2.0):
    """True when the TV answers the webOS second-screen websocket handshake."""
    try:
        sock = socket.create_connection((ip, port), timeout=timeout)
        key = base64.b64encode(hashlib.sha1(str(id(sock)).encode()).digest()).decode()
        request = ("GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
                   "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
                   "Sec-WebSocket-Version: 13\r\n\r\n" % (ip, port, key))
        sock.sendall(request.encode())
        answer = sock.recv(4096).decode("utf-8", "replace")
        sock.close()
        expected = base64.b64encode(hashlib.sha1((key + SSAP_GUID).encode()).digest()).decode()
        return expected in answer
    except Exception:
        return False


def collect(ip):
    """Everything the TV tells us without root. Empty values mean 'it did not say'."""
    ssdp = ssdp_search(ip)
    desc = ssdp.get("description", {})
    mdns = airplay(ip)
    info = {
        "ip": ip,
        "modelName": desc.get("modelName") or mdns.get("model") or "",
        "modelNumber": desc.get("modelNumber") or "",
        "friendlyName": desc.get("friendlyName") or "",
        "manufacturer": desc.get("manufacturer") or "",
        "webOs": "",
        "firmware": "",
        "ssap": ssap_handshake(ip),
        "sources": [],
    }
    for key in VERSION_KEYS:
        if desc.get(key):
            info["firmware"] = desc[key]
            break
    if desc.get("webosversion"):
        info["webOs"] = desc["webosversion"]
    for value in mdns.values():
        if re.match(r"^webOS \d", value, re.I) and not info["webOs"]:
            info["webOs"] = value
    if ssdp.get("descriptionUrl"):
        info["sources"].append("ssdp:" + ssdp["descriptionUrl"])
    if mdns:
        info["sources"].append("airplay")
    if info["ssap"]:
        info["sources"].append("ssap:3000")
    info["complete"] = bool(info["modelName"] and info["firmware"])
    return info


def main(argv=None):
    parser = argparse.ArgumentParser(description="Unprivileged info about an LG webOS TV")
    parser.add_argument("ip", help="address of the TV")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    info = collect(args.ip)
    if args.json:
        print(json.dumps(info, indent=1, ensure_ascii=False))
    else:
        print("ip:        %s" % info["ip"])
        print("model:     %s" % (info["modelName"] or "unknown"))
        print("model no.: %s" % (info["modelNumber"] or "unknown"))
        print("name:      %s" % (info["friendlyName"] or "unknown"))
        print("webOS:     %s" % (info["webOs"] or "unknown"))
        print("firmware:  %s" % (info["firmware"] or "unknown"))
        print("ssap:      %s" % ("yes" if info["ssap"] else "no"))
        print("sources:   %s" % (", ".join(info["sources"]) or "none"))
        if not info["complete"]:
            print("")
            print("The TV did not tell us model and firmware over the network. Without root,")
            print("the firmware is only readable on screen (Settings > General > About) or")
            print("through a paired SSAP session, which shows a prompt on the TV.")
    return 0 if info["sources"] else 1


if __name__ == "__main__":
    sys.exit(main())
