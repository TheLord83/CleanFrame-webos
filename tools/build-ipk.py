#!/usr/bin/env python3
"""build-ipk.py — builds an installable IPK from a webOS app directory.

Structure as with the Homebrew packages (verified on the Lumen release):
  ar archive: debian-binary, control.tar.gz, data.tar.gz
  data:       usr/palm/applications/<id>/**  +  usr/palm/packages/<id>/packageinfo.json
  control:    Package, Version, Architecture, Description, webOS-Package-Format-Version 2

Usage: python3 build-ipk.py <app-directory> [target.ipk] [--hub <hub-directory>]

With --hub the directory is packaged as <app>/hub/, which is how the settings page
travels with the app instead of needing SSH. The app starts it through the Homebrew
service and stops it again when the app goes away.
"""
import gzip
import hashlib
import io
import json
import os
import sys
import tarfile
import time


def add_file(tar, path, arcname, mtime):
    info = tarfile.TarInfo(arcname)
    info.mtime = mtime
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mode = 0o644
    with open(path, "rb") as fh:
        data = fh.read()
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def add_dir(tar, arcname, mtime):
    info = tarfile.TarInfo(arcname)
    info.type = tarfile.DIRTYPE
    info.mtime = mtime
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mode = 0o755
    tar.addfile(info)


def tar_gz(entries, mtime):
    """entries: list of (arcname, localpath-or-None)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        added_dirs = set()
        for arcname, local in entries:
            parts = arcname.split("/")
            for i in range(1, len(parts)):
                d = "/".join(parts[:i])
                if d and d not in added_dirs:
                    add_dir(tar, d, mtime)
                    added_dirs.add(d)
            if local is None:
                if arcname not in added_dirs:
                    add_dir(tar, arcname, mtime)
                    added_dirs.add(arcname)
            else:
                add_file(tar, local, arcname, mtime)
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=mtime) as gz:
        gz.write(raw.getvalue())
    return out.getvalue()


def ar_member(name, payload, mtime):
    if len(name) > 16:
        raise ValueError("ar member name too long: " + name)
    header = "%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (name, mtime, 0, 0, "100644", len(payload))
    body = payload + (b"\n" if len(payload) % 2 else b"")
    return header.encode() + body


# Files that belong to development, not into a package: the icon preview page
# carried file:///root/... paths into the 0.5.1 IPK, and a .pyc or a checker
# scratch file is no better. Keep this list short and explicit.
EXCLUDE_NAMES = {".packageinfo.json", ".DS_Store", "icons-preview.html"}
EXCLUDE_DIRS = {"__pycache__", ".git"}
EXCLUDE_SUFFIX = (".pyc", ".pyo", ".swp", ".orig", ".rej")


def excluded(rel):
    parts = rel.replace(os.sep, "/").split("/")
    if any(p in EXCLUDE_DIRS for p in parts[:-1]):
        return True
    name = parts[-1]
    if name in EXCLUDE_NAMES or name.endswith(EXCLUDE_SUFFIX):
        return True
    return False


def main():
    argv = sys.argv[1:]
    hubdir = None
    if "--hub" in argv:
        i = argv.index("--hub")
        if i + 1 >= len(argv):
            sys.exit("--hub needs a directory")
        hubdir = os.path.abspath(argv[i + 1])
        del argv[i:i + 2]
    if not argv:
        sys.exit(__doc__)
    appdir = os.path.abspath(argv[0])
    appinfo_path = os.path.join(appdir, "appinfo.json")
    with open(appinfo_path, encoding="utf-8") as fh:
        appinfo = json.load(fh)

    appid = appinfo["id"]
    version = appinfo["version"]
    target = argv[1] if len(argv) > 1 else os.path.join(
        os.path.dirname(appdir), "ipk",
        "%s_%s_all.ipk" % (appid.replace(".", "_"), version))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    mtime = int(time.time())

    # data.tar.gz
    entries = []
    skipped = []
    for root, dirs, files in os.walk(appdir):
        dirs.sort()
        rel_root = os.path.relpath(root, appdir)
        for name in sorted(files):
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            if excluded(rel):
                skipped.append(rel)
                continue
            entries.append(("usr/palm/applications/%s/%s" % (appid, rel.replace(os.sep, "/")),
                            os.path.join(root, name)))
    hub_files = 0
    if hubdir:
        for root, dirs, files in os.walk(hubdir):
            dirs.sort()
            rel_root = os.path.relpath(root, hubdir)
            for name in sorted(files):
                rel = name if rel_root == "." else os.path.join(rel_root, name)
                if excluded(rel):
                    skipped.append(os.path.join("hub", rel))
                    continue
                entries.append(("usr/palm/applications/%s/hub/%s" % (appid, rel.replace(os.sep, "/")),
                                os.path.join(root, name)))
                hub_files += 1

    pkgjson_path = os.path.join(appdir, ".packageinfo.json")
    with open(pkgjson_path, "w", encoding="utf-8") as fh:
        json.dump({"id": appid, "version": version, "app": appid}, fh, indent=2)
    entries.append(("usr/palm/packages/%s/packageinfo.json" % appid, pkgjson_path))
    data_tgz = tar_gz(entries, mtime)

    # control.tar.gz
    control_txt = (
        "Package: %s\n"
        "Version: %s\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Architecture: all\n"
        "Installed-Size: %d\n"
        "Maintainer: CleanFrame for webOS <TheLord83@users.noreply.github.com>\n"
        "Description: %s\n"
        "webOS-Package-Format-Version: 2\n"
        "webOS-Packager-Version: 3.0\n"
    ) % (appid, version, sum(os.path.getsize(p) for _, p in entries if p), 
         appinfo.get("appDescription", appinfo.get("title", appid)))
    control_path = target + ".control"
    with open(control_path, "w", encoding="utf-8") as fh:
        fh.write(control_txt)
    control_tgz = tar_gz([("control", control_path)], mtime)
    os.unlink(control_path)
    if os.path.exists(pkgjson_path):
        os.unlink(pkgjson_path)

    blob = b"!<arch>\n"
    blob += ar_member("debian-binary", b"2.0\n", mtime)
    blob += ar_member("control.tar.gz", control_tgz, mtime)
    blob += ar_member("data.tar.gz", data_tgz, mtime)
    with open(target, "wb") as fh:
        fh.write(blob)

    print("IPK:    %s" % target)
    print("App-ID: %s  Version: %s" % (appid, version))
    print("Size:   %d bytes" % len(blob))
    print("SHA256: %s" % hashlib.sha256(blob).hexdigest())
    if hubdir:
        print("Hub:    %d files from %s" % (hub_files, hubdir))
    if skipped:
        print("Skipped: %s" % ", ".join(sorted(skipped)))


if __name__ == "__main__":
    main()
