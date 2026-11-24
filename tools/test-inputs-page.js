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

  /* ---- Die Seite ist eine Liste mit Vorschau-Spalte, kein Aufklapp-Feld ----
   * Vorher war der markierte Eingang ein Picker: eine zugeklappte Zeile, hinter
   * der die anderen Buchsen verschwanden. Geprueft wird jetzt die Form der
   * Seite, damit der Rueckfall nicht unbemerkt zurueckkommt. */
  await evaluate("window.CleanFrameDebug.openInputs()");
  await new Promise(function (r) { setTimeout(r, 400); });
  console.log('  debug:', await evaluate("JSON.stringify({view:(CleanFrameDebug.state?CleanFrameDebug.state().view:'?'),list:((document.querySelector('.in-list')||{}).innerText||'').slice(0,80),err:JSON.stringify(CleanFrameDebug.inputError?CleanFrameDebug.inputError():null)})"));
  for (var k = 0; k < 40; k++) {
    var rows = await evaluate("document.querySelectorAll('.in-row').length");
    if (rows) break;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  var shape = await evaluate("JSON.stringify((function(){" +
    "var l=document.querySelector('.in-list'), s=document.querySelector('.in-side')," +
    " rows=[].slice.call(document.querySelectorAll('.in-row'));" +
    "var lb=l?l.getBoundingClientRect():null, sb=s?s.getBoundingClientRect():null;" +
    "return {rows:rows.length, listLeft:lb?Math.round(lb.left):null, listRight:lb?Math.round(lb.right):null," +
    " sideLeft:sb?Math.round(sb.left):null, sideText:(s?s.innerText:'').replace(/\\n/g,' ')," +
    " picker:document.querySelectorAll('.pick-row,.setting-section.is-picker').length," +
    " states:rows.map(function(r){return (r.querySelector('.in-state')||{}).innerText;})," +
    " overflow:[].slice.call(document.querySelectorAll('.in-row,.in-side,.in-name,.in-device'))" +
    ".filter(function(e){return e.scrollWidth>e.clientWidth+2;}).length" +
    "};})())");
  var sh = JSON.parse(shape || '{}');
  check(sh.rows === 3, 'drei Zeilen in der Liste', 'rows=' + sh.rows);
  check(sh.picker === 0, 'kein Aufklapp-Feld mehr auf der Seite', 'picker=' + sh.picker);
  check(typeof sh.listLeft === 'number' && typeof sh.sideLeft === 'number' && sh.sideLeft > sh.listRight,
    'Liste links, Vorschau-Spalte rechts daneben', 'list=' + sh.listRight + ' side=' + sh.sideLeft);
  check(/HDMI 1/.test(String(sh.sideText)) && /Google OTT/.test(String(sh.sideText)),
    'rechts steht der markierte Eingang', String(sh.sideText).slice(0, 60));
  /* "Zuletzt gewaehlt", nicht "Laeuft gerade": der Fernseher meldet den Eingang
   * unter dem Launcher weiter als aktiv, sehen kann man ihn aber nicht. */
  check(Array.isArray(sh.states) && sh.states[0] === 'Zuletzt gewählt' && sh.states[1] === 'Kein Gerät',
    'jede Zeile traegt ihren Zustand', JSON.stringify(sh.states));

  /* Der eigentliche Fehler: ein Druck auf OK beim "aktiven" Eingang wurde mit
   * "laeuft bereits" abgewiesen - deshalb war HDMI 1 nicht umschaltbar. Der
   * Test haelt fest, dass OK wirklich schaltet. */
  var switched = await evaluate("(async function () {" +
    "  window.__sw = null;" +
    "  window.FrameDevice.setSource = function (n, cb) { window.__sw = n; if (cb) cb(null); };" +
    "  window.CleanFrameDebug.press('ok');" +
    "  await new Promise(function (r) { setTimeout(r, 400); });" +
    "  return window.__sw;" +
    "})()");
  check(switched === 1, 'OK auf dem laufenden Eingang schaltet um, statt abzuweisen', 'setSource=' + switched);
  check(sh.overflow === 0, 'kein Text laeuft aus seiner Zeile', 'overflow=' + sh.overflow);

  /* Farbe und Abstand: die Nummer war gruen hinterlegt und der Text klebte an
   * ihr. Geprueft werden die gerechneten Werte, nicht der Quelltext. */
  var look = JSON.parse(await evaluate("JSON.stringify((function(){" +
    "var n=document.querySelector('.in-row .in-num'), c=document.querySelector('.in-row .in-copy')," +
    " st=document.querySelector('.in-row.is-active .in-state');" +
    "if(!n||!c) return {};" +
    "var bg=getComputedStyle(n).backgroundColor, col=getComputedStyle(n).color," +
    " stc=st?getComputedStyle(st).color:'', nb=n.getBoundingClientRect(), cb=c.getBoundingClientRect();" +
    "function hue(rgb){var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb)||[];var r=+m[1]||0,g=+m[2]||0,b=+m[3]||0;" +
    "return Math.max(r,g,b)-Math.min(r,g,b);}" +
    "return {bgHue:hue(bg), numHue:hue(col), stateHue:stc?hue(stc):0, gap:Math.round(cb.left-nb.right)};})())"));
  check((look.bgHue || 0) <= 12, 'die Nummer sitzt auf einer neutralen Flaeche, nicht auf Gruen', 'hue=' + look.bgHue);
  /* Der Text ist die helle Grundfarbe des Launchers (leicht warm, Hue ~15) -
   * "neutral" heisst hier: nicht farbig gesetzt, also derselbe Ton wie die
   * Ueberschrift. Verglichen wird deshalb mit der Textfarbe der Seite. */
  var page = JSON.parse(await evaluate("JSON.stringify((function(){" +
    "function hue(rgb){var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb)||[];var r=+m[1]||0,g=+m[2]||0,b=+m[3]||0;" +
    "return Math.max(r,g,b)-Math.min(r,g,b);}" +
    "var t=document.querySelector('.s-title');" +
    "return {pageHue:t?hue(getComputedStyle(t).color):0, pageCol:t?getComputedStyle(t).color:''};})())"));
  check(look.numHue === page.pageHue, 'die Nummer traegt die normale Textfarbe, keine eigene', 'num=' + look.numHue + ' seite=' + page.pageHue);
  check(look.stateHue === page.pageHue, 'auch der Zustand des laufenden Eingangs ist nicht eingefaerbt', 'state=' + look.stateHue + ' seite=' + page.pageHue);
  check((look.gap || 0) >= 24, 'zwischen Nummer und Text ist Luft', 'gap=' + look.gap);

  /* Ein Bild der Seite fuer die Ablage; der Screenshot ist Beleg, nicht Pruefung. */
  var shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  if (shot && shot.data) require('fs').writeFileSync('/root/.hermes/cache/scratch/inputs-page.png', Buffer.from(shot.data, 'base64'));

  ws.close();
  console.log('RESULT ' + passed + '/' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('FEHLER ' + e.message); process.exit(1); });
