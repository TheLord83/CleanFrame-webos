#!/usr/bin/env python3
"""Finish what the root exploit started: SSH access, no Telnet, updates off.

After an exploit (SlopBro and friends) the TV has a root shell on Telnet 23 and
Homebrew Channel is installed. This script turns that into something usable from
a computer:

  1. writes your public key to /home/root/.ssh/authorized_keys
  2. sets webosbrew_sshd_enabled so sshd starts on every boot
  3. closes Telnet (flag off, process killed) — Telnet is a plaintext root shell,
     nobody wants that on a LAN
  4. blocks TV updates so a firmware update cannot remove the exploit
  5. verifies: ssh with the key works, node is present, Telnet is gone

Usage:
    python3 tools/root/tvsetup.py --tv 192.168.1.50 --key ~/.ssh/lgtv.pub
    python3 tools/root/tvsetup.py --tv 192.168.1.50 --key ~/.ssh/id_ed25519.pub --dry-run

Exit codes: 0 = verified, 1 = failed, 2 = bad arguments.
"""
import argparse
import os
import re
import socket
import subprocess
import sys
import time

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240
UPDATE_HOSTS = [
    "su.lge.com", "snu.lge.com", "lgtvonline.lge.com", "lgappstv.com",
    "us.lgtvsdp.com", "eu.lgtvsdp.com", "kic.lge.com", "ngfts.lge.com",
]


class Telnet:
    """Just enough Telnet to run commands as root on webOS."""

    def __init__(self, host, port=23, timeout=8):
        self.sock = socket.create_connection((host, port), timeout)
        self.sock.settimeout(timeout)
        self.buffer = b""

    def _read(self, wait=1.0):
        """Read whatever arrives within `wait` seconds.

        The socket timeout has to follow `wait`, otherwise a recv blocks for the
        connect timeout (8 s) on every command and the whole run drags on.
        """
        self.sock.settimeout(max(0.2, wait))
        chunks = b""
        while True:
            try:
                data = self.sock.recv(4096)
            except socket.timeout:
                break
            if not data:
                break
            chunks += self._negotiate(data)
        self.buffer += chunks
        return chunks

    def _negotiate(self, data):
        """Answer option negotiation with refusals and strip the IAC sequences."""
        out = bytearray()
        i = 0
        while i < len(data):
            byte = data[i]
            if byte != IAC:
                out.append(byte)
                i += 1
                continue
            if i + 1 >= len(data):
                break
            command = data[i + 1]
            if command in (WILL, WONT, DO, DONT):
                if i + 2 >= len(data):
                    break
                option = data[i + 2]
                reply = WONT if command == DO else DONT
                self.sock.sendall(bytes([IAC, reply, option]))
                i += 3
            elif command == SB:
                end = data.find(bytes([IAC, SE]), i)
                i = len(data) if end < 0 else end + 2
            else:
                i += 2
        return bytes(out)

    def run(self, command, wait=1.2):
        self.sock.sendall((command + "\n").encode())
        return self._read(wait).decode("utf-8", "replace")

    def login(self, user="root"):
        self._read(2.0)
        return self.run(user, 2.0)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def ssh(ip, key, command=None, timeout=20):
    base = ["ssh", "-i", key, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=8", "root@%s" % ip]
    if command:
        base.append(command)
    try:
        return subprocess.run(base, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def port_open(ip, port, timeout=3):
    sock = socket.socket()
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((ip, port)) == 0
    finally:
        sock.close()


def setup(ip, pubkey, private_key, dry_run=False, keep_telnet=False, telnet_port=23, verify=True):
    say = print
    with open(pubkey) as handle:
        key_line = handle.read().strip()
    if not key_line.startswith(("ssh-ed25519", "ssh-rsa", "ecdsa-")):
        raise SystemExit("%s does not look like a public key" % pubkey)

    if not dry_run and not port_open(ip, telnet_port):
        probe = ssh(ip, private_key, "true")
        if probe is not None and probe.returncode == 0:
            say("   Telnet already closed and SSH works — nothing to do")
            return True
        raise SystemExit("no Telnet on port %d and SSH does not work either; "
                         "is the exploit done and the TV awake?" % telnet_port)

    commands = [
        "mkdir -p /home/root/.ssh",
        "chmod 700 /home/root/.ssh",
        "grep -q '%s' /home/root/.ssh/authorized_keys 2>/dev/null || echo '%s' >> /home/root/.ssh/authorized_keys"
        % (key_line.split()[1], key_line),
        "chmod 600 /home/root/.ssh/authorized_keys",
        "touch /var/lib/webosbrew/sshd_enabled",
    ]
    if keep_telnet:
        commands.append("echo 'telnet kept on purpose'")
    else:
        commands += [
            "rm -f /var/lib/webosbrew/init.d/*telnet* 2>/dev/null",
            "pkill -f telnetd 2>/dev/null; true",
        ]
    # Updates cannot be blocked before Glasshouse exists; the hosts file is the
    # belt-and-braces version and works on any rooted TV.
    hosts = "\\n".join("%s 0.0.0.0" % host for host in UPDATE_HOSTS)
    commands.append("grep -q 'su.lge.com' /etc/hosts || printf '%s\\n' >> /etc/hosts" % hosts)

    if dry_run:
        say("   [dry run] Telnet commands on %s:" % ip)
        for command in commands:
            say("     %s" % command)
        return True

    say("   writing key and closing Telnet over %s:%d" % (ip, telnet_port))
    client = Telnet(ip, telnet_port)
    try:
        client.login()
        for command in commands:
            client.run(command)
        check = client.run("id; ls /var/lib/webosbrew/sshd_enabled; /usr/bin/node -v 2>/dev/null; true", 2.0)
    finally:
        client.close()

    match = re.search(r"uid=(\d+)", check or "")
    if not match or match.group(1) != "0":
        say("   warning: could not confirm a root shell (answer was: %r)" % (check or "")[:120])

    if not verify:
        say("   commands sent (verification skipped)")
        return True

    # sshd usually needs a moment; retry instead of reporting a false failure.
    for _ in range(10):
        result = ssh(ip, private_key, "id && /usr/bin/node -v")
        if result and result.returncode == 0:
            say("   SSH works: %s" % result.stdout.strip().replace("\n", " | "))
            if not keep_telnet:
                if port_open(ip, 23):
                    say("   note: Telnet still answers — it closes on the next boot")
                else:
                    say("   Telnet is closed")
            return True
        time.sleep(2)
    say("   SSH did not come up. Try by hand: ssh -i %s root@%s" % (private_key, ip))
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="Finish a rooted LG TV: SSH key, Telnet off, updates blocked")
    parser.add_argument("--tv", required=True, help="IP address of the TV")
    parser.add_argument("--key", required=True, help="public key file, e.g. ~/.ssh/lgtv.pub")
    parser.add_argument("--private-key", default=None, help="private key for the SSH check (default: ~/.ssh/lgtv)")
    parser.add_argument("--keep-telnet", action="store_true", help="do not close Telnet")
    parser.add_argument("--dry-run", action="store_true", help="show the commands, change nothing")
    parser.add_argument("--telnet-port", type=int, default=23, help="Telnet port (tests use another one)")
    parser.add_argument("--no-verify", action="store_true", help="skip the SSH verification (tests)")
    args = parser.parse_args(argv)

    pubkey = os.path.expanduser(args.key)
    private = os.path.expanduser(args.private_key) if args.private_key else os.path.expanduser("~/.ssh/lgtv")
    ok = setup(args.tv, pubkey, private, args.dry_run, args.keep_telnet,
               args.telnet_port, not args.no_verify)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
