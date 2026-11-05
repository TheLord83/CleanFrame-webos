#!/usr/bin/env python3
"""Sicherung auf Stick (#16): der Hub schreibt eine Datei auf einen Stick und
liest sie zurueck.

    python3 tools/test-stick-api.py

Der Pruefstand hat keinen USB-Anschluss. `CF_STICK` zeigt auf ein Verzeichnis,
das den Stick nachstellt; der Hub nimmt genau denselben Weg wie am Fernseher
(`stick.sticks()` -> `stick.pick()` -> `stick.write()`), nur die Fundstelle ist
eine andere. Was hier geprueft wird, ist deshalb die ganze Kette und nicht ein
Sonderweg: kein Stick ist eine Antwort und kein Fehler, eine Sicherung ist eine
Datei mit Namen/Datum/Pruefsumme, das Zurueckspielen setzt die Werte wieder,
und fremder oder kaputter Inhalt wird mit Grund abgelehnt.
"""
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXIT_SKIP = 2


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def call(url, data=None, timeout=15):
    """Antwort und Statuscode, auch bei 4xx - sonst waere jeder Fehlerfall ein
    Absturz im Test statt einer Pruefung."""
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={'Content-Type': 'application/json'},
                                 method=('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), r.status
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()), e.code
        except Exception:
            return {}, e.code


