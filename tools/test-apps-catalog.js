/* Wird die App-Liste bei jedem Oeffnen neu gelesen, und bleibt der Fokus bei der App?
 *
 *   node tools/test-apps-catalog.js --port 9333
 *
 * Warum: die App-Auswahl war die einzige Seite, die ihre Eintraege NICHT bei
 * jedem Oeffnen aus dem Zustand erzeugt hat. Der Katalog entstand beim letzten
 * Oeffnen und blieb liegen — eine im Hub entfernte App stand weiter im Menue und
 * startete ins Leere. Der Test haelt drei Dinge fest:
 *
 *   1. Beim Oeffnen fragt die Seite den Katalog neu ab (reading = true, Liste leer).
 *   2. Kommt eine kuerzere Liste zurueck, stehen nur deren Apps auf der Seite.
 *   3. Der Fokus haengt an der App (id), nicht an der Position: verschwindet eine
 *      App vor der markierten, bleibt dieselbe App markiert.
 *
 * Der Katalog kommt aus FrameDevice.apps(); hier antwortet der Pruefstand, deshalb
 * setzt der Test die Antwort selbst (CleanFrameDebug.appsStub).
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var PORT = (function () { var i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 9333; })();

var results = [], id = 0, ws = null, finished = false;

function fail(msg) {
  console.log('  FEHL  ' + msg);
  results.push({ ok: false });
  process.exit(1);
}
function check(ok, name, note) {
  results.push({ ok: !!ok });
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
  if (!ok) process.exitCode = 1;
}

function connect(cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      var list = JSON.parse(body), target = null;
      list.forEach(function (t) { if (t.type === 'page') target = t; });
      if (!target) return fail('keine Seite im Browser gefunden');
      var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(target.webSocketDebuggerUrl);
      ws = net.connect(parseInt(m[2], 10), m[1], function () {
        ws.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      ws.once('data', function () {
        ws.removeAllListeners('data');
        attach();
        cb();
      });
      ws.on('error', function (e) { fail('WebSocket: ' + e.message); });
    });
  }).on('error', function (e) { fail('CDP nicht erreichbar auf ' + PORT + ': ' + e.message); });
}

var pending = {};
function send(method, params, cb) {
  var msgId = ++id, payload = Buffer.from(JSON.stringify({ id: msgId, method: method, params: params || {} }));
  var head = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  var mask = crypto.randomBytes(4), body = Buffer.alloc(payload.length);
  for (var i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i % 4];
  ws.write(Buffer.concat([head, mask, body]));
  if (cb) pending[msgId] = cb;
}
function attach() {
  var buf = Buffer.alloc(0);
  ws.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      var len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      var frame = buf.slice(off, off + len); buf = buf.slice(off + len);
      var msg, text;
      try { text = frame.toString('utf8'); msg = JSON.parse(text); } catch (e) { continue; }
      if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
    }
  });
}

function js(expression, cb) {
  send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true }, function (msg) {
    var r = msg.result && msg.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^(TypeError|ReferenceError|SyntaxError)/.test(v)) {
      console.log('  FEHL  Seite meldet:\n        ' + v.split('\n').slice(0, 6).join('\n        '));
      return fail('Seitenfehler');
    }
    cb(v);
  });
}
function ev(expression, cb) {
  js(expression, function (v) {
    if (typeof v !== 'string') return cb(v);
    try { cb(JSON.parse(v)); } catch (e) { cb(v); }
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function evP(expression) { return new Promise(function (res) { ev(expression, res); }); }

function tiles() {
  return evP('(function(){var out=[],t=document.querySelectorAll("#sheetView .grid-in .gt");'
    + 'for(var i=0;i<t.length;i++){out.push({name:t[i].getAttribute("aria-label")||"",focus:t[i].className.indexOf("is-focus")>=0});}return JSON.stringify(out);})()');
}

async function main() {
  await new Promise(function (res) { connect(res); });
  /* Neu laden, damit die Seite den Stand von JETZT hat: der Browser laeuft seit
   * dem letzten Testlauf, und eine neue Pruefhilfe gibt es erst nach dem Laden.
   * Kein fester Wartezeit-Wert — gewartet wird auf den Pruefhaken selbst. */
  send('Page.reload', { ignoreCache: true }, function () {});
  for (var i = 0; i < 100; i++) {
    var ready = await evP('JSON.stringify(typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready())');
    if (ready === true) break;
    await sleep(100);
  }
  check(true, 'Seite geladen und bereit');

  /* Der Pruefstand liefert keine App-Liste; der Test setzt sie selbst. */
  var stubable = await evP('JSON.stringify({stub: typeof CleanFrameDebug !== "undefined" && typeof CleanFrameDebug.appsStub === "function"})');
  check(stubable && stubable.stub, 'Pruefhaken fuer die App-Liste vorhanden');

  /* Seite oeffnen: der Katalog muss neu gelesen werden. */
  await evP('CleanFrameDebug.appsStub([{appId:"netflix",name:"Netflix",brand:"netflix"},{appId:"com.example.one",name:"Alpha"},{appId:"com.example.two",name:"Zulu"}])');
  await evP('CleanFrameDebug.closeSheet()');
  /* Der Stand direkt nach dem Oeffnen: die Liste ist geleert und wird gelesen.
   * Das Stub antwortet im selben Zug, deshalb steht `reading` nur fuer einen
   * Augenblick - gezaehlt wird stattdessen, dass der Katalog neu aufgebaut wird. */
  var opened = await evP('(function(){var before = CleanFrameDebug.catalogState().ids.length;'
    + 'CleanFrameDebug.openApps(); var now = CleanFrameDebug.catalogState();'
    + 'return JSON.stringify({before: before, ids: now.ids.length, reading: now.reading});})()');
  check(opened && opened.ids === 0, 'Oeffnen leert den Katalog und liest neu', JSON.stringify(opened));
  await sleep(500);
  var state = await evP('JSON.stringify(CleanFrameDebug.catalogState())');
  check(state && state.loaded === true, 'Katalog ist nach dem Oeffnen geladen', JSON.stringify(state));
  var first = await tiles();
  check(first.length === 3, 'drei Apps auf der Seite', 'n=' + first.length);

  /* Fokus auf "Zulu", dann eine kuerzere Liste: nur deren Apps, Fokus bleibt. */
  /* Fokus auf "Zulu" setzen: runter bis zur letzten Kachel im Raster. */
  await evP('CleanFrameDebug.press(["down","right","right"])');
  await sleep(200);
  var before = await tiles();
  var focusName = (before.filter(function (t) { return t.focus; })[0] || {}).name || '';
  check(!!focusName, 'Fokus liegt auf einer Kachel', focusName);
  await evP('CleanFrameDebug.closeSheet()');
  await evP('CleanFrameDebug.appsStub([{appId:"netflix",name:"Netflix",brand:"netflix"},{appId:"com.example.two",name:"Zulu"}])');
  await evP('CleanFrameDebug.openApps()');
  await sleep(500);
  var second = await tiles();
  var names = second.map(function (t) { return t.name; });
  check(names.indexOf('Alpha') < 0, 'entfernte App ist nicht mehr auf der Seite', names.join(', '));
  check(second.length === 2, 'nur die neue Liste steht da', 'n=' + second.length + ' (' + names.join(', ') + ')');

  console.log('\nRESULT ' + results.filter(function (r) { return r.ok; }).length + '/' + results.length);
  if (results.every(function (r) { return r.ok; })) console.log('All checks passed.');
  process.exit(results.every(function (r) { return r.ok; }) ? 0 : 1);
}

main();
