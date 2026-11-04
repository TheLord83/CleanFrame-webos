#!/usr/bin/env python3
"""Prueft /api/net: welche Adresse der Hub einem Handy anbietet.

    python3 tools/check-net-endpoint.py

Der QR-Code der Einrichtung zeigt auf diese Adresse. Zwei Fehler sind hier schon
passiert, beide unsichtbar fuer die Oberflaeche:

* Eine Adresse, mit der ein Handy im selben Netz nichts anfangen kann
  (127.0.0.1, 169.254.x.x) - der Code waere dann ein Versprechen, das nicht
  eingehalten wird.
* `os` wurde in einer anderen Funktion als `var os = info.os` benutzt und
  verschattete damit das Modul; /api/net antwortete mit einem 500er statt einer
  Adresse. Deshalb fragt dieser Test den laufenden Server, nicht die Funktion.

Gestartet wird ein eigener Hub auf einem freien Port; er wird am Ende beendet.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXIT_SKIP = 2


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def local_ipv4():
    """Erste eigene LAN-Adresse, ohne Verkehr zu erzeugen."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 9))          # RFC 5737, wird nicht geroutet
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ''


def usable(ip):
    if not isinstance(ip, str):
        return False
    parts = ip.split('.')
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return False
    return not (ip.startswith('127.') or ip.startswith('169.254.'))


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())


def main():
    port = free_port()
    env = dict(os.environ, CF_PORT=str(port))
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'web', 'server.js')], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            cwd=ROOT)
    passed = failed = 0
    problems = []

    def check(ok, what, detail=''):
        nonlocal passed, failed
        if ok:
            passed += 1
            print('  ok    %s%s' % (what, ('   ' + detail) if detail else ''))
        else:
            failed += 1
            problems.append(what)
            print('  FAIL  %s   %s' % (what, detail))

    try:
        base = 'http://127.0.0.1:%d' % port
        up = False
        for _ in range(60):
            try:
                get(base + '/api/health')
                up = True
                break
            except Exception:
                time.sleep(0.25)
        check(up, 'Hub startet auf Port %d' % port)
        if not up:
            return 1

        lan = local_ipv4()
        if not lan or not usable(lan):
            print('SKIP keine LAN-Adresse auf dieser Maschine (nur Loopback)')
            print('RESULT 0/0 skip')
            return EXIT_SKIP

        answer = get(base + '/api/net')
        check(answer.get('ok') is True, 'die Antwort ist in Ordnung', json.dumps(answer)[:120])
        check(answer.get('port') == port, 'der Port stimmt', str(answer.get('port')))
        check(usable(answer.get('address')), 'die angebotene Adresse ist im LAN nutzbar',
              str(answer.get('address')))
        check(answer.get('address') == lan, 'es ist die Adresse dieser Maschine',
              '%s (erwartet %s)' % (answer.get('address'), lan))

        via_lan = get('http://%s:%d/api/net' % (lan, port))
        check(via_lan.get('address') == lan, 'auch ueber die LAN-Adresse gefragt kommt sie',
              str(via_lan.get('address')))

        addrs = [a.get('address') for a in (answer.get('addresses') or [])]
        check(len(addrs) == len(set(addrs)), 'keine Adresse doppelt', json.dumps(addrs))
        check(not any(a.startswith('127.') or a.startswith('169.254.') for a in addrs),
              'weder Loopback noch 169.254 in der Liste', json.dumps(addrs))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print('RESULT %d/%d' % (passed, passed + failed))
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
