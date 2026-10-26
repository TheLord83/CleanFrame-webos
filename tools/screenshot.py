#!/usr/bin/env python3
"""Take a screenshot of the TV screen - the whole screen, not just the browser.

On this TV the documented service name `com.webos.service.tv.capture` does not exist
("Service does not exist"), `com.webos.service.capture` does. Taken with the built-in capture
service, so it also shows LG's own screens: home screen, settings, the info panel. The
framebuffer (/dev/fb0) is not usable - the device is held by surface-manager and `dd` answers
"No such device" - so this service is the way.

    python3 tools/screenshot.py                       # 1920x1080 PNG to ./tv-<time>.png
    python3 tools/screenshot.py --tv 192.168.1.50 -o shot.png
    python3 tools/screenshot.py --format JPG --width 1280 --height 720
    python3 tools/screenshot.py --keep                # leave the file on the TV

Two pitfalls this script works around:

* `luna-send` prints nothing when its stdout is a pipe through ssh; writing to a file on the TV
  and reading that file works every time.
* The TV answers with JSON (`writtenBytes`, `capturedWidth`), so success is checked on the file
  size, not on the exit code.

Exit code 0 = a picture was fetched, 1 = not.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import time

SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]


def ssh(tv, command, timeout=60):
    return subprocess.run(["ssh"] + SSH_OPTS + ["root@" + tv, command],
                          capture_output=True, text=True, timeout=timeout)


def capture(tv, width, height, fmt, keep):
    """Ask the TV for a screenshot and wait until the file exists.

    luna-send has to run in the background: called in the foreground over ssh it prints
    nothing at all and just sits there, while the same call backgrounded finishes in under a
    second. The reply is written to a file on the TV, then read.
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    remote = "/tmp/cf-shot-%s.%s" % (stamp, fmt.lower())
    reply = "/tmp/cf-shot-%s.json" % stamp
    payload = json.dumps({"path": remote, "method": "DISPLAY", "format": fmt,
                          "width": width, "height": height})
    script = (
        "rm -f {p} {r}; "
        "( luna-send -n 1 -f luna://com.webos.service.capture/executeOneShot {payload} "
        "> {r} 2>&1 & ); "
        "for i in 1 2 3 4 5; do sleep 1; [ -s {p} ] && break; done; "
        "cat {r} 2>/dev/null; echo; "
        "[ -s {p} ] && echo SIZE=$(wc -c < {p} | tr -d ' ') || echo SIZE=0"
    ).format(p=remote, r=reply, payload=shlex.quote(payload))
    result = ssh(tv, script)
    answer = {}
    size = 0
    for line in result.stdout.replace("\r", "").split("\n"):
        line = line.strip()
        if line.startswith("{"):
            try:
                answer = json.loads(line)
            except ValueError:
                pass
        elif line.startswith("SIZE="):
            try:
                size = int(line.split("=", 1)[1])
            except ValueError:
                size = 0
    if size:
        return remote, answer, None, reply
    if answer.get("errorText"):
        return None, answer, answer["errorText"], reply
    return None, answer, ("the TV produced no file (" + (answer.get("errorText") or "no answer") +
                          ", ssh rc %d)" % result.returncode), reply


def fetch(tv, remote, local):
    return subprocess.run(["scp", "-q"] + SSH_OPTS + ["root@%s:%s" % (tv, remote), local],
                          capture_output=True, text=True, timeout=120)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Screenshot of the TV screen")
    parser.add_argument("--tv", default="192.168.1.50", help="address of the TV")
    parser.add_argument("-o", "--out", default="", help="local file (default tv-<time>.png)")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--format", default="PNG", choices=["PNG", "JPG", "BMP"])
    parser.add_argument("--keep", action="store_true", help="leave the file on the TV")
    args = parser.parse_args(argv)

    remote, answer, error, reply = capture(args.tv, args.width, args.height, args.format, args.keep)
    if error:
        print("ERROR: " + error, file=sys.stderr)
        return 1

    local = args.out or "tv-%s.%s" % (time.strftime("%Y%m%d-%H%M%S"), args.format.lower())
    copied = fetch(args.tv, remote, local)
    if copied.returncode != 0:
        print("ERROR: could not fetch %s: %s" % (remote, (copied.stderr or "").strip()),
              file=sys.stderr)
        return 1
    size = os.path.getsize(local)
    if not size:
        print("ERROR: %s is empty" % local, file=sys.stderr)
        return 1

    answer = answer or {}
    print("saved %s (%d bytes, %sx%s, %s)" % (local, size, answer.get("capturedWidth") or args.width,
                                              answer.get("capturedHeight") or args.height, args.format))
    if remote:
        cleanup = "rm -f %s" % shlex.quote(remote if not args.keep else reply)
        if not args.keep:
            cleanup += " %s" % shlex.quote(reply)
        ssh(args.tv, cleanup)
    return 0


if __name__ == "__main__":
    sys.exit(main())
