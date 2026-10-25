#!/usr/bin/env python3
"""Find LG TVs on the local network — no IP address needed.

Two independent methods, because either one alone misses cases:

1. SSDP (M-SEARCH on 239.255.255.250:1900). Fast and gives the model name,
   but only answers when the TV is awake and the responder is on the same
   layer-2 segment.
2. A port scan of the /24 for the services an LG webOS TV exposes:
   3000/3001 (SSAP), 22 (SSH, only when rooted), 23 (Telnet, only when rooted),
   8080 (Glasshouse, only when installed). Works in standby too, as long as the
   network stack answers ARP.

Usage:
    python3 tools/discover.py                # human-readable table
    python3 tools/discover.py --json         # machine-readable
    python3 tools/discover.py --subnet 192.168.0.0/24 --timeout 0.4

Exit codes: 0 = at least one candidate found, 1 = none, 2 = bad arguments.
"""
import argparse
import base64
import hashlib
import ipaddress
import os
import json
import re
import socket
import sys
import threading
import urllib.request
import xml.etree.ElementTree as ET

SSDP_ADDR = ("239.255.255.250", 1900)
SERVICE_PORTS = {3000: "ssap", 3001: "ssap-secure", 22: "ssh", 23: "telnet", 8080: "glasshouse"}


def local_subnets():
    """Return the /24 networks of this host's own interfaces."""
    nets = []
    try:
        for addr in socket.gethostbyname_ex(socket.gethostname())[2]:
            if addr and not addr.startswith("127."):
                nets.append(str(ipaddress.ip_network(addr + "/24", strict=False)))
    except OSError:
        pass
    # No usable name resolution: ask the routing table the cheap way
    if not nets:
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("192.0.2.1", 9))
            addr = probe.getsockname()[0]
            probe.close()
            if not addr.startswith("127."):
                nets.append(str(ipaddress.ip_network(addr + "/24", strict=False)))
        except OSError:
            pass
    return sorted(set(nets))


def ssdp_search(timeout=3.0):
    """M-SEARCH for LG second-screen devices and anything else that answers."""
    found = {}
    targets = [
        "urn:lge-com:service:webos-second-screen:1",
        "ssdp:all",
    ]
    for target in targets:
        message = (
            "M-SEARCH * HTTP/1.1\r\n"
            "HOST: 239.255.255.250:1900\r\n"
            'MAN: "ssdp:discover"\r\n'
            "MX: 2\r\n"
            "ST: %s\r\n\r\n" % target
        )
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.settimeout(0.8)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        try:
            sock.sendto(message.encode(), SSDP_ADDR)
            while True:
                try:
                    data, addr = sock.recvfrom(4096)
                except socket.timeout:
                    break
                text = data.decode("utf-8", "replace")
                location = ""
                server = ""
                for line in text.split("\r\n"):
                    if line.lower().startswith("location:"):
                        location = line.split(":", 1)[1].strip()
                    elif line.lower().startswith("server:"):
                        server = line.split(":", 1)[1].strip()
                entry = found.setdefault(addr[0], {"ip": addr[0], "ssdp": True})
                if location:
                    entry["location"] = location
                if server:
                    entry["server"] = server
        finally:
            sock.close()
    return found


def describe(location, timeout=3.0):
    """Read the UPnP/SSAP description behind an SSDP location."""
    info = {}
    try:
        with urllib.request.urlopen(location, timeout=timeout) as response:
            body = response.read(65536)
    except Exception:
        return info
    text = body.decode("utf-8", "replace")
    for key, tag in (("name", "friendlyName"), ("model", "modelName"),
                     ("modelNumber", "modelNumber"), ("manufacturer", "manufacturer")):
        match = re.search(r"<%s>([^<]+)</%s>" % (tag, tag), text)
        if match:
            info[key] = match.group(1).strip()
    return info



def http_json(ip, port, path, timeout=3.0):
    """Return parsed JSON from http://ip:port/path, or None."""
    try:
        with urllib.request.urlopen("http://%s:%d%s" % (ip, port, path), timeout=timeout) as response:
            return json.load(response)
    except Exception:
        return None


def looks_like_glasshouse(ip, timeout=3.0):
    """Glasshouse identifies itself: /api/apps returns {"installed": [...], ...}."""
    data = http_json(ip, 8080, "/api/apps", timeout)
    return bool(data) and isinstance(data.get("installed"), list)


def looks_like_ssap(ip, timeout=3.0):
    """A webOS TV answers the SSAP websocket on 3000 with a hello frame.

    A plain HTTP service on 3000 (there are a few) fails the websocket
    handshake, so this separates a TV from "something listens on 3000".
    """
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        "GET / HTTP/1.1\r\n"
        "Host: %s:3000\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n" % (ip, key)
    )
    sock = socket.socket()
    sock.settimeout(timeout)
    try:
        sock.connect((ip, 3000))
        sock.sendall(request.encode())
        head = sock.recv(4096)
    except OSError:
        return False
    finally:
        sock.close()
    if b"101" not in head.split(b"\r\n")[0]:
        return False
    # Only a real websocket server answers with the right accept hash for our
    # key: that excludes plain HTTP services that merely listen on 3000.
    expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                                            .encode("ascii")).digest()).decode()
    for line in head.decode("latin-1").split("\r\n")[1:]:
        if line.lower().startswith("sec-websocket-accept:"):
            return line.split(":", 1)[1].strip() == expected
    return False


