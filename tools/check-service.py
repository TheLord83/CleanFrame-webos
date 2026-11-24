#!/usr/bin/env python3
"""check-service.py — der Startdienst muss mit sich selbst uebereinstimmen.

Der Dienstname wird an drei Stellen gebraucht und muss ueberall gleich sein:
Verzeichnis im IPK, `services.json`, `package.json` und der Name, den
`webos-service` auf dem Bus registriert. Weicht eine davon ab, startet der Bus
den Dienst nicht ("Service does not exist") oder gibt ihm keine Rechte
("Not permitted to send to com.webos.applicationManager").
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVC = os.path.join(ROOT, "service")
NAME = "com.blackpearl.cleanframe.service"

checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def main():
    for required in ("service.js", "package.json", "services.json", "autostart.sh"):
        check("service/" + required + " vorhanden", os.path.isfile(os.path.join(SVC, required)))

    if not os.path.isfile(os.path.join(SVC, "services.json")):
        return report()
    sj = json.loads(read(os.path.join(SVC, "services.json")))
    check("services.json id", sj.get("id") == NAME, sj.get("id", ""))
    names = [s.get("name") for s in sj.get("services", [])]
    check("services.json services[].name", names == [NAME], str(names))

    pj = json.loads(read(os.path.join(SVC, "package.json")))
    check("package.json name", pj.get("name") == NAME, pj.get("name", ""))
    check("package.json main", pj.get("main") == "service.js", pj.get("main", ""))

    js = read(os.path.join(SVC, "service.js"))
    check("Bus-Name in service.js", "new Service('%s')" % NAME in js)
    check("--disable-timeouts gesetzt", "--disable-timeouts" in js)
    check("nicht-blockierendes Lesen", "O_NONBLOCK" in js)
    check("Home-Code 773", "'773'" in js)

    sh = read(os.path.join(SVC, "autostart.sh"))
    check("autostart kennt das Dienstverzeichnis", "/services/" + NAME in sh)
    check("autostart startet mit --boot --watch", "--boot --watch" in sh)

    appinfo = json.loads(read(os.path.join(ROOT, "app", "appinfo.json")))
    check("appinfo nicht als Dienst deklariert", "services" not in appinfo)

    return report()


def report():
    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        if not ok:
            print("  FAIL %s %s" % (name, detail))
    print("RESULT %d/%d" % (len(checks) - len(failed), len(checks)))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # ein kaputter Dienst ist ein Befund, kein Absturz
        print("  FAIL %s" % exc)
        print("RESULT 0/%d" % max(1, len(checks)))
        sys.exit(1)
