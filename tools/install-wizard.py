#!/usr/bin/env python3
"""install-wizard.py — one run, from an untouched TV to a configured start page.

The flow, in the order it asks questions and not in the order that is convenient
for the script:

    1. find the television          discovery, or the address you type
    2. is it reachable, and could it go?   SSH, Telnet, Luna, model, webOS version
    3. is it rooted?                if not: offer rooting (somebody else's exploit,
                                    see tools/lib/rooting.py), or stop here
    4. Glasshouse                   install, or update, or leave alone
    5. ads and telemetry            offer, do not sneak in
    6. CleanFrame                   the launcher, then the hub
    7. one address for the browser  http://<tv>:8484/ — everything else is set there

Every step prints what it is about to change before it changes anything, and every
change lands in a log next to the configuration so it can be undone.

    ./tools/install-wizard.py                       # the whole thing, questions asked
    ./tools/install-wizard.py --tv 192.168.0.49     # skip the discovery
    ./tools/install-wizard.py --dry-run             # print the plan, change nothing
    ./tools/install-wizard.py --lang de             # German prompts (the default too)
    ./tools/install-wizard.py --yes                 # for a machine nobody sits at:
                                                     # only the safe steps, nothing risky

Exit codes: 0 done, 1 a step failed, 2 misuse, 3 stopped at a question.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "lib"))
import glasshouse  # noqa: E402
import rooting     # noqa: E402

LOG = None


# ---------------------------------------------------------------- talking ----
def say(text=""):
    print(text, flush=True)


def step(n, total, title):
    say()
    say("== %d/%d  %s" % (n, total, title))


def ask(question, default="n"):
    if not os.isatty(0):
        return default
    suffix = "[J/n]" if default in ("y", "j") else "[j/N]"
    try:
        answer = input("%s %s " % (question, suffix)).strip().lower()
    except EOFError:
        return default
    if not answer:
        return default
    return "y" if answer in ("j", "y", "ja", "yes") else "n"


def confirm_risk(question):
    """For the steps that can break a television: typing the word is the point."""
    if not os.isatty(0):
        return False
    say(question)
    try:
        answer = input("  Zum Fortfahren ERISK schreiben: ").strip()
    except EOFError:
        return False
    return answer == "ERISK"


def log(line):
    global LOG
    if LOG is None:
        LOG = os.path.join(os.path.expanduser("~"), ".cleanframe-install.log")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write("%s  %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))


# -------------------------------------------------------------- discovery ----
def discover():
    """Ask the network for webOS televisions. Returns a list of addresses."""
    found = []
    try:
        out = subprocess.run([sys.executable, os.path.join(HERE, "discover.py")],
                             capture_output=True, text=True, timeout=120).stdout
    except (OSError, subprocess.TimeoutExpired):
        out = ""
    for line in out.splitlines():
        for token in line.replace(",", " ").split():
            if token.count(".") == 3 and all(p.isdigit() for p in token.split(".")):
                if token not in found:
                    found.append(token)
    return found


def http_json(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001 - absent is a normal answer here
        return None


def inspect(tv):
    """Everything the wizard needs to decide, in one place."""
    out = {"tv": tv}
    out["ssh"] = subprocess.run(["bash", "-c", "nc -z -w3 %s 22 2>/dev/null && echo open" % tv],
                                capture_output=True, text=True).stdout.strip() == "open"
    out["telnet"] = subprocess.run(["bash", "-c", "nc -z -w3 %s 23 2>/dev/null && echo open" % tv],
                                   capture_output=True, text=True).stdout.strip() == "open"
    uid = ""
    ok, text = glasshouse._ssh(tv, "id -u 2>/dev/null; true", timeout=15)
    if ok and text.strip():
        # A shell that answers prints the uid alone, before anything else.
        first = text.strip().splitlines()[0].strip()
        if first.isdigit() or "uid=" in first:
            uid = first
    out["shell"] = bool(uid)
    out["device"] = rooting.device(tv) if out["shell"] else {}
    out["root"] = uid == "0" or "uid=0(root)" in uid
    out["glasshouse"] = None
    if out["root"]:
        try:
            out["glasshouse"] = glasshouse.report(tv)
        except Exception as e:  # noqa: BLE001
            out["glasshouse"] = {"error": str(e)}
    out["webos"] = (out["device"] or {}).get("webos", "")
    out["model"] = (out["device"] or {}).get("model", "")
    return out


def summary(state):
    d = state["device"] or {}
    say("  Adresse      %s" % state["tv"])
    say("  Modell       %s" % (state["model"] or "unbekannt"))
    say("  webOS        %s%s" % (state["webos"] or "unbekannt",
                                 "" if state["webos"] else "  (das Skript kann die Version nicht lesen)"))
    say("  Firmware     %s" % (d.get("firmware") or "unbekannt"))
    say("  SSH/Telnet   %s / %s" % ("offen" if state["ssh"] else "zu",
                                   "offen" if state["telnet"] else "zu"))
    say("  Root         %s" % ("ja" if state["root"] else "nein"))
    gh = state["glasshouse"]
    if isinstance(gh, dict) and gh.get("error"):
        say("  Glasshouse   Zustand nicht lesbar (%s)" % gh["error"])
    elif gh:
        say("  Glasshouse   %s%s, %s" % (
            gh.get("version") or "installiert",
            " (aktuell ist %s)" % gh["latest"] if gh.get("outdated") else " (aktuell)",
            "laeuft" if gh.get("running") else "laeuft nicht"))


# ------------------------------------------------------------------ steps ----
def step_root(state, args):
    if state["root"]:
        say("  Root ist da. Nichts zu tun.")
        return True
    say("  Ohne Root geht Glasshouse nicht, ohne Glasshouse kein Launcher.")
    say()
    say(rooting.WARNING)
    key = rooting.pick(state["webos"])
    p = rooting.PROJECTS[key]
    say("  Vorschlag: %s (%s) — deckt %s ab" % (p["name"], p["licence"], p["covers"]))
    say("  %s" % p["repo"])
    say()
    say("  Das ist nicht Software von mir. Das Skript laedt sie von dort und")
    say("  fuehrt sie aus, wie in deren Anleitung beschrieben.")
    if args.dry_run:
        say("  [dry run] wuerde jetzt fragen und dann %s ausfuehren" % p["name"])
        return True
    if not confirm_risk("  Rooten kann den Fernseher unbrauchbar machen."):
        say("  Abgebrochen, nichts geaendert. Der Weg von Hand: %s" % p["repo"])
        return False
    log("root: %s auf %s" % (key, state["tv"]))
    ok, text = rooting.run_slopbro(state["tv"], confirm=True, dry_run=False)
    say("  %s" % (text or "").strip()[:400])
    return ok


def step_glasshouse(state, args):
    gh = state["glasshouse"] or {}
    if gh.get("error"):
        say("  Zustand unlesbar: %s" % gh["error"])
    if gh.get("installed"):
        say("  Installiert: %s, laeuft %s" % (gh.get("version"), "ja" if gh.get("running") else "nein"))
        if not gh.get("outdated"):
            say("  Kein Update noetig.")
            return True
        say("  Es gibt %s. Aktualisieren?" % gh["latest"])
        if not ask("  Glasshouse jetzt auf %s bringen?" % gh["latest"], "n"):
            say("  Bleibt bei %s." % gh.get("version"))
            return True
    else:
        say("  Glasshouse fehlt. Es ist der Weg, ein IPK auf den Fernseher zu bekommen,")
        say("  und liefert die App-Liste fuer den Launcher.")
        if not ask("  Glasshouse jetzt installieren?", "y"):
            say("  Ohne Glasshouse endet der Ablauf hier: ohne App-Installation kein Launcher.")
            return False
    try:
        rel = glasshouse.latest()
    except glasshouse.GlasshouseError as e:
        say("  Release nicht abrufbar: %s" % e)
        return False
    say("  Neueste Version: %s (%s)" % (rel["version"], rel["ipk_name"]))
    if args.dry_run:
        say("  [dry run] herunterladen, Pruefsumme vergleichen, installieren")
        return True
    say("  Lade und pruefe ...")
    try:
        path, digest = glasshouse.download(rel)
    except glasshouse.GlasshouseError as e:
        say("  Abgebrochen: %s" % e)
        return False
    say("  In Ordnung, sha256 %s..." % digest[:16])
    ok, text = glasshouse.install_ipk(state["tv"], path)
    log("glasshouse: %s installiert (%s)" % (rel["version"], digest[:16]))
    say("  %s" % (text or "").strip()[:300])
    say("  Wichtig: Glasshouse antwortet erst nur auf dem Fernseher selbst.")
    say("  Beim ersten Start kommt ein Hinweis auf dem Bildschirm, dort den Zugriff")
    say("  fuers Netz freigeben. Sonst ist Port 8080 von aussen zu.")
    return ok


def step_privacy(state, args):
    say("  Werbung und Telemetrie abschalten ist ein eigener Wunsch, keine Nebenbedingung.")
    say("  Glasshouse hat dafuer eine Privacy-Seite mit den LG-Einwilligungen.")
    if not ask("  Soll ich den Hosts-Block fuer die LG-Werbe- und Update-Endpunkte setzen?", "n"):
        say("  Uebersprungen. Spaeter ueber tools/root/tvsetup.py moeglich.")
        return True
    if args.dry_run:
        say("  [dry run] acht LG-Hostnamen in /etc/hosts eintragen")
        return True
    ok, text = rooting._ssh(state["tv"], "grep -c 'lge.com' /etc/hosts 2>/dev/null || echo 0")
    say("  Bereits eingetragen: %s Zeilen" % (text or "0").strip())
    cmd = ("H='/tmp/cf-hosts'; printf '%%s\\n' su.lge.com snu.lge.com lgtvonline.lge.com lgappstv.com "
           "us.lgtvsdp.com eu.lgtvsdp.com kic.lge.com ngfts.lge.com | while read h; do "
           "grep -q \" $h\" /etc/hosts || echo \"0.0.0.0 $h\"; done > $H; "
           "cp /etc/hosts /etc/hosts.bak.$(date +%%s); cat $H >> /etc/hosts; wc -l < $H")
    ok, text = rooting._ssh(state["tv"], cmd)
    log("privacy: hosts-Block auf %s, %s Zeilen" % (state["tv"], (text or "").strip()))
    say("  %s Zeilen ergaenzt, /etc/hosts vorher gesichert." % (text or "?").strip())
    return ok


def step_cleanframe(state, args):
    ipk = args.ipk or newest_ipk()
    if not ipk:
        say("  Kein IPK gefunden. Erst bauen: python3 tools/build-ipk.py app dist/...ipk --hub web")
        return False
    say("  Paket: %s" % os.path.basename(ipk))
    if args.dry_run:
        say("  [dry run] installieren, starten, Hub einrichten")
        return True
    r = subprocess.run([sys.executable, os.path.join(HERE, "install-launcher.sh"),
                        "--tv", state["tv"], "--ipk", ipk, "--yes"],
                       capture_output=True, text=True)
    say((r.stdout or "").strip()[-500:])
    log("cleanframe: %s installiert" % os.path.basename(ipk))
    if r.returncode != 0:
        return False
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "install-hub.sh"),
                         "--tv", state["tv"], "--yes"], capture_output=True, text=True)
    say((r2.stdout or "").strip()[-500:])
    if r2.returncode != 0:
        return False
    health = http_json("http://%s:8484/api/health" % state["tv"])
    if health:
        say("  Hub antwortet, Version %s" % health.get("version"))
    return True


def newest_ipk():
    dist = os.path.join(ROOT, "dist")
    try:
        files = [os.path.join(dist, f) for f in os.listdir(dist) if f.endswith(".ipk")]
    except OSError:
        return None
    if not files:
        return None
    return max(files, key=os.path.getmtime)


# ------------------------------------------------------------------- main ----
def main():
    ap = argparse.ArgumentParser(description="Install CleanFrame on a rooted LG TV, in one run.")
    ap.add_argument("--tv", default="", help="address of the television; discovered when empty")
    ap.add_argument("--ipk", default="", help="IPK to install instead of the newest build")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="only the safe steps, nothing that roots or blocks")
    ap.add_argument("--lang", default="de")
    args = ap.parse_args()

    total = 7
    say("CleanFrame installieren. Jeder Schritt sagt vorher, was er aendert.")
    if args.dry_run:
        say("Trockenlauf: es wird nichts geaendert.")
    if args.yes:
        say("--yes: rooten und Werbung blockieren werden uebersprungen, auch wenn sie fehlen.")

    step(1, total, "Fernseher finden")
    tv = args.tv
    if not tv:
        say("  Suche im Netz ...")
        found = discover()
        if len(found) == 1:
            tv = found[0]
            say("  Gefunden: %s" % tv)
        elif found:
            for i, addr in enumerate(found, 1):
                say("  %d) %s" % (i, addr))
            try:
                pick = input("  Nummer oder Adresse: ").strip()
            except EOFError:
                pick = "1"
            tv = found[int(pick) - 1] if pick.isdigit() and int(pick) <= len(found) else pick
        else:
            say("  Nichts gefunden.")
            try:
                tv = input("  Adresse des Fernsehers: ").strip()
            except EOFError:
                tv = ""
        if not tv:
            say("Ohne Adresse kein Ablauf.")
            return 3

    step(2, total, "Ist er da, und was ist er?")
    state = inspect(tv)
    if not state["ssh"] and not state["telnet"]:
        say("  %s antwortet weder auf 22 noch auf 23." % tv)
        say("  Fernseher an? Im selben Netz? SSH im Homebrew Channel eingeschaltet?")
        return 1
    if not state["shell"]:
        say("  Port %s ist offen, aber ich komme nicht rein (Schluessel? Passwort?)." % (22 if state["ssh"] else 23))
        say("  Ohne Shell kann das Skript den Fernseher nicht pruefen und nichts einrichten.")
        say("  Im Homebrew Channel unter SSH den Schluessel hinterlegen, dann nochmal.")
        return 1
    summary(state)

    step(3, total, "Root")
    if args.yes and not state["root"]:
        say("  Kein Root, und --yes rootet nicht. Abbruch.")
        return 3
    if not step_root(state, args):
        return 3
    if not state["root"]:
        state["root"] = True

    step(4, total, "Glasshouse")
    if not step_glasshouse(state, args):
        return 1

    step(5, total, "Werbung und Telemetrie")
    if args.yes:
        say("  Uebersprungen (--yes).")
    elif not step_privacy(state, args):
        return 1

    step(6, total, "CleanFrame")
    if not step_cleanframe(state, args):
        return 1

    step(7, total, "Fertig")
    say("  Einstellungen:  http://%s:8484/" % tv)
    say("  Dort Bild, Uhr, Kacheln, Home Assistant und Wetter einstellen.")
    say("  Glasshouse daneben:  http://%s:8080/" % tv)
    say()
    say("  Protokoll: %s" % (LOG or os.path.join(os.path.expanduser("~"), ".cleanframe-install.log")))
    if args.dry_run:
        say("  Trockenlauf beendet, nichts geaendert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
