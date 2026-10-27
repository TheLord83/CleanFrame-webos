#!/usr/bin/env python3
"""check-links.py - do the relative links in the docs point at files that exist?

The repository is public, so a dead link in THIRD_PARTY_NOTICES or in a licence note is
a licence question rather than a typo: someone has to be able to reach the register that
names the photographer. This checks every relative markdown link and every anchor
against the tree and prints one machine-readable last line.

    python3 tools/check-links.py

Exit codes: 0 all links resolve, 1 at least one does not.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.*)$", re.MULTILINE)


def slug(heading):
    text = heading.lower()
    text = re.sub(r"[`*_]", "", text)
    text = re.sub(r"[^a-z0-9 -]", "", text)
    return text.strip().replace(" ", "-")


def main():
    checked = 0
    broken = []
    for folder, dirs, files in os.walk(ROOT):
        if ".git" in dirs:
            dirs.remove(".git")
        if "node_modules" in dirs:
            dirs.remove("node_modules")
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(folder, name)
            try:
                text = open(path, encoding="utf-8").read()
            except (OSError, UnicodeDecodeError):
                continue
            for match in LINK.finditer(text):
                target = match.group(2)
                if target.startswith(("http://", "https://", "mailto:", "#")):
                    continue
                checked += 1
                clean, _, anchor = target.partition("#")
                destination = os.path.normpath(os.path.join(folder, clean))
                if not os.path.exists(destination):
                    broken.append((os.path.relpath(path, ROOT), target, "no such file"))
                    continue
                if anchor and destination.endswith(".md"):
                    headings = HEADING.findall(open(destination, encoding="utf-8").read())
                    if anchor not in {slug(h) for h in headings}:
                        broken.append((os.path.relpath(path, ROOT), target, "no such anchor"))

    for source, target, why in broken:
        print("  FAIL  %s -> %s (%s)" % (source, target, why))
    print("  ok    %d relative links resolve" % (checked,) if not broken else "  %d broken" % len(broken))
    print("RESULT %d/%d" % (checked - len(broken), checked))
    return 0 if not broken else 1


if __name__ == "__main__":
    sys.exit(main())
