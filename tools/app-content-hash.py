#!/usr/bin/env python3
"""The content hash of app/ — the identity of a build that survives a rebuild.

The IPK archive cannot be compared across builds: tools/build-ipk.py stamps
``mtime = int(time.time())`` into every tar entry, the gzip header and the ar
header, so two builds of identical content give different archive hashes. That
makes an archive hash useless for "is this the build that was accepted?".

This hash answers that question instead: sha256 over the sorted list of the files
that end up inside the package, each with the sha256 of its bytes. Same content,
same hash, no matter when it was built.

    python3 tools/app-content-hash.py            # the hash and the file count
    python3 tools/app-content-hash.py --list     # the files it hashed

Exit codes: 0 ok, 1 app/ missing.
"""
import hashlib
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.join(ROOT, "app")


def load_builder():
    """Build-ipk.py has a hyphen in its name; load it, do not copy its filters."""
    spec = importlib.util.spec_from_file_location("build_ipk", os.path.join(HERE, "build-ipk.py"))
    if spec is None or spec.loader is None:
        raise SystemExit("cannot load tools/build-ipk.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def files(app=APP):
    excluded = load_builder().excluded
    out = []
    for root, dirs, names in os.walk(app):
        dirs.sort()
        rel_root = os.path.relpath(root, app)
        for name in sorted(names):
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            if excluded(rel):
                continue
            out.append(rel)
    return sorted(out)


def content_hash(app=APP):
    digest = hashlib.sha256()
    listed = files(app)
    for rel in listed:
        inner = hashlib.sha256()
        with open(os.path.join(app, rel), "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                inner.update(block)
        digest.update(rel.replace(os.sep, "/").encode("utf-8"))
        digest.update(b"\0")
        digest.update(inner.hexdigest().encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest(), listed


def main(argv):
    if not os.path.isdir(APP):
        print("app/ is missing", file=sys.stderr)
        return 1
    digest, listed = content_hash()
    print("%s  app/ (%d files)" % (digest, len(listed)))
    if "--list" in argv:
        for rel in listed:
            print("  " + rel.replace(os.sep, "/"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
