#!/usr/bin/env python3
"""Does the rooting helper really refuse a patched firmware?

The firmware is the one thing an unrooted TV will not hand out over the network, so the
installer asks for it (or takes --firmware). This test feeds both cases straight in and
compares what happens — no TV, no fake server, no rooting:

* 03.99.99 is above the SlopBro ceiling for platform kisscurl (NANO77/W21A) → the installer
  must stop with the "patched" message and never reach the root stage
* 03.51.16 is below it → the gate opens, the root stage is reached and the verdict says yes

    python3 tools/test-install-gate.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def run(model, firmware):
    env = dict(os.environ)
    env.update({"CF_FIRMWARE": firmware, "CF_SLOPBRO": "/nonexistent-slopbro"})
    return subprocess.run(
        ["bash", os.path.join(HERE, "root", "root-it.sh"), "--tv", "127.0.0.1", "--dry-run",
         "--model", model, "--firmware", firmware],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=180,
    )


def out(result):
    """Everything the run said. Errors go to stderr, verdicts to stdout."""
    return result.stdout + result.stderr


def main():
    checks = []

    def check(name, condition, detail=""):
        checks.append((name, bool(condition), detail))

    patched = run("43NANO779PA", "03.99.99")
    check("patched firmware is refused", patched.returncode == 1, "rc=%s" % patched.returncode)
    check("the refusal says why", "patched" in out(patched).lower(), out(patched)[-400:])
    check("refusal names the ceiling", "03.53.45" in out(patched), out(patched)[-400:])
    check("refusal prints the cani link", "cani.rootmy.tv/?q=" in out(patched),
          out(patched)[-400:])
    check("no root stage after the refusal", "Rooting (SlopBro)" not in out(patched),
          out(patched)[-400:])

    good = run("43NANO779PA", "03.51.16")
    check("vulnerable firmware passes the gate", "verdict:   yes" in good.stdout,
          good.stdout[-400:])
    check("root stage is reached", "Rooting (SlopBro)" in good.stdout, good.stdout[-400:])
    check("no refusal on a vulnerable TV", "not rooting" not in good.stdout, good.stdout[-400:])

    for name, ok, detail in checks:
        print(("  ok    " if ok else "  FAIL  ") + name)
        if not ok and detail:
            print("        " + detail.replace("\n", "\n        "))
    passed = sum(1 for _n, ok, _d in checks if ok)
    print("RESULT %d/%d" % (passed, len(checks)))
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
