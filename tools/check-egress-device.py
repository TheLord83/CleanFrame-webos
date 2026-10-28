#!/usr/bin/env python3
"""Welche Verbindungen haelt der Launcher auf dem Fernseher nach draussen?

Liest ueber SSH die Verbindungstabellen und die offenen Sockets je Prozess aus,
ordnet die Sockets den Prozessen zu und meldet alles, was nicht lokal oder im
LAN bleibt. Damit sieht man, was der Launcher selbst tut, und was Glasshouse,
MQTT oder der Hub tun.

Aufruf:
    python3 tools/check-egress-device.py --tv 192.168.0.49
    python3 tools/check-egress-device.py --host localhost   # Selbsttest

Lokal (127.0.0.0/8) und im LAN (192.168.0.0/24) gilt als erlaubt; alles andere
zaehlt als Internet. Exit 1, wenn ein Prozess mit Bezug zu CleanFrame nach
draussen geht, sonst 0.
"""
import argparse
import ipaddress
import socket
import subprocess
import sys

APP_HINTS = ("node", "server.js", "cleanframe", "webapp", "wam", "luna")


def ssh(host, command, timeout=45):
    args = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10", host, command]
    out = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout).strip()[:300])
    return out.stdout


DUMP = r"""
echo "==TCP"; cat /proc/net/tcp 2>/dev/null | tail -n +2
echo "==TCP6"; cat /proc/net/tcp6 2>/dev/null | tail -n +2
echo "==PROC"
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  comm=$(cat $p/comm 2>/dev/null | tr -d '\n')
  [ -z "$comm" ] && continue
  for fd in $p/fd/*; do
    l=$(readlink $fd 2>/dev/null)
    case "$l" in
      socket:\[*) echo "$pid|$comm|${l#socket:[}" | sed 's/]$//' ;;
    esac
  done
done
echo "==END"
"""


def hex_to_ip(h):
    if len(h) == 8:
        return str(ipaddress.IPv4Address(int(h[6:8] + h[4:6] + h[2:4] + h[0:2], 16)))
    # IPv6: 4 Bloecke a 32 Bit, jede Gruppe byteweise gedreht
    parts = [h[i:i + 8] for i in range(0, 32, 8)]
    raw = b"".join(bytes.fromhex(p)[::-1] for p in parts)
    return str(ipaddress.IPv6Address(raw))


def parse_tcp(text):
    rows = []
    for line in text.strip().splitlines():
        f = line.split()
        if len(f) < 10:
            continue
        local, remote, state, inode = f[1], f[2], f[3], f[9]
        try:
            lip = hex_to_ip(local.split(":")[0])
            lport = int(local.split(":")[1], 16)
            rip = hex_to_ip(remote.split(":")[0])
            rport = int(remote.split(":")[1], 16)
        except Exception:
            continue
        rows.append({"lip": lip, "lport": lport, "rip": rip, "rport": rport,
                     "state": state, "inode": inode})
    return rows


def parse_procs(text):
    ino2proc = {}
    for line in text.strip().splitlines():
        parts = line.split("|")
        if len(parts) != 3:
            continue
        pid, comm, ino = parts
        ino2proc[ino] = (pid, comm)
    return ino2proc


def is_local(ip):
    a = ipaddress.ip_address(ip)
    return a.is_loopback or a.is_link_local or a.is_unspecified


def is_lan(ip):
    a = ipaddress.ip_address(ip)
    return a in ipaddress.ip_network("192.168.0.0/24") or a.is_private


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tv", default="192.168.0.49", help="Fernseher (SSH-Ziel)")
    ap.add_argument("--host", help="statt des Fernsehers dieses Ziel abfragen (Selbsttest)")
    ap.add_argument("--local", action="store_true",
                    help="Abfrage auf dieser Maschine ausfuehren, ohne SSH (Selbsttest des Parsers)")
    args = ap.parse_args()
    target = args.host or ("root@" + args.tv)

    try:
        if args.local:
            dump = subprocess.run(["bash", "-c", DUMP], capture_output=True, text=True,
                                  timeout=120).stdout
            target = "localhost (lokal)"
        else:
            dump = ssh(target, DUMP, timeout=90)
    except Exception as e:  # noqa: BLE001
        print("FAIL: keine Verbindung zu %s (%s)" % (target, e))
        return 2

    tcp = dump.split("==TCP6")[0].split("==TCP", 1)[1]
    tcp6 = dump.split("==TCP6")[1].split("==PROC")[0]
    procs = dump.split("==PROC")[1].split("==END")[0]
    rows = parse_tcp(tcp) + parse_tcp(tcp6)
    ino2proc = parse_procs(procs)

    print("%s: %d Sockets in der Tabelle, %d Prozess-Sockets zugeordnet"
          % (target, len(rows), len(ino2proc)))

    by_proc = {}
    for r in rows:
        if r["state"] == "0A" or r["state"] == "02":  # LISTEN, SYN_SENT
            if r["state"] == "0A":
                continue
        if is_local(r["rip"]) or r["rip"] == "0.0.0.0":
            continue
        if is_lan(r["rip"]) and not is_local(r["rip"]):
            continue
        pid, comm = ino2proc.get(r["inode"], ("?", "unbekannt"))
        key = "%s (pid %s)" % (comm, pid)
        by_proc.setdefault(key, []).append(r)

    if not by_proc:
        print("\nKeine Verbindung nach draussen.")
        print("RESULT: 0 externe Verbindungen")
        return 0

    internet = []
    seen = set()
    for key in sorted(by_proc):
        for r in by_proc[key]:
            sig = (key, r["rip"], r["rport"])
            if sig in seen:
                continue
            seen.add(sig)
            try:
                name = socket.gethostbyaddr(r["rip"])[0]
            except Exception:  # noqa: BLE001
                name = "-"
            line = "%s -> %s:%d  (%s)" % (key, r["rip"], r["rport"], name)
            print("  " + line)
            if any(h in key.lower() for h in APP_HINTS):
                internet.append(line)

    print()
    if internet:
        print("RESULT: %d Verbindung(en) mit CleanFrame-Bezug nach draussen" % len(internet))
        return 1
    print("RESULT: 0 Verbindungen mit CleanFrame-Bezug nach draussen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
