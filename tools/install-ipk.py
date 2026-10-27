#!/usr/bin/env python3
"""Install an IPK on a rooted LG TV through Glasshouse's sideload endpoint.

Usage:
    python3 tools/install-ipk.py --tv 192.168.1.50 --ipk dist/cleanframe_all.ipk

Why not luna-send: on webOS 6.5 the shell has no working `luna-send` (no -w, and
applicationManager/listApps returns nothing with exit code 0), so the installer of
Glasshouse on port 8080 is the reliable path. It is the same path the Homebrew
Channel uses.

Exit codes: 0 installed and visible in the app list, 1 failed, 2 bad arguments.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

DEFAULT_APP_ID = "com.blackpearl.cleanframe"


def read_package(path):
    """Return the Package field from the control member inside the IPK (ar archive)."""
    data = open(path, "rb").read()
    i = 8
    import io
    import tarfile
    while i < len(data):
        header = data[i:i + 60]
        i += 60
        if header[:2] == b"\n":
            break
        name = header[:16].decode(errors="replace").strip()
        try:
            size = int(header[48:58].decode().strip() or 0)
        except ValueError:
            size = 0
        body = data[i:i + size]
        i += size + (size % 2)
        if name.startswith("control.tar"):
            archive = tarfile.open(fileobj=io.BytesIO(body))
            for member in archive.getmembers():
                if member.name.endswith("control"):
                    stream = archive.extractfile(member)
                    if stream is None:
                        continue
                    for line in stream.read().decode().splitlines():
                        if line.startswith("Package:"):
                            return line.split(":", 1)[1].strip()
    return None


class Glasshouse:
    def __init__(self, tv, timeout=120):
        self.base = "http://%s:8080" % tv
        self.timeout = timeout

    def call(self, path, payload=None, ctype="application/json", method="POST", timeout=None):
        data = None
        if payload is not None:
            data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        headers = {"Content-Type": ctype} if data is not None else {}
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
            return json.load(response)

    def installed(self, app_id):
        try:
            apps = self.call("/api/apps", method="GET").get("installed", [])
        except Exception:
            return []
        return [a for a in apps if a.get("id") == app_id]


def install(tv, ipk, app_id=None, quiet=False):
    say = (lambda *a: None) if quiet else (lambda *a: print(*a, flush=True))
    if not os.path.isfile(ipk):
        raise SystemExit("IPK not found: %s" % ipk)
    app_id = app_id or read_package(ipk)
    if not app_id:
        raise SystemExit("cannot read the app id from %s" % ipk)
    say("   package %s for %s" % (os.path.basename(ipk), app_id))

    gh = Glasshouse(tv)
    try:
        gh.call("/api/apps/install/sideload", {"enabled": True})
    except Exception as error:
        raise SystemExit("Glasshouse installer not reachable (%s) - is Glasshouse running?" % error)

    size = os.path.getsize(ipk)
    say("   uploading %d bytes" % size)
    with open(ipk, "rb") as handle:
        job = gh.call("/api/apps/install/upload", handle.read(),
                      ctype="application/octet-stream", timeout=900)
    job_id = (job.get("install") or {}).get("jobId")
    if not job.get("ok") or not job_id:
        raise SystemExit("upload rejected: %s" % json.dumps(job)[:300])

    deadline = time.time() + 300
    confirmed = False
    state = "?"
    while time.time() < deadline:
        status = gh.call("/api/apps/install/status", method="GET")
        state = status.get("state")
        if state == "awaiting-confirm" and not confirmed:
            preview = status.get("preview") or {}
            say("   confirming %s %s" % (preview.get("package"), preview.get("version")))
            gh.call("/api/apps/install/confirm", {"jobId": job_id})
            confirmed = True
        elif state in ("installed", "done"):
            break
        elif state in ("failed", "error", "cancelled"):
            raise SystemExit("install failed: %s" % json.dumps(status)[:300])
        time.sleep(3)
    else:
        raise SystemExit("timeout, last state: %s" % state)

    try:
        gh.call("/api/apps/install/sideload", {"enabled": False})
    except Exception:
        say("   note: could not switch sideload off again")

    # Right after the install Glasshouse reports the app with empty fields for a moment,
    # so wait until the catalog carries the version - otherwise the summary line says
    # "installed: com.blackpearl.cleanframe (None bytes)".
    app = None
    for _ in range(10):
        hits = [a for a in gh.installed(app_id) if a.get("version")]
        if hits:
            app = hits[0]
            break
        time.sleep(1)
    if app is None:
        raise SystemExit("install reported, but %s does not show up in /api/apps" % app_id)
    say("   installed: %s %s (%s bytes)" % (app.get("id"), app.get("version"), app.get("size")))
    return app


def main():
    parser = argparse.ArgumentParser(description="Install an IPK on a rooted LG TV via Glasshouse")
    parser.add_argument("--tv", required=True, help="IP address of the TV")
    parser.add_argument("--ipk", required=True, help="path to the IPK")
    parser.add_argument("--app-id", default=None, help="app id if it cannot be read from the IPK")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    app = install(args.tv, args.ipk, args.app_id, args.quiet)
    if not args.quiet:
        print(json.dumps({"installed": app}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
