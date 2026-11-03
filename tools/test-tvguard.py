#!/usr/bin/env python3
"""Does the lock keep writing tools away from an unreleased television?

Checks the rule itself, not a copy of it: tools/lib/tvguard.py is called the way
the install tools call it, and the shell half (tools/lib/tvguard.sh) is run as a
real script. No network, no device — the LAN addresses used here are not dialled,
the guard refuses before anything is sent.

    python3 tools/test-tvguard.py

Exit codes: 0 all good, 1 a case behaved differently.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "lib"))

import tvguard  # noqa: E402

results = []


def check(ok, name, note=""):
    results.append((ok, name))
    print(("  ok    " if ok else "  FEHL  ") + name + ("  " + note if note else ""))


def refusal(host, release_ok="", argv=None):
    """Run the guard in a child so its exit code and text can be inspected."""
    code = (
        "import sys; sys.path.insert(0, %r); import tvguard;"
        "tvguard.require_release(%r, 'tools/install-ipk.py', %r, %r)"
        % (os.path.join(HERE, "lib"), host, argv or [], release_ok)
    )
    return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)


def shell_refusal(host, release_ok=""):
    script = (
        'set -u; . "%s/lib/tvguard.sh"; '
        'tvguard_require "%s" "./tools/install-hub.sh --tv %s" "%s"; echo ALLOWED'
        % (HERE, host, host, release_ok)
    )
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


# ---- what counts as loopback -------------------------------------------------
check(tvguard.is_loopback("127.0.0.1"), "127.0.0.1 is loopback")
check(tvguard.is_loopback("::1"), "::1 is loopback")
check(tvguard.is_loopback("localhost"), "localhost is loopback")
check(not tvguard.is_loopback("192.168.0.49"), "a LAN address is not loopback")
check(not tvguard.is_loopback(""), "an empty address is not loopback")
check(not tvguard.is_loopback("no-such-host.invalid"), "an unresolvable name is refused, not trusted")

# ---- python half: the writing tools ------------------------------------------
loop = refusal("127.0.0.1", argv=["--tv", "127.0.0.1"])
check(loop.returncode == 0, "loopback goes through", "exit=%d" % loop.returncode)

lan = refusal("192.168.0.49", argv=["--tv", "192.168.0.49"])
check(lan.returncode == tvguard.EXIT_BLOCKED, "the TV is refused",
      "exit=%d (expected %d)" % (lan.returncode, tvguard.EXIT_BLOCKED))
check("REFUSED" in lan.stdout, "the refusal says REFUSED")
check("docs/ACCEPTANCE.md" in lan.stdout, "the refusal points at docs/ACCEPTANCE.md")
check("Acceptance" in lan.stdout, "the refusal prints the acceptance header")
check("--release-ok=" in lan.stdout, "the refusal prints the command to repeat")
check("192.168.0.49" in lan.stdout, "the refusal names the target")

released = refusal("192.168.0.49", release_ok="2026-11-04 acceptance",
                   argv=["--tv", "192.168.0.49"])
check(released.returncode == 0, "with --release-ok it goes through", "exit=%d" % released.returncode)
check("release-ok: 2026-11-04 acceptance" in released.stdout, "the occasion is echoed into the log")

# ---- shell half: the install scripts -----------------------------------------
sh_ok = shell_refusal("127.0.0.1")
check(sh_ok.returncode == 0 and "ALLOWED" in sh_ok.stdout, "shell: loopback goes through",
      "exit=%d" % sh_ok.returncode)

sh_block = shell_refusal("192.168.0.49")
check(sh_block.returncode == tvguard.EXIT_BLOCKED, "shell: the TV is refused",
      "exit=%d (expected %d)" % (sh_block.returncode, tvguard.EXIT_BLOCKED))
check("REFUSED" in sh_block.stderr, "shell: the refusal says REFUSED")
check("--release-ok=" in sh_block.stderr, "shell: the refusal prints the command to repeat")

sh_released = shell_refusal("192.168.0.49", release_ok="2026-11-04 acceptance")
check(sh_released.returncode == 0 and "ALLOWED" in sh_released.stdout,
      "shell: with --release-ok it goes through", "exit=%d" % sh_released.returncode)

# ---- reading tools only warn -------------------------------------------------
warn = subprocess.run(
    [sys.executable, "-c",
     "import sys; sys.path.insert(0, %r); import tvguard;"
     "tvguard.warn_read('192.168.0.49', 'watch-hub.py'); print('CONTINUED')"
     % os.path.join(HERE, "lib")],
    capture_output=True, text=True)
check(warn.returncode == 0 and "CONTINUED" in warn.stdout, "reading tools are not blocked")
check("note:" in warn.stderr, "reading tools still say they talk to a real device")

# ---- every writing tool actually calls the guard ------------------------------
FORBIDDEN = [("tools/install-ipk.py", "require_release"),
             ("tools/install-wizard.py", "require_release"),
             ("tools/install-launcher.sh", "tvguard_require"),
             ("tools/install-hub.sh", "tvguard_require")]
for path, needle in FORBIDDEN:
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    check(needle in text, "%s calls the guard" % path)

bad = [name for ok, name in results if not ok]
print("\nRESULT %d/%d" % (len(results) - len(bad), len(results)))
sys.exit(0 if not bad else 1)
