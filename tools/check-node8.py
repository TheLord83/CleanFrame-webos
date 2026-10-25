#!/usr/bin/env python3
"""Checks the server code for APIs that node on the TV does not have.

The LG 43NANO779PA ships **node v8.12.0** (Glasshouse runs on it). Everything
that only exists from node 10 or later is caught here instead of on the TV with
a stack trace.

Usage: python3 tools/check-node8.py
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [os.path.join(ROOT, "web", "server.js")] + sorted(glob.glob(os.path.join(ROOT, "web", "lib", "*.js")))

# (pattern, minimum version, hint)
FORBIDDEN = [
    (r"new URL\s*\(", "10", "use url.parse() (new URL only exists from node 10)"),
    (r"recursive\s*:\s*true", "10.12", "use the own mkdirp helper (config.js)"),
    (r"fs\.promises", "10", "use synchronous fs calls"),
    (r"require\(['\"]fs/promises", "14", "use synchronous fs calls"),
    (r"\?\?", "14", "use || instead of ?? (nullish coalescing)"),
    (r"\?\.[a-zA-Z_]", "14", "explicit check instead of optional chaining"),
    (r"\bstructuredClone\b", "17", "use JSON.parse(JSON.stringify(...))"),
    (r"\.at\(\s*-", "16.6", "array index instead of .at()"),
    (r"Object\.hasOwn\b", "16.9", "use Object.prototype.hasOwnProperty.call"),
    (r"String\.prototype\.replaceAll|\.replaceAll\(", "15", "use replace with /g"),
    (r"Array\.from\s*\(\s*\{", "12", "use Object.keys"),
    (r"await\s+import|import\s*\(", "14", "use require"),
    (r"\bglobalThis\b", "12", "use global"),
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
        print(f"node-8 check: {len(FILES)} files in order (target: node 8.12 on the TV)")
        print(f"RESULT {len(FILES)}/{len(FILES)}")
        return 0
    bad_files = len({p[0] for p in problems})
    print("These places do not run on node 8:")
    for path, line_no, minver, hint, code in problems:
        print(f"  {path}:{line_no}  (from node {minver}) {hint}")
        print(f"      {code}")
    print(f"RESULT {max(0, len(FILES) - bad_files)}/{len(FILES)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
