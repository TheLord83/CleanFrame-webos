#!/usr/bin/env node
/* Tempo-Seite: misst sie wirklich, was draufsteht?

   Roadmap #12: bisher stand im Projekt nur "fuehlt sich fluessig an", und das
   ist keine Messung. Die Seite misst drei Dinge auf dem Geraet - Bildzeit,
   Tastenverzoegerung, Zeit seit dem Start. Geprueft wird hier:

   1. Die Seite hat die drei Zeilen und keine vierte Behauptung.
   2. Die Bildzeit wird wirklich gemessen (Median > 0, fps > 0, genug Proben).
   3. Ein Tastendruck landet in der Messung, und OK auf der Zeile leert sie.
   4. "Noch nicht gemessen" ist der ehrliche Zustand vor der ersten Messung -
      keine erfundene Zahl.
   5. Der Startzeitpunkt wird beim ersten Bild gesetzt, nicht bei 0 gelassen.

   Aufruf: node tools/test-speed-page.js --port 9333
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

  await send('Page.enable');
  await send('Page.navigate', { url: APP });
  var ready = false;
  for (var i = 0; i < 80 && !ready; i++) {
    await new Promise(function (r) { setTimeout(r, 150); });
    ready = await evaluate('!!(window.CleanFrameDebug && window.CleanFrameDebug.ready && window.CleanFrameDebug.ready())');
  }
  check(ready, 'App ist geladen');
  if (!ready) { ws.close(); process.exit(1); }

  /* 1. Vor der ersten Messung: ehrlicher Zustand, keine Zahl. */
  await evaluate('window.CleanFrameDebug.openSpeed()');
  await new Promise(function (r) { setTimeout(r, 250); });
  var before = await evaluate('window.CleanFrameDebug.speedState()');
  var text = await evaluate('(document.body.innerText || document.body.textContent || "")');
  check(before && before.rows === 4, 'die Seite hat drei Zeilen und den Rueckweg', 'rows=' + (before && before.rows));
  check(/Bildzeit/.test(text) && /Tastenverzögerung/.test(text) && /Seit dem Start/.test(text),
    'die drei Messungen stehen drauf', text.slice(0, 80).replace(/\s+/g, ' '));
  check(before && before.frames === null && before.values.frames === 'noch nicht gemessen',
    'ohne Messung steht "noch nicht gemessen"', before && before.values.frames);

  /* 3. Bildzeit wirklich messen. */
  var f = await evaluate('window.CleanFrameDebug.measureFramesNow(400)');
  check(f && f.median > 0, 'der Median ist gemessen, nicht erfunden', f && ('median=' + Math.round(f.median * 10) / 10 + ' ms'));
  check(f && f.fps > 0 && f.fps < 1000, 'die Bilder pro Sekunde sind plausibel', f && Math.round(f.fps) + '/s');
  check(f && f.samples >= 5, 'genug Proben fuer einen Median', f && ('samples=' + f.samples));
  var after = await evaluate('window.CleanFrameDebug.speedState()');
  check(after && /ms/.test(after.values.frames), 'die Zeile zeigt danach eine Zeit', after && after.values.frames);

  /* 4. Tastendruck landet in der Messung, OK auf der Zeile leert sie. */
  /* Fokus auf die Zeile "Tastenverzoegerung": die Seite beginnt auf "Bildzeit",
   * ein Schritt nach unten ist diese Zeile. */
  await evaluate('window.CleanFrameDebug.press("down")');
  await new Promise(function (r) { setTimeout(r, 150); });
  var onKeys = await evaluate('window.CleanFrameDebug.state().action');
  check(onKeys === 'speed.keys', 'der Fokus steht auf der Zeile fuer die Tasten', onKeys);
  /* Ein Tastendruck, der auf dieser Seite nichts verschiebt: links. Ein Pfeil
   * nach unten waere selbst ein Seitenwechsel und wuerde den Fokus mitnehmen. */
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {keyCode: 37, bubbles: true}))');
  await new Promise(function (r) { setTimeout(r, 250); });
  var keys = await evaluate('window.CleanFrameDebug.speedState()');
  check(keys && keys.keys.length >= 1, 'ein Tastendruck wird gemessen', keys && JSON.stringify(keys.keys));
  check(keys && /ms/.test(keys.values.keys), 'die Zeile zeigt die Tastenverzoegerung', keys && keys.values.keys);
  await evaluate('window.CleanFrameDebug.press("ok")');
  await new Promise(function (r) { setTimeout(r, 250); });
  /* Der Druck auf OK wird selbst wieder gemessen - die alte Messreihe muss aber
   * weg sein, und die Seite muss sagen, was jetzt zu tun ist. */
  var cleared = await evaluate('window.CleanFrameDebug.speedState()');
  var hint = await evaluate('(document.body.innerText || "")');
  check(cleared && cleared.keys.length === 0, 'OK verwirft die alte Messreihe', cleared && JSON.stringify(cleared.keys));
  check(/Jetzt ein paar Tasten drücken|noch nicht gemessen/.test(hint), 'die Seite sagt, was jetzt zu tun ist');

  /* 5. Startzeit: beim ersten Bild gesetzt. */
  check(after && after.since > 0, 'der Startzeitpunkt ist gesetzt', after && Math.round(after.since) + ' ms');
  check(after && /s$/.test(after.values.since), 'die Zeile zeigt Sekunden', after && after.values.since);

  /* 6. Was auf der Seite steht, steht auch in der Meldung. */
  await evaluate('window.CleanFrameDebug.measureFramesNow(400)');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {keyCode: 37, bubbles: true}))');
  await new Promise(function (r) { setTimeout(r, 200); });
  await evaluate('window.CleanFrameDebug.closeSheet()');
  await evaluate('window.CleanFrameDebug.openSpeed()');
  await new Promise(function (r) { setTimeout(r, 200); });
  var rep = await evaluate('window.CleanFrameDebug.reportedState()');
  check(rep && rep.speed && /ms/.test(rep.speed.frames) && /ms/.test(rep.speed.keys),
    'die Meldung fuehrt die Tempo-Werte mit', rep && JSON.stringify(rep.speed));

  ws.close();
  console.log('RESULT ' + passed + '/' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('FEHLER ' + e.message); process.exit(1); });
