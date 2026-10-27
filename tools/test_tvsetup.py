#!/usr/bin/env python3
"""Test the post-exploit setup against a fake TV — no device needed.

tvsetup.py talks to a root shell over Telnet. That is exactly the part nobody
wants to debug on a real television, so this test stands up a fake Telnet
"TV" in-process, runs tvsetup against it and checks what was actually sent:

  1. the public key is written to authorized_keys
  2. the rule is idempotent — a second run does not duplicate the key line
  3. sshd persistence flag and update hosts are set
  4. Telnet gets closed (flag removed, telnetd killed) unless --keep-telnet
  5. the login prompt is answered, i.e. the negotiation actually works

Prints `RESULT <passed>/<total>` as its last line.

Usage: python3 tools/test_tvsetup.py [-v]
"""
import os
import socket
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
TVSETUP = os.path.join(HERE, "root", "tvsetup.py")
PORT = 12323
KEY_LINE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYONLYNOTAREALKEY test@harness"


class FakeTv(threading.Thread):
    """A Telnet listener that records commands and answers like webOS does."""

    def __init__(self, port):
        super().__init__(daemon=True)
        self.port = port
        self.received = []
        self.ready = threading.Event()
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", port))
        self.server.listen(5)
        self.server.settimeout(10)
        self.authorized_keys = []
        self.sshd_flag = False
        self.hosts_blocked = False
        self.telnetd_running = True
        self.stopped = threading.Event()
        self.files = {}

    def run(self):
        """Accept repeatedly: tvsetup probes the port once before it connects."""
        self.ready.set()
        while not self.stopped.is_set():
            try:
                connection, _ = self.server.accept()
            except (socket.timeout, OSError):
                return
            threading.Thread(target=self.handle, args=(connection,), daemon=True).start()

    def handle(self, connection):
        connection.settimeout(10)
        try:
            connection.sendall(b"root@tv login: ")
            buffered = b""
            while True:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                buffered += chunk
                while b"\n" in buffered:
                    line, buffered = buffered.split(b"\n", 1)
                    command = line.decode(errors="replace").strip()
                    if command:
                        self.received.append(command)
                        connection.sendall(self.execute(command).encode())
        except (socket.timeout, OSError):
            pass
        finally:
            connection.close()

    def execute(self, command):
        """Emulate a shell: `grep -q X file || echo Y >> file` must be honest."""
        if command == "root":
            return "\r\n"
        if "authorized_keys" in command and "echo" in command:
            wanted = command.split("'")[1]
            present = any(wanted in key for key in self.authorized_keys)
            if command.startswith("grep -q") and not present and "||" in command:
                # the || branch runs: append the key once
                after = command.split("||", 1)[1]
                key = after.split("'")[1]
                self.authorized_keys.append(key)
                return ""
            if command.startswith("echo"):
                self.authorized_keys.append(command.split("echo ")[1].split(" >>")[0].strip("'"))
            return ""
        if "authorized_keys" in command:
            # chmod and friends: nothing to record
            return ""
        if "su.lge.com" in command:
            if self.hosts_blocked:
                return ""
            self.hosts_blocked = True
            return ""
        if command.startswith("touch") and "sshd_enabled" in command:
            self.sshd_flag = True
            return ""
        if "pkill" in command:
            self.telnetd_running = False
            return ""
        if "id;" in command:
            return "uid=0(root) gid=0(root)\r\n"
        return ""


def run_tvsetup(port, pubkey, extra=None):
    command = [sys.executable, TVSETUP, "--tv", "127.0.0.1", "--key", pubkey,
               "--telnet-port", str(port), "--no-verify"] + (extra or [])
    return subprocess.run(command, capture_output=True, text=True, timeout=60)


def main(argv=None):
    verbose = "-v" in (argv or sys.argv[1:])
    results, failed = [], []

    def check(name, condition, detail=""):
        results.append(name)
        if condition:
            print("  ok    %s  [%s]" % (name, detail))
        else:
            failed.append(name)
            print("  FAIL  %s  [%s]" % (name, detail))

    with tempfile.TemporaryDirectory() as folder:
        pubkey = os.path.join(folder, "test.pub")
        with open(pubkey, "w") as handle:
            handle.write(KEY_LINE + "\n")

        # ---- first run: Telnet open, nothing set up yet
        tv = FakeTv(PORT)
        tv.start()
        tv.ready.wait(5)
        first = run_tvsetup(PORT, pubkey)
        tv.join(15)
        output = first.stdout + first.stderr
        if verbose:
            print("--- output of run 1 ---\n%s" % output)

        check("tvsetup exits 0 on a reachable shell", first.returncode == 0, "rc=%d" % first.returncode)
        check("login prompt answered", "root" in tv.received, "%d commands" % len(tv.received))
        check("public key written", any(KEY_LINE in key for key in tv.authorized_keys), "%d key(s)" % len(tv.authorized_keys))
        check("sshd persistence flag set", tv.sshd_flag)
        check("update hosts blocked", tv.hosts_blocked)
        check("Telnet closed (telnetd killed)", not tv.telnetd_running)

        # ---- second run: key must not be duplicated
        tv2 = FakeTv(PORT + 1)
        tv2.start()
        tv2.ready.wait(5)
        tv2.authorized_keys = list(tv.authorized_keys)
        second = run_tvsetup(PORT + 1, pubkey)
        tv2.join(15)
        appended = [command for command in tv2.received if command.startswith("echo") and "authorized_keys" in command]
        check("second run exits 0", second.returncode == 0, "rc=%d" % second.returncode)
        check("no duplicate key line on a second run", len(tv2.authorized_keys) == len(tv.authorized_keys),
              "%d -> %d" % (len(tv.authorized_keys), len(tv2.authorized_keys)))

        # ---- keep-telnet must not kill telnetd
        tv3 = FakeTv(PORT + 2)
        tv3.start()
        tv3.ready.wait(5)
        third = run_tvsetup(PORT + 2, pubkey, ["--keep-telnet"])
        tv3.join(15)
        check("--keep-telnet leaves telnetd alone", tv3.telnetd_running,
              "rc=%d" % third.returncode)

        # ---- unreachable device must fail loudly, not silently
        closed = run_tvsetup(PORT + 9, pubkey)
        check("unreachable TV fails with a message", closed.returncode != 0 and "no Telnet" in (closed.stderr + closed.stdout),
              "rc=%d" % closed.returncode)

    total = len(results)
    passed = total - len(failed)
    print("")
    print("%d/%d tvsetup checks passed" % (passed, total))
    print("RESULT %d/%d" % (passed, total))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
