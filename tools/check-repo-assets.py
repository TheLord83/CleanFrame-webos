#!/usr/bin/env python3
"""Do the two repository files that describe a release still tell the truth?

There are two of them and nobody compared them:

  repo/apps.json   the pinned copy in git, served from raw.githubusercontent
  repo.json        the asset attached to a release, what the Homebrew Channel reads

And both could drift from the package. This check reads the release path offline,
deterministically, without network:

Stage A (build) — build the IPK into a temporary directory, let
tools/make-apps-json.py write the repository file next to it, and check that the
version, the size and the hash in it are the ones of the package that was just
built. Nothing is written into dist/ — a generated file there is how the stale
dist/repo.json came to be.

Stage B (pinned copy) — repo/apps.json must match the newest tag (it is the last
released version, not the working one): version, tag in the URL, file name in the
URL, and a full sha256. When the pinned copy already carries the working version,
its size and hash have to match the freshly built package exactly — that is the
release moment, and the one place where a wrong hash would hurt.

    python3 tools/check-repo-assets.py            # builds in a temp dir
    python3 tools/check-repo-assets.py --ipk dist/cleanframe_0.6.32_all.ipk

Exit codes: 0 all good, 1 a check failed, 2 skipped (no build possible).
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APPINFO = os.path.join(ROOT, "app", "appinfo.json")
PINNED = os.path.join(ROOT, "repo", "apps.json")

results = []


def check(ok, name, note=""):
    results.append((ok, name))
    print(("  ok    " if ok else "  FEHL  ") + name + ("  " + note if note else ""))


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def release_name(version):
    """The file name a release asset carries — the one the hub downloads."""
    return "cleanframe_%s_all.ipk" % version


def build(workdir, version):
    # Built under the release name on purpose: the URL in the repository file is
    # the file name of the package, so this is what a release build looks like.
    target = os.path.join(workdir, release_name(version))
    run = subprocess.run([sys.executable, os.path.join(HERE, "build-ipk.py"), "app", target,
                          "--hub", "web"], cwd=ROOT, capture_output=True, text=True)
    if run.returncode != 0:
        print("  build failed: " + (run.stderr or run.stdout).strip()[:400])
        return None
    return target


def repo_file(ipk, workdir):
    out = os.path.join(workdir, "repo.json")
    run = subprocess.run([sys.executable, os.path.join(HERE, "make-apps-json.py"),
                          "--ipk", ipk, "--out", out], cwd=ROOT, capture_output=True, text=True)
    if run.returncode != 0:
        print("  make-apps-json failed: " + (run.stderr or run.stdout).strip()[:400])
        return None
    with open(out, encoding="utf-8") as handle:
        return json.load(handle)["packages"][0]["manifest"]


def tag_version():
    run = subprocess.run(["git", "describe", "--tags", "--abbrev=0"], cwd=ROOT,
                         capture_output=True, text=True)
    if run.returncode != 0:
        return None
    tag = run.stdout.strip()
    return tag, tag[1:] if tag.startswith("v") else tag


def main():
    ap = argparse.ArgumentParser(description="Check the release files against the package.")
    ap.add_argument("--ipk", default="", help="an existing IPK instead of building one")
    ap.add_argument("--pinned", default=PINNED, help="the pinned copy to check (default repo/apps.json)")
    args = ap.parse_args()

    with open(APPINFO, encoding="utf-8") as handle:
        version = json.load(handle)["version"]
    print("  version in app/appinfo.json: %s" % version)

    workdir = tempfile.mkdtemp(prefix="cf-repo-")
    try:
        ipk = args.ipk or build(workdir, version)
        if not ipk or not os.path.isfile(ipk):
            print("SKIP no package to compare against (build failed)")
            print("RESULT 0/0 skip")
            return 2
        size = os.path.getsize(ipk)
        digest = sha256(ipk)
        name = os.path.basename(ipk)
        print("  package: %s, %d bytes, %s" % (os.path.basename(ipk), size, digest[:16] + "…"))
        check(name == release_name(version), "package carries the release file name",
              "%s (erwartet %s)" % (name, release_name(version)))

        # ---- Stage A: the repository file generated from this package -----------
        manifest = repo_file(ipk, workdir)
        if manifest is None:
            check(False, "A: make-apps-json writes a repository file")
        else:
            check(manifest.get("version") == version, "A: version in the repository file",
                  "%s (erwartet %s)" % (manifest.get("version"), version))
            check(manifest.get("ipkSize") == size, "A: size matches the package",
                  "%s (erwartet %d)" % (manifest.get("ipkSize"), size))
            check((manifest.get("ipkHash") or {}).get("sha256") == digest,
                  "A: sha256 matches the package")
            url = str(manifest.get("ipkUrl") or "")
            check(url.endswith("/download/v%s/%s" % (version, name)),
                  "A: url carries tag and file name", url.rsplit("/", 2)[-2] + "/" + url.rsplit("/", 1)[-1])

        # ---- Stage B: the pinned copy against the newest tag -------------------
        if not os.path.isfile(args.pinned):
            check(False, "B: repo/apps.json exists")
        else:
            with open(args.pinned, encoding="utf-8") as handle:
                pinned = json.load(handle)["packages"][0]["manifest"]
            pinned_version = pinned.get("version")
            newest = tag_version()
            if newest is None:
                check(False, "B: a tag to compare against", "git describe returned nothing")
            else:
                tag, tag_version_plain = newest
                check(pinned_version == tag_version_plain,
                      "B: pinned copy matches the newest tag",
                      "%s vs %s" % (pinned_version, tag))
            pinned_url = str(pinned.get("ipkUrl") or "")
            check("/download/v%s/cleanframe_%s_all.ipk" % (pinned_version, pinned_version) in pinned_url,
                  "B: pinned url carries tag and file name", pinned_url.rsplit("/", 2)[-2] + "/" + pinned_url.rsplit("/", 1)[-1])
            check(re.fullmatch(r"[0-9a-f]{64}", str((pinned.get("ipkHash") or {}).get("sha256") or "")) is not None,
                  "B: pinned sha256 is a full hash")
            check(isinstance(pinned.get("ipkSize"), int) and pinned.get("ipkSize") > 0,
                  "B: pinned size is a number", str(pinned.get("ipkSize")))

            # Release moment: the pinned copy already carries the working version,
            # so it has to describe exactly the package that was just built.
            if pinned_version == version:
                check(pinned.get("ipkSize") == size, "B: release moment — size is exact",
                      "%s (erwartet %d)" % (pinned.get("ipkSize"), size))
                check((pinned.get("ipkHash") or {}).get("sha256") == digest,
                      "B: release moment — sha256 is exact")
            else:
                print("  info  repo/apps.json is still %s, the working version is %s — "
                      "the exact hash check starts at the release" % (pinned_version, version))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    bad = [name for ok, name in results if not ok]
    print("\nRESULT %d/%d" % (len(results) - len(bad), len(results)))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
