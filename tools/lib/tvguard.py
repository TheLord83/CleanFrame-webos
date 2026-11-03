#!/usr/bin/env python3
"""tvguard — refuse to write to a television that has not been released.

Why this file exists: the lock that keeps tools away from the TV used to be a
line of prose in a skill file. Prose fails exactly when nobody reads it. This is
the same rule in code, in one place, called by every tool that changes something
on a television.

The rule
--------
* Writing tools (``install-ipk.py``, ``install-launcher.sh``, ``install-hub.sh``,
  ``install-wizard.py``) talk to loopback only. Everything else is refused with
  exit code 78 (``EX_CONFIG``), so a script can tell "blocked" from "failed".
  The bench hub on ``127.0.0.1:8484`` is the case that has to keep working.
* ``--release-ok`` carries the occasion (``--release-ok="2026-11-04 acceptance"``)
  and is per invocation on purpose: an exported variable survives in a shell for
  as long as the shell lives, and that is a failure mode nobody can see.
* Reading tools (``watch-hub.py``, ``check-egress-device.py``) may go anywhere
  and only warn — they change nothing, and forbidding them would be friction
  without a reason.

Hosts are checked by what they resolve to, not by a list: an IP list rots with
the next DHCP lease, and a name that cannot be resolved is refused rather than
trusted.

``docs/ACCEPTANCE.md`` is the sheet that belongs to a released device; the
refusal prints its head plus the finished command to repeat.
"""
import ipaddress
import os
import socket
import sys

EXIT_BLOCKED = 78  # EX_CONFIG — "refused on purpose", not "failed"
ACCEPTANCE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "docs", "ACCEPTANCE.md")
HEAD_LINES = 14


def _loopback(ip):
    return ip.is_loopback


def is_loopback(host):
    """True only when every address behind ``host`` is loopback."""
    host = (host or "").strip().strip("[]")
    if not host:
        return False
    if host in ("localhost", "localhost.localdomain", "ip6-localhost"):
        return True
    try:
        return _loopback(ipaddress.ip_address(host))
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    addresses = [str(info[4][0]) for info in infos if info[4]]
    return bool(addresses) and all(
        _loopback(ipaddress.ip_address(address.split("%")[0])) for address in addresses)


def acceptance_head(lines=HEAD_LINES):
    """The title and the intro of docs/ACCEPTANCE.md — stop before the first section.

    Nobody needs the whole sheet in every refusal; the first paragraphs say what
    the file is, and the path is printed right above.
    """
    try:
        with open(ACCEPTANCE, encoding="utf-8") as handle:
            text = handle.readlines()
    except OSError:
        return ["(docs/ACCEPTANCE.md is missing)"]
    out = []
    for line in text[:max(lines, 1) * 4]:
        if line.startswith("## "):
            break
        if line.strip():
            out.append(line.rstrip("\n"))
        if len(out) >= lines:
            break
    return out or ["(docs/ACCEPTANCE.md is empty)"]


def _say(message, stream=None):
    print(message, file=stream or sys.stdout, flush=True)


def require_release(host, tool, argv=None, release_ok=None, purpose="write to"):
    """Exit 78 unless ``host`` is loopback or ``release_ok`` was given.

    Returns the note that was printed (or ""), so callers can log it.
    """
    if is_loopback(host):
        return ""
    if release_ok:
        note = "   release-ok: %s (%s)" % (release_ok, host)
        _say(note)
        return note
    command = " ".join([tool] + list(argv or [])) or tool
    _say("")
    _say("REFUSED: this would %s %s." % (purpose, host))
    _say("The television is locked until it is released for a run. Loopback is always")
    _say("allowed (the bench hub on 127.0.0.1:8484); every other address needs the flag.")
    _say("")
    _say("What is being accepted, and how, is written in docs/ACCEPTANCE.md:")
    for line in acceptance_head():
        _say("   " + line)
    _say("")
    _say("Repeat with the occasion, e.g. --release-ok=\"2026-11-04 acceptance\":")
    _say("   %s --release-ok=\"<date> <occasion>\"" % command)
    _say("")
    _say("Exit code %d means: refused on purpose, nothing was sent." % EXIT_BLOCKED)
    sys.exit(EXIT_BLOCKED)


def warn_read(host, tool):
    """Reading tools only warn; they change nothing."""
    if is_loopback(host):
        return ""
    note = ("   note: %s reads from %s, a real device. It changes nothing; the lock in "
            "tools/lib/tvguard.py only covers writing tools." % (os.path.basename(tool), host))
    _say(note, sys.stderr)
    return note
