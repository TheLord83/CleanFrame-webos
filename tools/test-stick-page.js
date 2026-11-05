#!/usr/bin/env node
/*
 * Die Seite "Sicherung auf Stick" (#16) ohne Fernseher und ohne Stick.
 *
 * Der Hub wird nachgestellt: `window.fetch` antwortet wie der echte, und zwar
 * mit denselben drei Lagen, die es am Geraet gibt - kein Stick, Stick ohne
 * Sicherung, Stick mit Sicherung. Was geprueft wird, ist die Seite: was sie
 * anzeigt, was sie schickt, und ob sie nach dem Sichern und Zurueckspielen den
 * neuen Stand liest statt den alten anzuzeigen.
 *
 *   node tools/test-stick-page.js --port 9333
 */
'use strict';

var http = require('http');

var PORT = 9333;
process.argv.forEach(function (a, i) {
  if (a === '--port') PORT = parseInt(process.argv[i + 1], 10) || PORT;
});

var passed = 0, failed = 0, problems = [];

function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; problems.push(what); console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}

function list() {
  return new Promise(function (resolve, reject) {
    http.get('http://127.0.0.1:' + PORT + '/json/list', function (r) {
      var b = '';
      r.on('data', function (c) { b += c; });
      r.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function main() {
  return list().then(function (tabs) {
    var tab = tabs.filter(function (t) { return t.type === 'page' && /index\.html/.test(t.url); })[0] ||
              tabs.filter(function (t) { return t.type === 'page'; })[0];
    if (!tab) throw new Error('kein Tab auf Port ' + PORT);
    var ws = new WebSocket(tab.webSocketDebuggerUrl);
    var id = 0, waiting = {};

    ws.addEventListener('message', function (e) {
      var m = JSON.parse(e.data);
      if (waiting[m.id]) { waiting[m.id](m.result); delete waiting[m.id]; }
    });

    function evaluate(expr) {
      return new Promise(function (resolve) {
        var n = ++id;
        waiting[n] = function (res) {
          resolve(res && res.result ? res.result.value : undefined);
        };
        ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate',
          params: { expression: expr, returnByValue: true, awaitPromise: true } }));
      });
    }

    return new Promise(function (resolve) { ws.addEventListener('open', resolve); })
      /* Die Pruefung darf nicht davon abhaengen, in welcher Sprache die Seite
       * zufaellig zuletzt stand - sonst ist sie beim naechsten Lauf rot, ohne
       * dass sich etwas geaendert hat. */
      .then(function () { return evaluate("localStorage.setItem('cleanframe.lang', 'de'); true"); })
      .then(function () { return evaluate('location.reload(); true'); })
      .then(function () { return wait(2600); })
      .then(function () { return evaluate('JSON.stringify({lang: (window.CleanFrameI18n || {}).lang || null})'); })
      .then(function (raw) {
        var got = JSON.parse(raw);
        check(got.lang === 'de', 'die Seite steht auf Deutsch', String(got.lang));
      })
      /* Der nachgestellte Hub. Alles, was die Seite fragt, landet im Protokoll -
       * so ist belegbar, dass sie nicht heimlich etwas anderes tut. */
      .then(function () {
        return evaluate(`(function () {
          window.__stick = { calls: [], state: 'none' };
          window.__stickAnswer = function (url, body) {
            var s = window.__stick.state;
            if (url.indexOf('/api/stick/backup') >= 0) {
              if (s !== 'ready' && s !== 'saved') return { ok: false, error: 'kein-stick' };
              window.__stick.state = 'saved';
              return { ok: true, file: 'cleanframe-settings-2026-11-05.json', bytes: 1335,
                       sha256: 'abc', stick: '/tmp/usb/sda1',
                       files: [{ name: 'cleanframe-settings-2026-11-05.json',
                                 savedAt: '2026-11-05T12:22:18.653Z', version: '0.6.48',
                                 bytes: 1335, problem: '' }] };
            }
            if (url.indexOf('/api/stick/restore') >= 0) {
              if (window.__stick.state !== 'saved') return { ok: false, error: 'nicht-gefunden' };
              return { ok: true, restored: true, file: 'cleanframe-settings-2026-11-05.json',
                       exportedAt: '2026-11-05T12:22:18.653Z',
                       config: { schemaVersion: 1, lang: 'de', look: { layout: 'list', apps: 'both' }, home: [] } };
            }
            if (s === 'none') return { ok: true, sticks: [], chosen: null, reason: 'kein-stick', files: [] };
            if (s === 'ready') return { ok: true,
              sticks: [{ path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' }],
              chosen: { path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' },
              reason: '', count: 0, files: [] };
            return { ok: true,
              sticks: [{ path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' }],
              chosen: { path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' },
              reason: '', count: 0,
              files: [{ name: 'cleanframe-settings-2026-11-05.json',
                        savedAt: '2026-11-05T12:22:18.653Z', version: '0.6.48',
                        bytes: 1335, problem: '' }] };
          };
          window.fetch = function (url, opts) {
            var body = (opts && opts.body) || '';
            window.__stick.calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: String(body) });
            var answer = window.__stickAnswer(String(url), body);
            return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(answer); } });
          };
          return true;
        })()`);
      })

      /* ---- 1. Zeile in den Einstellungen */
      .then(function () { return evaluate('window.CleanFrameDebug.openSettings(); true'); })
      .then(function () { return wait(500); })
      .then(function () {
        return evaluate(`JSON.stringify((function () {
          var rows = [].slice.call(document.querySelectorAll('#sheetView [data-id]'));
          var hit = rows.filter(function (r) { return r.getAttribute('data-id') === 'stick'; })[0];
          return { count: rows.length, label: hit ? hit.textContent.replace(/\\s+/g, ' ').trim() : '',
                   actions: rows.map(function (r) { return r.getAttribute('data-id'); }) };
        })())`);
      })
      .then(function (raw) {
        var got = JSON.parse(raw);
        check(got.actions.indexOf('stick') >= 0, 'die Einstellungen haben eine Zeile fuer die Sicherung',
          got.actions.join(','));
      })

      /* ---- 2. Kein Stick: eine Antwort, kein Fehler */
      .then(function () { return evaluate("window.__stick.state = 'none'; window.CleanFrameDebug.openGroup('stick'); true"); })
      .then(function () { return wait(700); })
      .then(function () { return evaluate('JSON.stringify(window.CleanFrameDebug.stickState())'); })
      .then(function (raw) {
        var st = JSON.parse(raw);
        check(st.loaded === true && st.error === '', 'die Seite hat gelesen', JSON.stringify(st.error));
        check(st.chosen === null, 'ohne Stick wird keiner erfunden', JSON.stringify(st.chosen));
        check(st.summary === 'Kein Stick', 'die Zeile sagt "Kein Stick"', st.summary);
      })
      .then(function () {
        return evaluate("JSON.stringify({action: window.CleanFrameDebug.state().action, text: document.getElementById('appearanceRows').innerText.replace(/\\s+/g,' ')})");
      })
      .then(function (raw) {
        var got = JSON.parse(raw);
        check(got.action === 'stick.info', 'der Fokus steht auf der ersten Zeile der Seite, nicht auf dem Rueckweg',
          'action=' + got.action);
        check(/Kein Stick/.test(got.text), 'und nennt den Grund', got.text.slice(0, 80));
        check(/FAT32/.test(got.text), 'mit dem, was man tun kann', got.text.slice(0, 120));
        check(/NTFS/.test(got.text), 'und nennt auch das Format, das der Fernseher selbst einhaengt', got.text.slice(0, 120));
        check(/Sichern|Save/.test(got.text) === false, 'und ohne Knopf, der nichts schreiben koennte',
          got.text.slice(0, 120));
      })
      /* Sichern ohne Stick darf nichts schicken */
      .then(function () { return evaluate('window.CleanFrameDebug.stickSave(); true'); })
      .then(function () { return wait(300); })
      .then(function () { return evaluate('JSON.stringify(window.__stick.calls)'); })
      .then(function (raw) {
        var calls = JSON.parse(raw).filter(function (c) { return /backup/.test(c.url); });
        check(calls.length === 0, 'ohne Stick wird nichts gesichert', String(calls.length) + ' Aufrufe');
      })

      /* ---- 3. Stick da, nichts darauf */
      .then(function () { return evaluate("window.__stick.state = 'ready'; window.CleanFrameDebug.openGroup('stick'); true"); })
      .then(function () { return wait(700); })
      .then(function () { return evaluate('JSON.stringify(window.CleanFrameDebug.stickState())'); })
      .then(function (raw) {
        var st = JSON.parse(raw);
        check(!!st.chosen && st.chosen.path === '/tmp/usb/sda1', 'der Stick wird genannt',
          JSON.stringify(st.chosen));
        check(st.summary === 'Bereit', 'die Zeile sagt "Bereit"', st.summary);
        check(st.files.length === 0, 'noch keine Sicherung', String(st.files.length));
      })
      .then(function () { return evaluate("document.getElementById('appearanceRows').innerText.replace(/\\s+/g,' ')"); })
      .then(function (text) {
        check(/sda1/.test(text), 'die Seite nennt den Stick', String(text).slice(0, 90));
        check(/Jetzt sichern/.test(text), 'und bietet das Sichern an', String(text).slice(0, 120));
        check(/Nichts zum Zur/.test(text), 'und sagt, dass es nichts zurueckzuspielen gibt',
          String(text).slice(0, 160));
      })

      /* ---- 3b. Was die Fusszeile verspricht
       * Dort stand fuer jede Zeile "Am Fernseher oeffnen" - auch fuer Zeilen,
       * die nichts tun und fuer Knoepfe, die schreiben. */
      .then(function () { return evaluate("document.getElementById('appearanceDesc').innerText.replace(/\\s+/g,' ').trim()"); })
      .then(function (text) {
        check(!/ffnen|Open on/.test(String(text)), 'die Fusszeile verspricht kein Oeffnen auf der Stick-Zeile',
          String(text));
      })
      .then(function () { return evaluate("window.CleanFrameDebug.press('down'); true"); })
      .then(function () { return wait(300); })
      .then(function () { return evaluate("document.getElementById('appearanceDesc').innerText.replace(/\\s+/g,' ').trim()"); })
      .then(function (text) {
        check(/Sichern/.test(String(text)), 'auf "Jetzt sichern" sagt sie "Sichern"', String(text));
      })

      /* ---- 4. Sichern */
      .then(function () { return evaluate("window.__stick.calls = []; window.CleanFrameDebug.stickSave(); true"); })
      .then(function () { return wait(900); })
      .then(function () { return evaluate('JSON.stringify({calls: window.__stick.calls, st: window.CleanFrameDebug.stickState()})'); })
      .then(function (raw) {
        var got = JSON.parse(raw);
        var save = got.calls.filter(function (c) { return /\/api\/stick\/backup/.test(c.url); })[0];
        check(!!save, 'das Sichern geht an /api/stick/backup', JSON.stringify(got.calls.map(function (c) { return c.url; })));
        check(save && save.method === 'POST', 'als POST', save ? save.method : '-');
        check(got.st.note.indexOf('cleanframe-settings-2026-11-05.json') >= 0,
          'und die Seite nennt die geschriebene Datei', got.st.note);
        check(got.st.files.length === 1, 'danach steht die Sicherung in der Liste', String(got.st.files.length));
        check(got.st.summary === '05.11.2026', 'die Zeile in den Einstellungen nennt das Datum', got.st.summary);
      })

      /* ---- 4b. Kein Text schreibt ueber den Rand. Am Fernseher stand
       * "Von diesem Stick zurueckspielen - 05.11.2026" quer ueber das Bild. */
      .then(function () {
        return evaluate("JSON.stringify([].slice.call(document.querySelectorAll('#appearanceRows *'))"
          + ".filter(function(e){return e.clientWidth>0 && e.scrollWidth-e.clientWidth>1;})"
          + ".map(function(e){return (e.className||'')+' '+(e.innerText||'').replace(/\\s+/g,' ').slice(0,40);}))");
      })
      .then(function (raw) {
        var over = JSON.parse(raw);
        check(over.length === 0, 'kein Text laeuft aus seiner Zeile heraus', JSON.stringify(over));
      })
      .then(function () { return evaluate("document.getElementById('appearanceRows').innerText.replace(/\\s+/g,' ')"); })
      .then(function (text) {
        var t = String(text);
        check(/Zur\u00fcckspielen/.test(t), 'die Zeile heisst kurz "Zurueckspielen"', t.slice(0, 120));
        check(!/Zur\u00fcckspielen ·/.test(t), 'und traegt das Datum nicht im Knopf', t.slice(0, 120));
        check(/Sicherung vom/.test(t), 'das Datum steht als Grund darunter', t.slice(0, 160));
      })

      /* ---- 5. Zurueckspielen */
      .then(function () { return evaluate("window.__stick.calls = []; window.CleanFrameDebug.stickRestore(); true"); })
      .then(function () { return wait(1000); })
      .then(function () { return evaluate('JSON.stringify({calls: window.__stick.calls, st: window.CleanFrameDebug.stickState()})'); })
      .then(function (raw) {
        var got = JSON.parse(raw);
        var back = got.calls.filter(function (c) { return /\/api\/stick\/restore/.test(c.url); })[0];
        check(!!back, 'das Zurueckspielen geht an /api/stick/restore',
          JSON.stringify(got.calls.map(function (c) { return c.url; })));
        check(back && back.body.indexOf('cleanframe-settings-2026-11-05.json') >= 0,
          'und nennt die Datei in der Anfrage', back ? back.body.slice(0, 90) : '-');
        check(/Zur/.test(got.st.note) && /cleanframe-settings/.test(got.st.note),
          'die Seite meldet das Zurueckspielen', got.st.note);
        var look = JSON.parse(got.calls.length ? 'null' : 'null');
      })

      /* ---- 6. Kaputte Sicherung: angeboten, aber nicht blind eingespielt */
      .then(function () {
        return evaluate(`window.CleanFrameDebug.stickSet({ sticks: [{ path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' }],
          chosen: { path: '/tmp/usb/sda1', label: 'sda1', fstype: 'vfat' }, reason: '',
          files: [{ name: 'cleanframe-settings-1999-01-02.json', savedAt: '1999-01-02T00:00:00Z', bytes: 12, problem: 'unlesbar' }] }); true`);
      })
      .then(function () { return wait(400); })
      .then(function () { return evaluate("document.getElementById('appearanceRows').innerText.replace(/\\s+/g, ' ')"); })
      .then(function (text) {
        check(/l\u00e4sst sich nicht lesen/.test(String(text)), 'eine kaputte Sicherung wird als solche benannt',
          String(text).slice(0, 160));
      })
      .then(function () { return evaluate("window.__stick.calls = []; window.CleanFrameDebug.stickRestore(); true"); })
      .then(function () { return wait(400); })
      .then(function () { return evaluate('JSON.stringify(window.__stick.calls)'); })
      .then(function (raw) {
        var calls = JSON.parse(raw).filter(function (c) { return /restore/.test(c.url); });
        check(calls.length === 0, 'und nicht eingespielt', String(calls.length) + ' Aufrufe');
      })

      .then(function () {
        console.log('');
        console.log('passed ' + passed + ', failed ' + failed);
        if (failed) { console.log('RESULT ' + passed + '/' + (passed + failed)); ws.close(); process.exit(1); }
        console.log('RESULT ' + passed + '/' + passed);
        ws.close();
        process.exit(0);
      });
  }).catch(function (e) {
    console.log('FEHLER ' + e.message);
    process.exit(2);
  });
}

main();
