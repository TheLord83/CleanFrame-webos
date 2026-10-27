#!/usr/bin/env python3
"""Wake an LG TV with a Wake-on-LAN magic packet.

Why this exists: after deep standby the TV stops answering ping, SSAP and SSH, so the
installer cannot find it. A magic packet brings it back in about ten seconds — provided the
TV setting "Turn on with mobile device" (TV mit Mobilgerät einschalten) is on and the network
stack keeps listening.

    python3 tools/wake-tv.py                          # broadcast to 255.255.255.255
    python3 tools/wake-tv.py 192.168.1.50             # and unicast to the TV
    python3 tools/wake-tv.py 192.168.1.50 --mac 00:00:00:00:00:00 --wait 20

Without --mac the packet is sent to the broadcast address with the two MACs Stefan's
43NANO779PA answers on (wired and wireless); the interesting one is the wired MAC from the
TV menu. Exit code 0 = at least one packet went out, 1 = nothing could be sent.
"""
import argparse
import socket
import sys
import time


def magic(mac):
    raw = bytes(int(part, 16) for part in mac.replace("-", ":").split(":"))
    if len(raw) != 6:
        raise ValueError("not a MAC address: %s" % mac)
    return b"\xff" * 6 + raw * 16


def send(mac, dest, ports=(9, 7)):
    packet = magic(mac)
    sent = 0
    for port in ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(packet, (dest, port))
            sock.close()
            sent += 1
        except OSError:
            pass
    return sent


def main(argv=None):
    parser = argparse.ArgumentParser(description="Wake an LG TV (Wake-on-LAN)")
    parser.add_argument("ip", nargs="?", default="", help="address of the TV (optional)")
    parser.add_argument("--mac", action="append", default=[],
                        help="MAC address, can be given twice (default: the two of our TV)")
    parser.add_argument("--wait", type=int, default=0,
                        help="seconds to wait afterwards, then report whether port 22 answers")
    args = parser.parse_args(argv)

    macs = args.mac or ["00:00:00:00:00:00", "00:00:00:00:00:00"]
    dests = ["255.255.255.255"]
    if args.ip:
        dests.append(args.ip)

    sent = 0
    for mac in macs:
        for dest in dests:
            sent += send(mac, dest)
    print("magic packets sent: %d (%s -> %s)" % (sent, ", ".join(macs), ", ".join(dests)))
    if not sent:
        return 1

    if args.wait and args.ip:
        for remaining in range(args.wait, 0, -1):
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            probe.settimeout(2)
            if probe.connect_ex((args.ip, 22)) == 0:
                print("TV answers on port 22 after %d s" % (args.wait - remaining))
                probe.close()
                return 0
            probe.close()
            time.sleep(1)
        print("no answer on port 22 after %d s" % args.wait)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
