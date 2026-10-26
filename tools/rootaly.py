#!/usr/bin/env python3
"""Can this TV be rooted? — an honest answer from the data we have.

Rooting is not "works or not" in general: it depends on the model family and, much more,
on the firmware build. The authoritative source is <https://cani.rootmy.tv> (maintained by
the exploit authors). This tool does not try to replace it. What it does:

* encode the rules that the authors publish in their READMEs, so the installer can warn
  early instead of driving into a patched exploit,
* answer "yes / no / unknown" for the cases we can decide from model + webOS + firmware,
* point at cani.rootmy.tv whenever the answer is not decidable here.

Known rules (as published in the projects, checked 2026-10):

  faultmanager  (throwaway96/faultmanager-autoroot)
      vulnerable on webOS 4.0 – 10.0. Since 2025-08 the latest firmware of essentially all
      webOS 5, 6, 7 and 9 models is patched; webOS 4.0/4.5 are mostly still open.

  dejavuln      (throwaway96/dejavuln-autoroot)
      webOS 3.5 and up, patches rolling out starting with recent models.

  slopbro       (throwaway96/slopbro) — the one this repo uses for our own TV
      only for specific platforms; for the NANO77 / W21A platform ("kisscurl")
      it works up to firmware 03.53.45.

  wta / crashd  patched (crashd since 04/2024), listed here so nobody tries them.

  python3 tools/rootaly.py --model 43NANO779PA --webos 6.5 --firmware 03.51.16
"""
import argparse
import json
import re
import sys

CANI = "https://cani.rootmy.tv"

# Platforms SlopBro can still take, by the exploit author's table.
SLOPBRO_MAX = {
    "kisscurl": "03.53.45",     # NANO77/NANO79 (W21A), 2021
}

# Models whose platform name we know without asking the TV.
MODEL_PLATFORM = {
    "43NANO779PA": "kisscurl",
    "43NANO776PA": "kisscurl",
    "50NANO776PA": "kisscurl",
}


def _version_tuple(text):
    """'03.51.16' -> (3, 51, 16); anything unparseable -> None."""
    if not text:
        return None
    parts = re.findall(r"\d+", str(text))
    if not parts:
        return None
    return tuple(int(p) for p in parts[:3])


def _webos_major(text):
    if not text:
        return None
    match = re.search(r"(\d+)(?:\.(\d+))?", str(text))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2) or 0)


def advice(model=None, webos=None, firmware=None):
    """Return {'verdict': 'yes'|'no'|'unknown', 'method': ..., 'reason': ..., 'check': url}.

    The verdict is only 'yes' or 'no' when a published rule covers model + version.
    Everything else is 'unknown' on purpose: a wrong "yes" ends in a patched exploit run.
    """
    model = (model or "").upper()
    platform = None
    for known, name in MODEL_PLATFORM.items():
        if known in model:
            platform = name
            break

    major = _webos_major(webos)
    fw = _version_tuple(firmware)

    # 1. SlopBro: exact per-platform ceiling, the only case where we can say "yes" or "no"
    if platform and platform in SLOPBRO_MAX and fw:
        ceiling = _version_tuple(SLOPBRO_MAX[platform]) or (0, 0, 0)
        if fw <= ceiling:
            return {"verdict": "yes", "method": "slopbro",
                    "reason": "%s works on platform %s up to firmware %s, this TV is on %s"
                              % ("SlopBro", platform, SLOPBRO_MAX[platform], firmware),
                    "check": CANI}
        return {"verdict": "no", "method": "",
                "reason": "SlopBro stops at firmware %s for platform %s, this TV is on %s. "
                          "A newer method may exist." % (SLOPBRO_MAX[platform], platform, firmware),
                "check": CANI}

    # 1b. Platform known, but the firmware was not readable: say what the ceiling is
    if platform and platform in SLOPBRO_MAX and not fw:
        return {"verdict": "unknown", "method": "slopbro",
                "reason": "SlopBro covers platform %s up to firmware %s, but this TV's firmware "
                          "is not readable without root or a paired session - check %s"
                          % (platform, SLOPBRO_MAX[platform], CANI),
                "check": CANI}

    # 2. webOS 4.x: faultmanager is still open there
    if major and major[0] == 4:
        return {"verdict": "yes", "method": "faultmanager",
                "reason": "faultmanager is vulnerable on webOS 4.0-10.0 and webOS 4.x firmware "
                          "is not patched as far as the author has seen",
                "check": CANI}

    # 3. webOS 5/6/7/9/10: patched on current firmware — undecidable without the exact build
    if major and major[0] in (5, 6, 7, 9, 10):
        return {"verdict": "unknown", "method": "faultmanager / dejavuln",
                "reason": "since 08/2025 the latest firmware for webOS 5, 6, 7 and 9 is patched "
                          "almost everywhere; preinstalled or older builds can still be open. "
                          "The exact firmware decides it — that is what cani.rootmy.tv is for",
                "check": CANI}

    if major and major[0] == 3:
        return {"verdict": "unknown", "method": "dejavuln",
                "reason": "dejavuln covers webOS 3.5 and up, but patches are rolling out per model",
                "check": CANI}

    return {"verdict": "unknown", "method": "",
            "reason": "model or version missing - without them no rule applies",
            "check": CANI}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Judge whether an LG TV can be rooted")
    parser.add_argument("--model", default="", help="model name or number, e.g. 43NANO779PA")
    parser.add_argument("--webos", default="", help="webOS version, e.g. 6.5.0")
    parser.add_argument("--firmware", default="", help="firmware build, e.g. 03.51.16")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    result = advice(args.model, args.webos, args.firmware)
    if args.json:
        print(json.dumps(result, indent=1))
    else:
        print("verdict: %s" % result["verdict"])
        if result["method"]:
            print("method:  %s" % result["method"])
        print("reason:  %s" % result["reason"])
        print("check:   %s" % result["check"])
    return 0 if result["verdict"] == "yes" else 1


if __name__ == "__main__":
    sys.exit(main())
