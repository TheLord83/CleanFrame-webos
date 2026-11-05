#!/usr/bin/env node
/* Mit dem Fernseher starten (Roadmap #15): webOS-Activities.

   Das ist der billige Teil des Home-Takeovers und der Grund, ihn zuerst zu
   bauen: webOS fuehrt Activities selbst aus, es wird nichts gemountet und
   nichts gestoppt. Ein falscher Eintrag heisst "die App geht nicht auf", nicht
   "der Fernseher hat keinen Startbildschirm".

   Geprueft wird hier, was ohne Geraet belegbar ist:

   1. Die Seite ist da, hat zwei Schalter und steht auf "Aus", solange der
      Fernseher nichts gemeldet hat bzw. der Dienst fehlt.
   2. Der Aufruf beim Einschalten nennt `activitymanager/create`, den
      `bootManager`-Ausloeser, `core-boot-done`, die eigene App-ID als Ziel,
      `persist: true` und `foreground: true`. Ein Aufruf ohne diese Felder
      startet entweder nichts oder nur einmal.
   3. Ein zweiter Ausloeser fuer LGs Home haengt an
      `applicationManager/getForegroundAppInfo` - derselbe Bau, anderer Ausloeser.
   4. Nach dem Einschalten steht "Ein" auf der Seite und im Bericht.
   5. Ausschalten ruft `activitymanager/remove` und die Zeile steht wieder auf "Aus".
   6. Meldet der Dienst einen Fehler, steht der Grund auf der Seite und es gibt
      keinen Schalter, der nichts tun wuerde.

   Der Pruefstand hat kein Luna. `FrameDevice.__activities` stellt den
   Fernseher nach - und schreibt jeden Aufruf mit, damit die Felder aus Punkt 2
   gegen die echte Nutzlast geprueft werden koennen, nicht gegen den Quelltext.

   Aufruf: node tools/test-startup-page.js --port 9333
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

  /* ---- 1. Seite und Leerzustand ---- */
  /* Der Fernseher meldet nichts: leere Liste, kein Fehler. */
  await evaluate('window.FrameDevice.__activities = { list: [] }; true');
  await evaluate('window.CleanFrameDebug.openGroup("startup")');
  await wait(400);
  var st = await evaluate('window.CleanFrameDebug.state()');
  var text = await evaluate('(document.body.innerText || "")');
  check(st && st.view === 'appearance', 'die Seite oeffnet', 'view=' + (st && st.view));
  check(/Nach dem Einschalten/.test(text) && /Wenn Home erscheint/.test(text),
    'beide Schalter stehen drauf', text.replace(/\s+/g, ' ').slice(0, 90));
  var rep0 = await evaluate('window.CleanFrameDebug.startupState()');
  check(rep0 && rep0.boot === false && rep0.home === false, 'beide stehen auf Aus',
    JSON.stringify(rep0 && { boot: rep0.boot, home: rep0.home }));

  /* ---- 2./3. Nutzlast von create ---- */
  await evaluate("window.FrameDevice.__activities = { list: [], calls: [] }; true");
  /* Die echte Funktion nimmt keine Nutzlast an den Stub weiter - deshalb hier
   * der Aufruf am Geraeteobjekt vorbei pruefen: was die Seite schickt, muss im
   * Aufruf stehen. Der Stub merkt sich nur, DASS etwas kam. */
  await evaluate('window.CleanFrameDebug.startupToggle("boot")');
  await wait(600);
  var rep1 = await evaluate('window.CleanFrameDebug.startupState()');
  check(rep1 && rep1.boot === true, 'der Schalter laesst sich einschalten',
    JSON.stringify(rep1 && { boot: rep1.boot }));

  /* Die Nutzlast selbst: luna() nimmt sie als JSON-String. Ohne Luna im
   * Pruefstand wird sie an einem nachgestellten PalmServiceBridge abgelesen -
   * genau die Bytes, die der Fernseher bekommt. */
  var payload = await evaluate(`new Promise(function (resolve) {
    var stub = window.FrameDevice.__activities;
    delete window.FrameDevice.__activities;   /* der echte Weg, nicht der Stub */
    var seen = [];
    var previous = window.PalmServiceBridge;
    window.PalmServiceBridge = function () {
      var self = this;
      this.call = function (uri, body) {
        seen.push({ uri: uri, body: body });
        setTimeout(function () {
          if (self.onservicecallback) self.onservicecallback(JSON.stringify({ returnValue: true, activityId: 'abc123' }));
        }, 0);
      };
      this.cancel = function () {};
    };
    window.FrameDevice.addActivity('boot', function (err, res) {
      window.PalmServiceBridge = previous;
      window.FrameDevice.__activities = stub;
      resolve(JSON.stringify({ err: err || null, res: res || null, seen: seen }));
    });
  })`);
  var p = JSON.parse(payload || '{}');
  var call = (p.seen || []).filter(function (c) { return c.uri.indexOf('activitymanager/create') >= 0; })[0];
  check(!!call, 'der Aufruf geht an activitymanager/create', call && call.uri);
  var body = {};
  try { body = JSON.parse((call && call.body) || '{}'); } catch (e) { body = {}; }
  var act = body.activity || {};
  check(body.start === true, 'die Activity startet sofort', 'start=' + body.start);
  check(act.persist === true, 'sie ueberlebt einen Neustart (persist)', 'persist=' + act.persist);
  check(!!(act.type && act.type.foreground === true), 'sie kommt in den Vordergrund',
    JSON.stringify(act.type));
  check(act.name === 'cleanframe-boot', 'sie hat einen eigenen Namen', act.name);
  var trig = act.trigger || {}, trp = trig.params || {}, trin = trp.params || {};
  check(trig.method === 'subscribe', 'der Ausloeser ist ein Abo', String(trig.method));
  check(String(trp.uri || '').indexOf('bootManager/getBootStatus') >= 0, 'er haengt am Boot-Status', String(trp.uri));
  check((trin.prop || []).indexOf('core-boot-done') >= 0, 'er wartet auf core-boot-done',
    JSON.stringify(trin.prop));
  var cb = act.callback || {}, cbp = cb.params || {};
  check(cb.method === 'launch' && cbp.appId === 'com.blackpearl.cleanframe',
    'er startet die eigene App', JSON.stringify(cbp));

  /* Home-Ausloeser */
  var payload2 = await evaluate(`new Promise(function (resolve) {
    var stub = window.FrameDevice.__activities;
    delete window.FrameDevice.__activities;
    var seen = [];
    var previous = window.PalmServiceBridge;
    window.PalmServiceBridge = function () {
      var self = this;
      this.call = function (uri, body) { seen.push({ uri: uri, body: body });
        setTimeout(function () { if (self.onservicecallback) self.onservicecallback(JSON.stringify({ returnValue: true, activityId: 'def456' })); }, 0); };
      this.cancel = function () {};
    };
    window.FrameDevice.addActivity('home', function (err, res) {
      window.PalmServiceBridge = previous;
      window.FrameDevice.__activities = stub;
      resolve(JSON.stringify({ err: err || null, seen: seen }));
    });
  })`);
  var p2 = JSON.parse(payload2 || '{}');
  var c2 = (p2.seen || [])[0] || {};
  var b2 = {};
  try { b2 = JSON.parse(c2.body || '{}'); } catch (e) { b2 = {}; }
  var tr2 = (((b2.activity || {}).trigger || {}).params || {});
  check(String(tr2.uri || '').indexOf('getForegroundAppInfo') >= 0, 'der zweite Ausloeser haengt an LGs Home', String(tr2.uri));
  check((b2.activity || {}).name === 'cleanframe-home', 'er hat seinen eigenen Namen', (b2.activity || {}).name);

  /* ---- 4. Zustand nach dem Einschalten ---- */
  /* Der Fernseher meldet eine Activity - nachgestellt, aber wirklich gelesen. */
  await evaluate("window.FrameDevice.__activities = { list: [{ name: 'cleanframe-boot', running: true }] }; true");
  await evaluate('window.CleanFrameDebug.closeSheet()');
  await evaluate('window.CleanFrameDebug.openGroup("startup")');
  await wait(600);
  var rep2 = await evaluate('window.CleanFrameDebug.startupState()');
  var text2 = await evaluate('(document.body.innerText || "")');
  check(rep2 && rep2.boot === true && rep2.home === false, 'die Seite zeigt, was der Fernseher gemeldet hat',
    JSON.stringify(rep2 && { boot: rep2.boot, home: rep2.home }));
  check(/Ein/.test(text2), 'der Schalter steht auf Ein', text2.replace(/\s+/g, ' ').slice(0, 80));

  /* Zusammenfassung in der Uebersicht */
  var summary = await evaluate('(function(){ var r = window.CleanFrameDebug.settingsRows().filter(function(x){return x.id==="startup";})[0]; return r && r.value; })()');
  check(summary === 'Beim Einschalten', 'die Uebersicht sagt "Beim Einschalten"', String(summary));

  /* ---- 5. Ausschalten ---- */
  await evaluate('window.CleanFrameDebug.startupToggle("boot")');
  await wait(600);
  var rep3 = await evaluate('window.CleanFrameDebug.startupState()');
  check(rep3 && rep3.boot === false, 'und wieder ausschalten',
    JSON.stringify(rep3 && { boot: rep3.boot }));

  /* ---- 6. Dienst meldet einen Fehler ---- */
  await evaluate("window.FrameDevice.__activities = { error: 'kein Dienst' }; true");
  await evaluate('window.CleanFrameDebug.closeSheet()');
  await evaluate('window.CleanFrameDebug.openGroup("startup")');
  await wait(450);
  var text3 = await evaluate('(document.body.innerText || "")');
  var rep4 = await evaluate('window.CleanFrameDebug.startupState()');
  check(rep4 && rep4.error === 'kein Dienst', 'der Grund des Dienstes steht im Bericht',
    rep4 && String(rep4.error));
  check(/nicht gemeldet/.test(text3) && /kein Dienst/.test(text3),
    'die Seite sagt, dass der Fernseher nichts gemeldet hat', text3.replace(/\s+/g, ' ').slice(0, 90));
  check(!/Nach dem Einschalten/.test(text3), 'und bietet keinen Schalter an, der nichts tun wuerde');

  await evaluate('delete window.FrameDevice.__activities');
  console.log('RESULT ' + passed + '/' + (passed + failed));
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('FEHLER: ' + (e && e.message));
  console.log('RESULT ' + passed + '/' + (passed + failed + 1));
  process.exit(1);
});
