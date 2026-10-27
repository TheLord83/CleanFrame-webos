#!/usr/bin/env python3
"""make-apps-json.py — builds the Homebrew Channel repository file for a release.

The Homebrew Channel reads one JSON file per repository (its settings, "Add
repository"), and every launcher in the scene ships one: Lightkeeper, Hearth and
Luma all do. This writes it from the built IPK, so the release step is one command
instead of hand-edited JSON with a hash that goes stale.

Usage:
  python3 tools/make-apps-json.py --ipk ipk/cleanframe_0.4.41_all.ipk
  python3 tools/make-apps-json.py --ipk ... --tag v0.4.41 --out repo/apps.json

The download URL points at the GitHub release asset for that tag, which is what
"releases/download/<tag>/<file>" resolves to once the release exists.
"""
import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ipk", required=True)
    parser.add_argument("--repo", default="TheLord83/CleanFrame-webos")
    parser.add_argument("--tag", default="")
    parser.add_argument("--out", default=os.path.join(ROOT, "repo", "apps.json"))
    parser.add_argument("--check", action="store_true",
                        help="only verify an existing file matches the IPK")
    args = parser.parse_args()

    appinfo = json.load(open(os.path.join(ROOT, "app", "appinfo.json"), encoding="utf-8"))
    version = appinfo["version"]
    app_id = appinfo["id"]
    tag = args.tag or ("v" + version)
    raw = "https://raw.githubusercontent.com/%s/main" % args.repo
    download = "https://github.com/%s/releases/download/%s/%s" % (args.repo, tag, os.path.basename(args.ipk))

    size = os.path.getsize(args.ipk)
    digest = sha256(args.ipk)

    manifest = {
        "id": app_id,
        "version": version,
        "type": appinfo.get("type", "web"),
        "title": appinfo.get("title", "CleanFrame"),
        "appDescription": appinfo.get("appDescription", ""),
        "iconUri": raw + "/app/" + appinfo.get("icon", "icon.png"),
        "sourceUrl": "https://github.com/%s" % args.repo,
        # The launcher itself runs as a normal app; the hub beside it needs root.
        "rootRequired": "optional",
        "ipkUrl": download,
        "ipkHash": {"sha256": digest},
        "ipkSize": size,
    }

    packages = {
        "paging": {"page": 1, "count": 1, "maxPage": 1, "itemsTotal": 1},
        "packages": [{
            "id": app_id,
            "title": appinfo.get("title", "CleanFrame"),
            "iconUri": raw + "/app/" + appinfo.get("icon", "icon.png"),
            "shortDescription": "Quiet start screen with wallpapers, Home Assistant values and a hub in the browser.",
            "manifest": manifest,
        }],
    }

    if args.check:
        if not os.path.exists(args.out):
            print("MISSING: %s" % args.out)
            return 1
        have = json.load(open(args.out, encoding="utf-8"))["packages"][0]["manifest"]
        same = (have.get("version") == manifest["version"]
                and have.get("ipkHash", {}).get("sha256") == manifest["ipkHash"]["sha256"]
                and have.get("ipkSize") == manifest["ipkSize"])
        print("%s: %s" % ("up to date" if same else "STALE", args.out))
        return 0 if same else 1

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(packages, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print("App-ID:  %s" % app_id)
    print("Version: %s (tag %s)" % (version, tag))
    print("IPK:     %s, %.1f MB" % (os.path.basename(args.ipk), size / 1e6))
    print("SHA256:  %s" % digest)
    print("Written: %s" % args.out)
    print()
    print("Repository address for the Homebrew Channel:")
    print("  https://raw.githubusercontent.com/%s/main/repo/apps.json" % args.repo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
