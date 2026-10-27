#!/usr/bin/env python3
"""check-ipk-hub.py — does the package really carry the hub?

The bundled hub is the whole reason a Channel install has a settings page, and it
is easy to lose: one forgotten `--hub` on the build line and the app starts a
server that is not there. This builds a package into a temporary file and looks
inside it.

Usage: python3 tools/check-ipk-hub.py
"""
import gzip
import io
import os
import subprocess
import sys
import tarfile
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# What the app's start command needs, and nothing else is worth asserting.
REQUIRED = [
    "usr/palm/applications/com.blackpearl.cleanframe/hub/server.js",
    "usr/palm/applications/com.blackpearl.cleanframe/hub/lib/ha.js",
    "usr/palm/applications/com.blackpearl.cleanframe/hub/assets/index.html",
    "usr/palm/applications/com.blackpearl.cleanframe/hubboot.js",
]

FORBIDDEN = ("__pycache__", ".pyc", "icons-preview.html", "NOTES-")


def members(ipk_path):
    data = open(ipk_path, "rb").read()
    pos, out = 8, {}
    while pos + 60 <= len(data):
        header = data[pos:pos + 60]
        name = header[:16].decode().strip()
        size = int(header[48:58].decode().strip() or 0)
        out[name] = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)
    tar = tarfile.open(fileobj=io.BytesIO(gzip.decompress(out["data.tar.gz"])))
    return tar.getnames()


def main():
    checks, failures = 0, []
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "check.ipk")
        build = subprocess.run(
            [sys.executable, os.path.join(ROOT, "tools", "build-ipk.py"),
             os.path.join(ROOT, "app"), target, "--hub", os.path.join(ROOT, "web")],
            capture_output=True, text=True)
        checks += 1
        if build.returncode != 0:
            failures.append("build failed: " + (build.stderr or build.stdout).strip()[-300:])
        else:
            names = members(target)
            checks += 1
            if "Hub:" not in build.stdout:
                failures.append("the build did not report packaging the hub")
            for want in REQUIRED:
                checks += 1
                if want not in names:
                    failures.append("missing in package: " + want)
            checks += 1
            bad = [n for n in names if any(f in n for f in FORBIDDEN)]
            if bad:
                failures.append("development leftovers in package: " + ", ".join(bad[:3]))

    if failures:
        for f in failures:
            print("  FAIL " + f)
        print("RESULT %d/%d" % (checks - len(failures), checks))
        return 1
    print("RESULT %d/%d" % (checks, checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
