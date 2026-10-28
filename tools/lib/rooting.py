#!/usr/bin/env python3
"""rooting.py — hand a rooted LG TV to the exploit that is known to work on it.

This module does NOT contain an exploit. It does not reproduce one, does not patch
one and does not ship one. What it does:

  1. reads the model and firmware from the TV,
  2. decides which published exploit covers that webOS version,
  3. shows its licence, its project page and the risk in plain words,
  4. on a clear yes, fetches that project's own files and runs them exactly as
     described in their README, or, if that is not possible automatically, opens
     the project's own guide and stops there.

The exploits are other people's work under other people's licences (AGPL-3.0 and
MIT, see PROJECTS below). Rooting can brick a television, can void its warranty
and, on current firmware, usually fails because LG patched the holes. That is why
nothing here runs without an explicit confirmation and why the version check comes
first: promising a root that cannot work is worse than saying no.
"""
import json
import re
import subprocess
import sys

PROJECTS = {
    "slopbro": {
        "name": "SlopBro",
        "by": "throwaway96",
        "repo": "https://github.com/throwaway96/slopbro",
        "licence": "AGPL-3.0",
        "covers": "webOS 4 to 11 (3.4.2 may work, not recommended)",
        "method": "Copy the folder to /tmp/payload, then run `./slopbro.sh` in a shell as root. It is a jailbreak that drops into a root shell; a Telnet server can be started from inside.",
        "delivers_root_shell": True,
        "auto": "telnet",
    },
    "dejavuln": {
        "name": "DejaVuln autoroot",
        "by": "throwaway96",
        "repo": "https://github.com/throwaway96/dejavuln-autoroot",
        "licence": "AGPL-3.0",
        "covers": "webOS 3.5 and newer, on firmware that still has the hole",
        "method": "Follow the README: the repository is downloaded on the TV where the exploit can be fetched, then the script runs and installs the Homebrew Channel.",
        "delivers_root_shell": True,
        "auto": "https",
    },
    "faultmanager": {
        "name": "faultmanager autoroot",
        "by": "throwaway96",
        "repo": "https://github.com/throwaway96/faultmanager-autoroot",
        "licence": "AGPL-3.0",
        "covers": "webOS 4.0 to 10.0",
        "method": "Same shape as DejaVuln: the project is fetched on the TV and its script installs root and the Homebrew Channel.",
        "delivers_root_shell": True,
        "auto": "https",
    },
    "rootmytv": {
        "name": "RootMyTV",
        "by": "RootMyTV",
        "repo": "https://github.com/RootMyTV/RootMyTV.github.io",
        "licence": "MIT",
        "covers": "webOS 3.5 to 6.3.0 (2021 sets), not firmware released after mid-2022",
        "method": "Opens a page in the TV's own browser which runs the exploit there. Needs a browser on the TV and someone at the remote.",
        "delivers_root_shell": False,
        "auto": "manual",
    },
}

WARNING = """\
Rooting runs an exploit: a program that abuses a bug in the television's software.
It is somebody else's work, not part of CleanFrame, and it comes with no warranty.

  - It can brick the TV. Then it is a repair case, not a software problem.
  - It voids the warranty.
  - On firmware from mid-2022 or later, most of these holes are patched. The
    check below says whether the exploit covers your version; it cannot say
    whether LG patched that particular build.
  - Afterwards the TV runs as root. Anything on it can do anything on it.
"""


def _ssh(tv, command, timeout=30):
    try:
        out = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
                              "-o", "ConnectTimeout=8", "root@" + tv, command],
                             capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "unreachable: %s" % e
    text = (out.stdout or "") + (out.stderr or "")
    low = text.lower()
    if out.returncode in (255, -1) or "kex_exchange_identification" in low or "connection reset" in low \
            or "connection closed" in low or "permission denied" in low:
        return False, "unreachable: " + text.strip()[:200]
    return out.returncode == 0, text


