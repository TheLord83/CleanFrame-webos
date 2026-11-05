#!/usr/bin/env node
/* Jede Einstellungsseite beginnt auf ihrer ersten Zeile.

   Am Geraet gemessen: "Uhr und Sprache" ging mit dem Fokus auf der ZWEITEN
   Zeile auf (Language statt Clock), die Eingaenge mit dem Fokus auf dem
   Zurueck-Knopf. Ursache: `openAppearance()` hat fuer Seiten ohne Achse keinen
   ersten Eintrag und fiel auf 'samsung.home' zurueck, das es auf diesen Seiten
   nicht gibt - der Fokus landete irgendwo, nur nicht oben.

   Eine Seite, die nicht oben anfaengt, sieht aus wie eine, die nicht reagiert:
   der erste Tastendruck tut etwas anderes als erwartet. Deshalb fuer jede Zeile
   der Uebersicht ein Fall: Seite oeffnen, Zeile und Aktion lesen.

   Aufruf: node tools/test-page-entry.js --port 9333
*/
'use strict';
var http = require('http');
var path = require('path');

var args = process.argv.slice(2);
function opt(name, fallback) {
  var i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
var PORT = Number(opt('port', 9333));
var APP = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');

var passed = 0, failed = 0;
function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}

/* Seiten, die keine Auswahlliste sind: sie duerfen eine andere Ansicht oeffnen,
 * aber keine darf auf dem Zurueck-Knopf stehen bleiben. */
var NOT_LISTS = { editor: 'editor', ent: 'entities', setup: 'message' };

function cdp() {
  return new Promise(function (resolve, reject) {
    var req = http.request('http://127.0.0.1:' + PORT + '/json/list', function (res) {
      var buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve([]); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  var targets = await cdp();
  var pages = (Array.isArray(targets) ? targets : []).filter(function (t) { return t.type === 'page'; });
  var page = pages.filter(function (t) { return /^http/.test(t.url); })[0] || pages[0];
  if (!page) throw new Error('kein Tab am Pruefstand (Port ' + PORT + ')');

  var ws = new WebSocket(page.webSocketDebuggerUrl);
  var id = 0, waiting = {};
  ws.addEventListener('message', function (ev) {
    var msg = JSON.parse(ev.data);
    if (msg.id && waiting[msg.id]) { waiting[msg.id](msg.result); delete waiting[msg.id]; }
  });
  await new Promise(function (r) { ws.addEventListener('open', r); });
  function send(method, params) {
    return new Promise(function (resolve) {
      var n = ++id;
      waiting[n] = resolve;
      ws.send(JSON.stringify({ id: n, method: method, params: params || {} }));
    });
  }
  async function evaluate(expression) {
    var r = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || 'JS-Fehler');
    return r && r.result ? r.result.value : undefined;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  await send('Page.enable');
  await send('Page.navigate', { url: APP });
  var ready = false;
  for (var i = 0; i < 80 && !ready; i++) {
    await wait(150);
    ready = await evaluate('!!(window.CleanFrameDebug && window.CleanFrameDebug.ready && window.CleanFrameDebug.ready())');
  }
  check(ready, 'App ist geladen');
  if (!ready) { ws.close(); process.exit(1); }

  var ids = await evaluate('window.CleanFrameDebug.settingsIds()');
  check(Array.isArray(ids) && ids.length >= 10, 'die Uebersicht hat ihre Zeilen', JSON.stringify(ids));

  /* Diese Seiten sind Auswahllisten: sie muessen auf Zeile 1 aufgehen - Zeile 0
   * ist der Rueckweg. */
  for (var n = 0; n < ids.length; n++) {
    var gid = ids[n];
    var out = await evaluate('JSON.stringify(window.CleanFrameDebug.openGroup(' + JSON.stringify(gid) + '))');
    await wait(320);
    var st = await evaluate('window.CleanFrameDebug.state()');
    var opened = JSON.parse(out || '{}');
    if (NOT_LISTS[gid]) {
      check(st && st.view !== 'settings',
        gid + ': Seite oeffnet',
        'view=' + (st && st.view) + ' erwartet=' + NOT_LISTS[gid]);
      continue;
    }
    var row = opened && opened.row;
    var action = (st && st.action) || '';
    check(row === 1, gid + ': beginnt auf der ersten Zeile', 'row=' + row);
    check(action !== 'settings.back' && action !== '',
      gid + ': der Fokus steht auf einem Eintrag der Seite', 'action=' + action);
  }

  /* Und die Gegenprobe fuer die zwei gemeldeten Faelle: die Aktion der ersten
   * Zeile ist die, die auch im Bericht steht. */
  var clock = JSON.parse(await evaluate('JSON.stringify(window.CleanFrameDebug.openGroup("clocklang"))') || '{}');
  await wait(320);
  var clockState = await evaluate('window.CleanFrameDebug.state()');
  check(clock && clock.row === 1 && clockState.action === 'pick.clock',
    'Uhr und Sprache beginnt auf der Zeile "Uhr"', 'row=' + (clock && clock.row) + ' action=' + (clockState && clockState.action));
  var ins = JSON.parse(await evaluate('JSON.stringify(window.CleanFrameDebug.openGroup("inputs"))') || '{}');
  await wait(320);
  var insState = await evaluate('window.CleanFrameDebug.state()');
  check(ins && ins.row === 1, 'die Eingaenge beginnen auf der Eingangsliste', 'row=' + (ins && ins.row));
  check((insState && insState.action) !== 'settings.back', 'die Eingaenge beginnen nicht auf dem Rueckweg',
    'action=' + (insState && insState.action));

  console.log('RESULT ' + passed + '/' + (passed + failed));
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('FEHLER: ' + (e && e.message));
  console.log('RESULT ' + passed + '/' + (passed + failed + 1));
  process.exit(1);
});
