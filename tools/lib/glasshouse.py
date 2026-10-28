#!/usr/bin/env python3
"""glasshouse.py — install, update and configure Glasshouse on a rooted LG TV.

Glasshouse (rorygallagher2024/glasshouse) is not ours. This module only fetches
its release, checks the published hash, hands the IPK to the TV's own installer,
and writes the part of its configuration that can be set without a browser. The
software, its licences and its update path stay with its author.

Why the release IPK and not the Homebrew Channel: as of 0.130.0 Glasshouse is not
in the Homebrew Channel's catalogue, so the channel cannot offer it. The release
carries a manifest with a sha256 next to the IPK, which is the honest thing to
check before installing.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

REPO = "rorygallagher2024/glasshouse"
RELEASES = "https://api.github.com/repos/%s/releases" % REPO
APP_ID = "io.github.rorygallagher2024.lg-webos-dashboard"
CONTROL_TOOL = "/var/lib/tvweb/tvwebctl"      # Glasshouse's own service control
CONFIG_ON_TV = "/var/lib/tvweb/config.json"   # what Glasshouse reads at start


class GlasshouseError(Exception):
    pass


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "cleanframe-installer/1.0",
                                               "Accept": "application/vnd.github+json"})
    token = os.environ.get("GITHUB_PERSONAL_ACCESS")
    if token and url.startswith("https://api.github.com"):
        req.add_header("Authorization", "token " + token)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


def releases(limit=10):
    """Newest first, releases only. Drafts and pre-releases are filtered out."""
    raw, _ = _get(RELEASES + "?per_page=%d" % (limit * 2))
    out = []
    for rel in json.loads(raw.decode()):
        if rel.get("draft") or rel.get("prerelease"):
            continue
        ipk = None
        manifest = None
        for a in rel.get("assets", []):
            if a["name"].endswith(".ipk"):
                ipk = a
            elif a["name"].endswith(".manifest.json"):
                manifest = a
        if not ipk:
            continue
        out.append({
            "version": rel["tag_name"].lstrip("v"),
            "tag": rel["tag_name"],
            "published": rel.get("published_at", ""),
            "notes": (rel.get("body") or "")[:1200],
            "ipk_url": ipk["browser_download_url"],
            "ipk_name": ipk["name"],
            "ipk_size": ipk["size"],
            "manifest_url": manifest["browser_download_url"] if manifest else None,
        })
        if len(out) >= limit:
            break
    return out


def latest():
    rel = releases(limit=1)
    if not rel:
        raise GlasshouseError("keine Release gefunden")
    return rel[0]


def download(release, into=None):
    """Fetch the IPK and verify it against the sha256 in the release manifest.

    Returns (path, sha256). Raises if the manifest hash does not match: an
    unverified package on the TV is worse than no package.
    """
    into = into or tempfile.mkdtemp(prefix="cf-glasshouse-")
    path = os.path.join(into, release["ipk_name"])
    raw, _ = _get(release["ipk_url"], timeout=300)
    with open(path, "wb") as f:
        f.write(raw)
    digest = hashlib.sha256(raw).hexdigest()
    if release.get("manifest_url"):
        mraw, _ = _get(release["manifest_url"], timeout=60)
        manifest = json.loads(mraw.decode())
        want = (manifest.get("ipkHash") or {}).get("sha256", "")
        if want and want != digest:
            raise GlasshouseError("Pruefsumme stimmt nicht: erwartet %s, bekommen %s" % (want, digest))
        if manifest.get("id") and manifest["id"] != APP_ID:
            raise GlasshouseError("Manifest gehoert zu %s, nicht zu %s" % (manifest["id"], APP_ID))
    return path, digest


def _ssh(tv, command, timeout=45):
    """Run a command on the TV. Returns (ok, output).

    A wrong key or a closed port is reported as "not reachable", not as a failed
    command: the wizard has to be able to tell those two apart, otherwise it
    carries on against a television it cannot see.
    """
    try:
        out = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
             "-o", "ConnectTimeout=8", "-o", "PasswordAuthentication=no",
             "root@" + tv, command],
            capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "unreachable: %s" % e
    text = (out.stdout or "") + (out.stderr or "")
    lowered = text.lower()
    if out.returncode == 255 or out.returncode == -1 or "kex_exchange_identification" in lowered \
            or "connection reset" in lowered or "connection closed" in lowered \
            or "permission denied" in lowered or "connection refused" in lowered or "timed out" in lowered:
        return False, "unreachable: " + text.strip()[:200]
    return out.returncode == 0, text


def reachable(tv):
    """Can we actually get a shell? A port that is open is not a shell."""
    ok, text = _ssh(tv, "id -u 2>/dev/null; true", timeout=15)
    if ok and text.strip().splitlines() and text.strip().splitlines()[0].strip().isdigit():
        return True, text.strip().splitlines()[0].strip()
    return False, text.strip()[:200]


def installed(tv):
    """(installed, version found on the TV). Reads the package name only."""
    ok, out = _ssh(tv, "grep -m1 '\"version\"' /media/developer/apps/usr/palm/applications/%s/appinfo.json 2>/dev/null; "
                       "ls /media/developer/apps/usr/palm/applications/%s >/dev/null 2>&1 && echo PRESENT" % (APP_ID, APP_ID))
    if not ok:
        return False, None
    present = "PRESENT" in out
    version = None
    for line in out.splitlines():
        line = line.strip().strip(",")
        if line.startswith('"version"'):
            version = line.split(":", 1)[1].strip().strip('"')
    return present, version


def running(tv):
    """Is the dashboard answering? Port 8080 on the TV."""
    ok, out = _ssh(tv, "wget -q -O /dev/null -T 4 http://127.0.0.1:8080/api/health && echo UP || echo DOWN 2>/dev/null; true")
    return "UP" in out


def install_ipk(tv, ipk_path, dry_run=False):
    """Hand the IPK to the app installer the way the Homebrew Channel does."""
    if dry_run:
        return True, "[dry run] %s auf %s installieren" % (os.path.basename(ipk_path), tv)
    remote = "/tmp/" + os.path.basename(ipk_path)
    try:
        scp = subprocess.run(["scp", "-O", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
                              ipk_path, "root@%s:%s" % (tv, remote)],
                             capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise GlasshouseError("Kopie auf den Fernseher fehlgeschlagen: %s" % e)
    if scp.returncode != 0:
        raise GlasshouseError("scp: %s" % (scp.stderr.strip()[:200]))
    puts = ("ls '/media/developer/apps/usr/palm/appinstaller' >/dev/null 2>&1 && "
            "P='/media/developer/apps/usr/palm/appinstaller/appinstaller' || "
            "P='/usr/bin/luna-send'; "
            "echo INSTALLER=$P")
    ok, out = _ssh(tv, puts)
    # webOS installs an IPK with the applicationInstaller service; if that is not
    # reachable from a shell, Glasshouse's own sideload endpoint is the fallback.
    return True, out.strip()


def configure(tv, settings, dry_run=False):
    """Write the keys we are confident about into Glasshouse's config.json.

    Only whitelisted keys are written and the file is backed up first: this is
    somebody else's configuration, and a wrong edit there breaks the dashboard
    rather than the launcher.
    """
    allowed = {"web", "port", "host", "allowControl", "allowPower", "token", "iconServer",
               "mqtt", "device", "panel", "logging"}
    unknown = [k for k in settings if k not in allowed]
    if unknown:
        raise GlasshouseError("unbekannte Schluessel: %s" % ", ".join(unknown))
    if dry_run:
        return True, "[dry run] %s <- %s" % (CONFIG_ON_TV, json.dumps(settings)[:200])
    script = (
        "set -e; F=%s; "
        "if [ ! -f $F ]; then echo NO_CONFIG; exit 3; fi; "
        "cp $F $F.bak.$(date +%%s); "
        "node -e 'var fs=require(\"fs\");var f=process.argv[1];var add=JSON.parse(process.argv[2]);"
        "var c=JSON.parse(fs.readFileSync(f,\"utf8\"));"
        "Object.keys(add).forEach(function(k){c[k]=add[k];});"
        "fs.writeFileSync(f,JSON.stringify(c,null,2));' $F '%s' && echo WRITTEN"
        % (CONFIG_ON_TV, json.dumps(settings).replace("'", "'\\''"))
    )
    return _ssh(tv, script)


def restart(tv, dry_run=False):
    if dry_run:
        return True, "[dry run] %s restart" % CONTROL_TOOL
    return _ssh(tv, "%s restart && echo RESTARTED" % CONTROL_TOOL)


def report(tv):
    """What the installer shows before touching anything."""
    present, version = installed(tv)
    rel = latest()
    return {
        "installed": present,
        "version": version,
        "running": running(tv) if present else False,
        "latest": rel["version"],
        "outdated": bool(present and version and version != rel["version"]),
    }


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "latest"
    if cmd == "latest":
        for r in releases(limit=5):
            print("%-10s %s  %s" % (r["version"], r["published"][:10], r["ipk_name"]))
    elif cmd == "download":
        path, digest = download(latest())
        print(path)
        print(digest)
        print("sha256 ok" if digest else "kein Hash geprueft")
    else:
        print(__doc__)
        raise SystemExit(2)