def main():
    port = free_port()
    work = tempfile.mkdtemp(prefix='cf-stick-')
    cfg_path = os.path.join(work, 'config.json')
    stick_dir = os.path.join(work, 'stick')
    os.makedirs(stick_dir)
    env = dict(os.environ, CF_PORT=str(port), CF_CONFIG=cfg_path, CF_STICK=stick_dir)
    env.pop('CF_TV', None)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'web', 'server.js')], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT)

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
        for _ in range(80):
            try:
                call(base + '/api/health', timeout=3)
                up = True
                break
            except Exception:
                time.sleep(0.25)
        check(up, 'Hub startet auf Port %d' % port)
        if not up:
            return 1

        # ---- 1. Die Lage ohne Sicherung
        got, code = call(base + '/api/stick')
        check(code == 200 and got.get('ok') is True, 'der Stick-Bericht antwortet', str(code))
        check(len(got.get('sticks') or []) == 1, 'genau ein Stick wird gefunden',
              json.dumps(got.get('sticks')))
        check((got.get('chosen') or {}).get('path') == stick_dir,
              'der gefundene Stick ist der eingerichtete', str((got.get('chosen') or {}).get('path')))
        check(got.get('files') == [], 'noch keine Sicherung darauf', json.dumps(got.get('files')))
        check(got.get('reason') == '', 'kein Grund zurueckgehalten', repr(got.get('reason')))

        # ---- 2. Etwas einstellen, das in der Sicherung stehen muss
        conf, _ = call(base + '/api/config')
        conf = conf.get('config') or conf
        token = 'ha-test-token-123'
        conf.setdefault('integrations', {}).setdefault('ha', {})['url'] = 'http://192.168.0.5:8123'
        conf['integrations']['ha']['token'] = token
        conf['lang'] = 'en'
        put, code = call(base + '/api/config', conf)
        check(code == 200 and (put.get('ok') is True), 'die Einstellung ist gespeichert', str(code))

        # ---- 3. Sichern
        saved, code = call(base + '/api/stick/backup', {})
        check(code == 200 and saved.get('ok') is True, 'die Sicherung laeuft durch',
              json.dumps(saved)[:160])
        name = saved.get('file') or ''
        check(name.startswith('cleanframe-settings-') and name.endswith('.json'),
              'die Datei hat den vereinbarten Namen', name)
        full = os.path.join(stick_dir, name)
        check(os.path.isfile(full), 'die Datei liegt auf dem Stick', full)
        check(not os.path.exists(full + '.tmp'), 'keine halbe Datei daneben', full + '.tmp')

        raw = open(full, 'rb').read()
        check(saved.get('bytes') == len(raw), 'die gemeldete Groesse stimmt',
              '%s vs %s' % (saved.get('bytes'), len(raw)))
        import hashlib
        check(saved.get('sha256') == hashlib.sha256(raw).hexdigest(), 'die Pruefsumme stimmt',
              str(saved.get('sha256'))[:16])
        mode = stat.S_IMODE(os.stat(full).st_mode)
        check(mode == 0o600, 'die Datei ist nur fuer root lesbar', oct(mode))

        payload = json.loads(raw.decode())
        check(payload.get('kind') == 'cleanframe-backup', 'die Datei nennt sich Sicherung',
              str(payload.get('kind')))
        check(int(payload.get('schemaVersion') or 0) >= 1, 'sie traegt eine Fassung',
              str(payload.get('schemaVersion')))
        check(bool(payload.get('exportedAt')), 'sie traegt einen Zeitpunkt', str(payload.get('exportedAt')))
        check(payload.get('version') == open(os.path.join(ROOT, 'VERSION')).read().strip(),
              'sie traegt die Programmfassung', str(payload.get('version')))
        # Der Grund, warum es diese Sicherung gibt: ohne Token waere sie unbrauchbar.
        check(((payload.get('config') or {}).get('integrations', {}).get('ha', {}) or {}).get('token') == token,
              'die Zugangsdaten sind enthalten (sonst waere die Sicherung wertlos)')

        got, _ = call(base + '/api/stick')
        files = got.get('files') or []
        check(len(files) == 1, 'der Bericht listet die Sicherung', json.dumps(files)[:160])
        check((files[0] or {}).get('problem') == '', 'und nennt kein Problem', str((files[0] or {}).get('problem')))
        check((files[0] or {}).get('version') == payload.get('version'), 'mit der Fassung darin',
              str((files[0] or {}).get('version')))

        # ---- 4. Verstellen und zurueckspielen
        conf2, _ = call(base + '/api/config')
        conf2 = conf2.get('config') or conf2
        conf2['lang'] = 'de'
        call(base + '/api/config', conf2)
        now, _ = call(base + '/api/config')
        check((now.get('config') or now).get('lang') == 'de', 'die Verstellung sitzt',
              str((now.get('config') or now).get('lang')))

        back, code = call(base + '/api/stick/restore', {'name': name})
        check(code == 200 and back.get('ok') is True, 'das Zurueckspielen laeuft durch',
              json.dumps(back)[:160])
        check(back.get('file') == name, 'und nennt die Datei', str(back.get('file')))
        after, _ = call(base + '/api/config')
        after = after.get('config') or after
        check(after.get('lang') == 'en', 'die Sprache ist wieder die gesicherte', str(after.get('lang')))
        # /api/config ist geschwaerzt (jeder im LAN darf es lesen) - ob das Token
        # zurueckkam, steht nur in der Datei auf dem Fernseher.
        on_disk = json.load(open(cfg_path))
        check(((on_disk.get('integrations') or {}).get('ha') or {}).get('token') == token,
              'die Zugangsdaten sind wieder da', str(((on_disk.get('integrations') or {}).get('ha') or {}).get('token'))[:12])

        # ---- 5. Fremde und kaputte Dateien
        bad = os.path.join(stick_dir, 'cleanframe-settings-1999-01-01.json')
        open(bad, 'w').write('{"kind":"etwas-anderes","config":{}}')
        broken = os.path.join(stick_dir, 'cleanframe-settings-1999-01-02.json')
        open(broken, 'w').write('{kaputt')
        strange = os.path.join(stick_dir, 'urlaub.jpg')
        open(strange, 'w').write('kein json')

        got, _ = call(base + '/api/stick')
        files = {f.get('name'): f for f in (got.get('files') or [])}
        check('urlaub.jpg' not in files, 'was nicht so heisst, wird nicht als Sicherung gezaehlt',
              json.dumps(sorted(files)))
        check((files.get(os.path.basename(bad)) or {}).get('problem') == 'keine-cleanframe-sicherung',
              'fremder Inhalt wird als solcher benannt',
              str((files.get(os.path.basename(bad)) or {}).get('problem')))
        check((files.get(os.path.basename(broken)) or {}).get('problem') == 'unlesbar',
              'kaputter Inhalt wird als unlesbar benannt',
              str((files.get(os.path.basename(broken)) or {}).get('problem')))

        res, code = call(base + '/api/stick/restore', {'name': os.path.basename(bad)})
        check(code == 400 and res.get('ok') is not True, 'fremde Datei wird nicht eingespielt',
              '%s %s' % (code, res.get('error')))
        res, code = call(base + '/api/stick/restore', {'name': os.path.basename(broken)})
        check(code == 400 and res.get('ok') is not True, 'kaputte Datei wird nicht eingespielt',
              '%s %s' % (code, res.get('error')))
        res, code = call(base + '/api/stick/restore', {'name': '../../../etc/passwd'})
        check(code == 400 and res.get('ok') is not True, 'ein Pfad statt eines Namens wird abgelehnt',
              '%s %s' % (code, res.get('error')))

        newer = os.path.join(stick_dir, 'cleanframe-settings-1999-01-03.json')
        json.dump({'kind': 'cleanframe-backup', 'schemaVersion': 99, 'config': {'lang': 'de', 'schemaVersion': 99}},
                  open(newer, 'w'))
        res, code = call(base + '/api/stick/restore', {'name': os.path.basename(newer)})
        check(code == 400 and res.get('error') == 'juengere-fassung',
              'eine juengere Fassung wird abgelehnt statt halb eingespielt',
              '%s %s' % (code, res.get('error')))
        now, _ = call(base + '/api/config')
        check((now.get('config') or now).get('lang') == 'en',
              'nach den Fehlversuchen steht die Konfiguration unveraendert',
              str((now.get('config') or now).get('lang')))

        # ---- 6. Kein Stick ist eine Antwort, kein Fehler
        proc.terminate()
        proc.wait(timeout=10)
        empty = os.path.join(work, 'kein-stick-hier')
        port2 = free_port()
        env2 = dict(env, CF_STICK=empty, CF_PORT=str(port2))
        proc = subprocess.Popen(['node', os.path.join(ROOT, 'web', 'server.js')], env=env2,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT)
        base2 = 'http://127.0.0.1:%d' % port2
        for _ in range(80):
            try:
                call(base2 + '/api/health', timeout=3)
                break
            except Exception:
                time.sleep(0.25)
        got, code = call(base2 + '/api/stick')
        check(code == 200, 'auch ohne Stick antwortet der Bericht', str(code))
        check(got.get('sticks') == [] and got.get('chosen') is None,
              'ohne Stick wird keiner erfunden', json.dumps(got.get('sticks')))
        check(got.get('reason') == 'kein-stick', 'und der Grund heisst so', repr(got.get('reason')))
        res, code = call(base2 + '/api/stick/backup', {})
        check(code == 409 and res.get('ok') is not True, 'Sichern ohne Stick wird abgelehnt',
              '%s %s' % (code, res.get('error')))
        res, code = call(base2 + '/api/stick/restore', {'name': 'cleanframe-settings-2026-01-01.json'})
        check(code == 409 and res.get('ok') is not True, 'Zurueckspielen ohne Stick auch',
              '%s %s' % (code, res.get('error')))
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            pass
        shutil.rmtree(work, ignore_errors=True)

    print()
    print('passed %d, failed %d' % (passed, failed))
    if failed:
        print('RESULT %d/%d' % (passed, passed + failed))
        return 1
    print('RESULT %d/%d' % (passed, passed))
    return 0


if __name__ == '__main__':
    sys.exit(main())