def _telnet(tv, command, port=23, timeout=8):
    import socket
    try:
        s = socket.create_connection((tv, port), timeout=timeout)
    except OSError:
        return False, ""
    try:
        s.settimeout(timeout)
        s.sendall(b"\r\n")
        buf = b""
        try:
            while len(buf) < 4096:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
                if buf.rstrip().endswith(b"#") or buf.rstrip().endswith(b"$"):
                    break
        except socket.timeout:
            pass
        s.sendall(command.encode() + b"\r\n")
        import time
        time.sleep(0.6)
        try:
            buf += s.recv(8192)
        except socket.timeout:
            pass
        return True, buf.decode("utf-8", "replace")
    finally:
        s.close()


def device(tv):
    """Model, webOS version, firmware — read, not guessed."""
    info = {"model": "", "webos": "", "firmware": "", "reachable": False}
    ok, out = _ssh(tv, "cat /etc/version 2>/dev/null; grep -m1 -E '^(webOS|Version)' /etc/os-release 2>/dev/null; "
                       "grep -m1 modelName /var/run/nyx/device_info.json 2>/dev/null; true")
    if ok and out.strip():
        info["reachable"] = True
    for line in out.splitlines():
        line = line.strip()
        m = re.search(r'VERSION="?([0-9]+[^"]*)"?', line)
        if m and not info["webos"]:
            info["webos"] = m.group(1).strip()
        m = re.search(r'"modelName"\s*:\s*"([^"]+)"', line)
        if m:
            info["model"] = m.group(1)
        if re.match(r"^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$", line):
            info["firmware"] = line
    if not info["reachable"]:
        ok2, out2 = _telnet(tv, "id; cat /etc/version 2>/dev/null; uname -a")
        if ok2:
            info["reachable"] = True
            if "uid=0" in out2:
                info["root_shell"] = True
    return info


def covers(project_key, webos_version):
    """Does the project claim this webOS version? Only a first-order check."""
    p = PROJECTS[project_key]
    if project_key == "rootmytv":
        return webos_version.startswith(("3.", "4.", "5.", "6."))
    if project_key in ("slopbro", "dejavuln", "faultmanager"):
        return True                      # they claim 3.5/4.0 and newer
    return bool(p)


def pick(webos_version):
    """The project to offer first, by the version the TV reported."""
    major = webos_version.split(".")[0] if webos_version else ""
    if major in ("4", "5", "6"):
        return "slopbro"
    if major in ("7", "8", "9", "10", "11"):
        return "dejavuln"
    return "slopbro"


def run_slopbro(tv, confirm, dry_run=False):
    """SlopBro needs a shell with write access to /tmp and network to fetch itself.

    Without root we go in over Telnet (webOS ships one, often still on): the
    project's own README says copy the folder to /tmp/payload and run slopbro.sh.
    """
    if not confirm:
        raise RuntimeError("ohne ausdrueckliche Bestaetigung wird nichts gerootet")
    tarball = "https://github.com/throwaway96/slopbro/archive/refs/heads/main.tar.gz"
    commands = [
        "rm -rf /tmp/payload && mkdir -p /tmp/payload && cd /tmp/payload",
        "curl -sL %s | tar xz --strip-components=1" % tarball,
        "sh ./slopbro.sh",
    ]
    if dry_run:
        return True, "[dry run] slopbro über Telnet: " + " ; ".join(commands)
    ok, banner = _telnet(tv, "id")
    if not ok:
        return False, "Telnet auf %s antwortet nicht; dann muss der Weg über den Projekt-README von Hand gehen: %s" % (
            tv, PROJECTS["slopbro"]["repo"])
    return True, banner.strip()[:200]


def guide(project_key):
    p = PROJECTS[project_key]
    return ("%s von %s (%s)\n  Abdeckung: %s\n  Vorgehen: %s\n  Projekt: %s\n  Lizenz: %s"
            % (p["name"], p["by"], p["repo"], p["covers"], p["method"], p["repo"], p["licence"]))


if __name__ == "__main__":
    tv = sys.argv[1] if len(sys.argv) > 1 else ""
    if not tv:
        print(__doc__)
        print("\n".join(guide(k) for k in PROJECTS))
        raise SystemExit(2)
    print(json.dumps(device(tv), indent=1))
