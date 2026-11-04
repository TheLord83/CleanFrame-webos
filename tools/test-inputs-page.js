#!/usr/bin/env node
/* Eingaenge-Seite gegen die Antwort des Fernsehers pruefen.

   Auf dem Pruefstand gibt es kein Luna, also antwortet ein gestellter
   PalmServiceBridge. Die Form der Antwort ist am Geraet abgelesen (LG Nano779PA,
   webOS 6.5): der laufende Eingang traegt "activate": true, ein angeschlossener
   "connected": true, und die leeren Buchsen tragen das Feld "connected" gar
   nicht - nur "id" und "port".

   Genau daran hing der Fehler: `connected: d.connected !== false` machte aus dem
   fehlenden Feld ein "Verbunden", und die Seite behauptete ueber zwei leere
   HDMI-Buchsen, es haenge ein Geraet daran. Auf einem Screenshot sieht "Verbunden"
   plausibel aus - deshalb steht die Pruefung hier und nicht im Auge des Betrachters.

   Aufruf:  node tools/test-inputs-page.js --port 9333 [--hub http://127.0.0.1:8484]
*/
'use strict';
var http = require('http');
var path = require('path');
var APP = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');

var args = process.argv.slice(2);
function opt(name, fallback) {
  var i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
var PORT = Number(opt('port', 9333));
var HUB = opt('hub', 'http://127.0.0.1:8484');

var EIM = {
  returnValue: true,
  devices: [
    { id: 'HDMI_1', label: 'Google OTT', port: 1, activate: true, connected: true, appId: 'com.webos.app.hdmi1', icon: 'streambox.png' },
    { id: 'HDMI_2', port: 2 },
    { id: 'HDMI_3', port: 3 },
    /* Kein HDMI: darf in der Liste nicht auftauchen. */
    { id: 'SIMPLINK', portId: 1, uniqueId: 4, vendorId: 6673, physicalAddress: 4096, depth: 1 },
    { id: 'URCU', serviceType: 'ott', connectedInput: 'HDMI_1' }
  ]
};

var passed = 0, failed = 0;
function check(ok, what, detail) {
  if (ok) { passed++; console.log('  ok    ' + what + (detail ? '   ' + detail : '')); }
  else { failed++; console.log('  FAIL  ' + what + '   ' + (detail || '')); }
}

function hub(path, method) {
  return new Promise(function (resolve, reject) {
    var req = http.request(HUB + path, { method: method || 'GET' }, function (res) {
      var buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve(buf); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  /* Die Tab-Liste kommt von Chrome (Port), nicht vom Hub. */
  var targets = await new Promise(function (resolve, reject) {
    var req = http.request('http://127.0.0.1:' + PORT + '/json/list', function (res) {
      var buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve([]); } });
    });
    req.on('error', reject);
    req.end();
  });
  /* Irgendein Tab genuegt - er wird ohnehin auf die App navigiert. Der Hub muss
   * die App ausliefern, sonst hilft der schoenste Tab nichts. */
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

  /* Der gestellte Luna-Bus muss vor dem Laden der App stehen. */
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.PalmServiceBridge = function () {' +
      '  var self = this;' +
      '  self.call = function (uri, params) {' +
      '    var answer = { returnValue: false, errorText: "nicht gestellt: " + uri };' +
      '    if (/eim\\/getAllInputStatus/.test(uri)) answer = ' + JSON.stringify(EIM) + ';' +
      '    setTimeout(function () { if (self.onservicecallback) self.onservicecallback(JSON.stringify(answer)); }, 0);' +
      '  };' +
      '  self.cancel = function () {};' +
      '};'
  });
  await send('Page.navigate', { url: APP });

  var ready = false;
  for (var i = 0; i < 80 && !ready; i++) {
    await new Promise(function (r) { setTimeout(r, 150); });
    ready = await evaluate('!!(window.CleanFrameDebug && window.CleanFrameDebug.ready && window.CleanFrameDebug.ready())');
  }
  check(ready, 'App ist geladen');
  if (!ready) { ws.close(); process.exit(1); }

  await evaluate("window.CleanFrameDebug.openInputs()");
  for (var j = 0; j < 40; j++) {
    var n = await evaluate('window.CleanFrameDebug.inputsState().length');
    if (n) break;
    await new Promise(function (r) { setTimeout(r, 150); });
  }

  var list = await evaluate('window.CleanFrameDebug.inputsState()');
  var err = await evaluate('window.CleanFrameDebug.inputError()');
  console.log('  liste:', JSON.stringify(list));

  check(Array.isArray(list) && list.length === 3, 'drei HDMI-Eingaenge, kein SIMPLINK/URCU',
    JSON.stringify((list || []).map(function (x) { return x.id; })));
  var one = (list || []).filter(function (x) { return x.n === 1; })[0] || {};
  var two = (list || []).filter(function (x) { return x.n === 2; })[0] || {};
  check(one.label === 'Google OTT', 'HDMI 1 traegt den Geraetenamen', 'label=' + one.label);
  check(one.connected === true, 'HDMI 1 ist als verbunden gemeldet', 'connected=' + one.connected);
  check(one.active === true, 'HDMI 1 ist der laufende Eingang (Feld "activate")', 'active=' + one.active);
  check(two.connected === false, 'HDMI 2 ohne "connected" gilt NICHT als verbunden', 'connected=' + two.connected);
  check(two.active === false, 'HDMI 2 ist nicht aktiv', 'active=' + two.active);
  check(!err, 'kein Fehlerzustand', JSON.stringify(err));

  /* Der gemeldete Zustand muss die Eingaenge mitfuehren - sonst ist am Geraet
   * nicht nachpruefbar, was der Fernseher gesagt hat. Geprueft wird der Aufbau
   * der Meldung, nicht die Zustellung: der Hub weist Schreibversuche von
   * file://-Seiten ausserhalb des Fernsehers mit 403 ab (richtig so), auf dem
   * Pruefstand kommt also nie etwas an. */
  var rep = await evaluate('window.CleanFrameDebug.reportedState()');
  var inj = rep && rep.inputs ? rep.inputs : null;
  check(Array.isArray(inj) && inj.length === 3, 'die Zustandsmeldung fuehrt die Eingaenge mit',
    JSON.stringify(inj));

  ws.close();
  console.log('RESULT ' + passed + '/' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('FEHLER ' + e.message); process.exit(1); });