def port_open(ip, port, timeout):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((ip, port)) == 0
    finally:
        sock.close()


def scan(subnet, timeout=0.3):
    """Port scan one /24 for LG services, threaded so a /24 takes a few seconds."""
    hosts = {}
    lock = threading.Lock()
    network = ipaddress.ip_network(subnet, strict=False)

    def worker(ip):
        open_ports = {}
        for port, name in SERVICE_PORTS.items():
            if port_open(str(ip), port, timeout):
                open_ports[port] = name
        if not open_ports:
            return
        # Only report hosts that look like a webOS TV: SSAP, or a rooted TV with
        # SSH/Telnet plus something TV-ish on 8080.
        # Candidate rule: the SSAP port pair, or a Glasshouse answer on 8080.
        ssap_pair = 3000 in open_ports and 3001 in open_ports and looks_like_ssap(str(ip))
        glass = 8080 in open_ports and looks_like_glasshouse(str(ip))
        if ssap_pair or glass:
            with lock:
                hosts[str(ip)] = {"ip": str(ip), "ports": open_ports}

    threads = []
    for ip in network.hosts():
        thread = threading.Thread(target=worker, args=(ip,), daemon=True)
        thread.start()
        threads.append(thread)
        if len(threads) >= 64:
            for running in threads:
                running.join()
            threads = []
    for running in threads:
        running.join()
    return hosts


def find(subnet=None, timeout=0.3, want_ssdp=True):
    """Return {"hosts": [...], "rejected": [...]}.

    A device is only a host when an LG webOS TV actually answers: either the SSAP
    websocket handshake on 3000/3001 succeeds or Glasshouse answers on 8080. Everything
    else that merely shows up in SSDP (routers, repeaters, Fire TV sticks, printers) is
    reported as rejected, so the caller never talks to the wrong box.
    """
    hosts = {}
    for ip, entry in (ssdp_search() if want_ssdp else {}).items():
        hosts[ip] = dict(entry)
    for net in ([subnet] if subnet else local_subnets()):
        for ip, entry in scan(net, timeout).items():
            target = hosts.setdefault(ip, {"ip": ip})
            target.setdefault("ports", {}).update(entry.get("ports", {}))
    verified, rejected = [], []
    for entry in hosts.values():
        ports = entry.setdefault("ports", {})
        if not ports:
            for port, name in SERVICE_PORTS.items():
                if port_open(entry["ip"], port, timeout):
                    ports[port] = name
        entry["ports"] = {str(k): v for k, v in sorted(ports.items())}
        entry["rooted"] = 22 in ports or 23 in ports
        entry["glasshouse"] = 8080 in ports
        ok = looks_like_ssap(entry["ip"], timeout)
        if not ok and entry["glasshouse"]:
            ok = looks_like_glasshouse(entry["ip"], timeout)
        if ok:
            if entry.get("location"):
                entry.update({k: v for k, v in describe(entry["location"]).items() if v})
            verified.append(entry)
        else:
            if entry.get("location"):
                entry.update({k: v for k, v in describe(entry["location"]).items() if v})
            entry["reason"] = "no SSAP handshake and no Glasshouse"
            rejected.append(entry)
    verified.sort(key=lambda x: ipaddress.ip_address(x["ip"]))
    rejected.sort(key=lambda x: ipaddress.ip_address(x["ip"]))
    return {"hosts": verified, "rejected": rejected}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Find LG webOS TVs on the local network")
    parser.add_argument("--subnet", default=None, help="scan this network instead of the local /24")
    parser.add_argument("--timeout", type=float, default=0.3, help="per-port connect timeout in seconds")
    parser.add_argument("--no-ssdp", action="store_true", help="skip the SSDP search")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = parser.parse_args(argv)

    result = find(args.subnet, args.timeout, not args.no_ssdp)
    hosts, rejected = result["hosts"], result["rejected"]
    if args.json:
        print(json.dumps({"found": len(hosts), "hosts": hosts, "rejected": rejected}, indent=1))
    else:
        if not hosts:
            print("No LG TV found. Is it on the same network and awake?")
        if rejected:
            print("%d other device(s) answered but are not TVs:" % len(rejected))
            for host in rejected:
                print("  %-15s %s" % (host["ip"], host.get("name") or host.get("model") or "?"))
        for host in hosts:
            services = ", ".join("%s(%s)" % (port, name) for port, name in host["ports"].items())
            print("%-15s %-28s %-10s %s" % (
                host["ip"],
                host.get("name") or host.get("model") or "?",
                host.get("modelNumber") or host.get("model") or "-",
                services or "no services"))
            print("%-15s rooted: %s   glasshouse: %s" % (
                "", "yes" if host.get("rooted") else "no",
                "yes" if host.get("glasshouse") else "no"))
    return 0 if hosts else 1


if __name__ == "__main__":
    sys.exit(main())
