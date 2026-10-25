#!/usr/bin/env python3
"""Prueft den Server-Code auf APIs, die das node auf dem Fernseher nicht hat.

Der LG 43NANO779PA liefert **node v8.12.0** (Glasshouse laeuft darauf). Alles,
was erst ab node 10 oder spaeter existiert, faellt hier auf, statt erst auf dem
Fernseher mit einem Stacktrace.

Aufruf: python3 tools/check-node8.py
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [os.path.join(ROOT, "web", "server.js")] + sorted(glob.glob(os.path.join(ROOT, "web", "lib", "*.js")))

# (Muster, Mindestversion, Hinweis)
FORBIDDEN = [
    (r"new URL\s*\(", "10", "url.parse() benutzen (new URL gibt es erst ab node 10)"),
    (r"recursive\s*:\s*true", "10.12", "eigene mkdirp-Hilfe (config.js) benutzen"),
    (r"fs\.promises", "10", "Synchrone fs-Aufrufe benutzen"),
    (r"require\(['\"]fs/promises", "14", "Synchrone fs-Aufrufe benutzen"),
    (r"\?\?", "14", "|| benutzen statt ?? (nullish coalescing)"),
    (r"\?\.[a-zA-Z_]", "14", "explizite Pruefung statt optional chaining"),
    (r"\bstructuredClone\b", "17", "JSON.parse(JSON.stringify(...)) benutzen"),
    (r"\.at\(\s*-", "16.6", "Array-Index statt .at()"),
    (r"Object\.hasOwn\b", "16.9", "Object.prototype.hasOwnProperty.call benutzen"),
    (r"String\.prototype\.replaceAll|\.replaceAll\(", "15", "replace mit /g benutzen"),
    (r"Array\.from\s*\(\s*\{", "12", "Object.keys benutzen"),
    (r"await\s+import|import\s*\(", "14", "require benutzen"),
    (r"\bglobalThis\b", "12", "global benutzen"),
]

ALLOWED_CONTEXT = ("// ", " * ", "/*")


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def main():
    problems = []
    for path in FILES:
        if not os.path.exists(path):
            continue
        src = strip_comments(open(path, encoding="utf-8").read())
        for line_no, line in enumerate(src.splitlines(), 1):
            if not line.strip():
                continue
            for pattern, minver, hint in FORBIDDEN:
                if re.search(pattern, line):
                    problems.append((os.path.relpath(path, ROOT), line_no, minver, hint, line.strip()[:90]))
    if not problems:
        print(f"node-8-Pruefung: {len(FILES)} Dateien in Ordnung (Ziel: node 8.12 auf dem Fernseher)")
        return 0
    print("Diese Stellen laufen auf node 8 nicht:")
    for path, line_no, minver, hint, code in problems:
        print(f"  {path}:{line_no}  (ab node {minver}) {hint}")
        print(f"      {code}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
