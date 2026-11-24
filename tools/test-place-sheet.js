/* Ort am Fernseher: die Suche ist der Ort. Kein Listenblatt mehr.
 *
 *   node tools/test-place-sheet.js --port 9333 --hub http://127.0.0.1:8484
 *
 * Warum die Liste weg ist: sie konnte nur Orte anbieten, die der Hub schon
 * kannte - einen neuen Namen konnte sie nicht erzeugen, und am Fernseher tippt
 * niemand Buchstaben in einem Raster. Der Betreiber hat am 24.11. entschieden:
 * nur Tastatur. Damit entfaellt das Blatt mit der Suchzeile, und der Test prueft
 * jetzt den Weg, der bleibt:
 *
 *   1. Der Ort oeffnet die Suche direkt, mit Feld und Fokus (dann blendet webOS
 *      die Tastatur ein).
 *   2. Der mitgegebene Hinweis steht auf der Seite - bei fehlendem Ort ist das
 *      der Satz, der zum Eintippen auffordert.
 *   3. Eine zu kurze Eingabe wird benannt, nicht verschluckt.
 *   4. Zurueck schliesst die Suche.
 *   5. Nirgends im Blatt steht "undefined" (das war der Fehler am Geraet).
 */
var http = require('http'), net = require('net'), crypto = require('crypto'), path = require('path');
var PAGE = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
var args = process.argv.slice(2);
function arg(name, dflt) { var i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
var PORT = parseInt(arg('--port', '9333'), 10);
var HUB = arg('--hub', 'http://127.0.0.1:8484');

var id = 0, ws = null, pending = {}, results = [];

function fail(msg) { console.log('  FEHL  ' + msg); process.exit(1); }
function check(ok, name, note) {
  results.push(!!ok);
  console.log((ok ? '  ok    ' : '  FEHL  ') + name + (note ? '  ' + note : ''));
  if (!ok) process.exitCode = 1;
}

function postConfig(cfg) {
  var copy = JSON.parse(JSON.stringify(cfg));
  delete copy.rev;
  return hub('POST', '/api/config', { config: copy }).then(function (r) {
    if (!r || r.ok !== true) throw new Error('Konfiguration nicht geschrieben: ' + JSON.stringify(r).slice(0, 160));
    return r;
  });
}

function hub(method, p, body) {
  return new Promise(function (res, rej) {
    var u = new URL(HUB + p), data = body ? JSON.stringify(body) : null;
    var req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      function (r) {
        var b = ''; r.on('data', function (c) { b += c; });
        r.on('end', function () { try { res(JSON.parse(b)); } catch (e) { res(b); } });
      });
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

function connect(cb) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, function (res) {
    var b = ''; res.on('data', function (c) { b += c; });
    res.on('end', function () {
      var t = JSON.parse(b).filter(function (x) { return x.type === 'page'; })[0];
      if (!t) return fail('keine Seite im Browser');
      var m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(t.webSocketDebuggerUrl);
      ws = net.connect(parseInt(m[2], 10), m[1], function () {
        ws.write('GET ' + m[3] + ' HTTP/1.1\r\nHost: ' + m[1] + ':' + m[2] + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
          + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      ws.once('data', function () { ws.removeAllListeners('data'); attach(); cb(); });
    });
  }).on('error', function (e) { fail('CDP auf ' + PORT + ': ' + e.message); });
}
function send(method, params, cb) {
  var mid = ++id, p = Buffer.from(JSON.stringify({ id: mid, method: method, params: params || {} }));
  var head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 0xff]);
  var mask = crypto.randomBytes(4), body = Buffer.alloc(p.length);
  for (var k = 0; k < p.length; k++) body[k] = p[k] ^ mask[k % 4];
  ws.write(Buffer.concat([head, mask, body]));
  if (cb) pending[mid] = cb;
}
function attach() {
  var buf = Buffer.alloc(0);
  ws.on('data', function (c) {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      if (buf.length < 2) return;
      var len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      var frame = buf.slice(off, off + len); buf = buf.slice(off + len);
      var msg; try { msg = JSON.parse(frame.toString('utf8')); } catch (e) { continue; }
      if (msg.id && pending[msg.id]) { var cb = pending[msg.id]; delete pending[msg.id]; cb(msg); }
    }
  });
}
function js(expr, cb) {
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, function (m) {
    var r = m.result && m.result.result;
    var v = r ? (typeof r.value !== 'undefined' ? r.value : r.description) : undefined;
    if (typeof v === 'string' && /^(TypeError|ReferenceError|SyntaxError)/.test(v)) {
      console.log('  FEHL  Seite meldet: ' + v.split('\n')[0]);
      return fail('Seitenfehler');
    }
    cb(v);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function jsP(e) { return new Promise(function (res) { js(e, res); }); }

var DUMP = 'JSON.stringify((function(){var s=document.querySelector("#sheetView");'
  + 'return {text: s ? s.innerText.replace(/\\s+/g," ").trim() : null, hidden: s ? s.hidden : null,'
  + ' title: s ? (s.querySelector("h2")||{}).textContent || null : null,'
  + ' view: CleanFrameDebug.state().view,'
  + ' feld: !!document.getElementById("placeSearchInput"),'
  + ' fokus: (document.activeElement||{}).id || "",'
  + ' undefined: s ? s.innerText.indexOf("undefined") >= 0 : false};})())';

async function boot() {
  send('Page.navigate', { url: PAGE }, function () {});
  for (var n = 0; n < 150; n++) {
    if (await jsP('typeof CleanFrameDebug !== "undefined" && CleanFrameDebug.ready()') === true) return;
    await sleep(100);
  }
  fail('Seite wurde nicht fertig geladen');
}

async function main() {
  await new Promise(function (r) { connect(r); });
  await jsP('localStorage.setItem("cleanframe.lang","de"); true');
  await boot();

  var backup = await hub('GET', '/api/config');
  var cfg = backup.config || backup;
  var hadPlace = ((cfg.integrations || {}).weather || {}).place || '';

  /* --- Fall 1: mit gesetztem Ort oeffnet der Ort die Suche, nicht eine Liste --- */
  var withPlace = JSON.parse(JSON.stringify(cfg));
  withPlace.integrations = withPlace.integrations || {};
  withPlace.integrations.weather = withPlace.integrations.weather || {};
  withPlace.integrations.weather.place = 'Kiel, DE';
  withPlace.integrations.weather.lat = 54.3213;
  withPlace.integrations.weather.lon = 10.1349;
  await postConfig(withPlace);
  await boot();

  await jsP('CleanFrameDebug.openPlace("Choose a place for the weather line.")');
  await sleep(500);
  var d1 = JSON.parse(await jsP(DUMP));
  check(d1 && d1.view === 'placesearch', 'der Ort oeffnet die Suche direkt', d1 && d1.view);
  check(d1 && d1.title === 'Ort suchen', 'das Blatt traegt die Ueberschrift "Ort suchen"', d1 && d1.title);
  check(d1 && d1.feld === true, 'es gibt ein echtes Eingabefeld');
  check(d1 && d1.fokus === 'placeSearchInput', 'das den Fokus hat (dann blendet webOS die Tastatur ein)', d1 && d1.fokus);
  check(d1 && /Choose a place|Wähle einen Ort/.test(d1.text || ''), 'der mitgegebene Hinweis steht auf der Seite', JSON.stringify((d1 && d1.text || '').slice(0, 70)));
  check(d1 && d1.undefined === false, 'kein "undefined" im Blatt');

  /* --- Fall 2: zu kurze Eingabe wird benannt --- */
  await jsP('(function(){var el=document.getElementById("placeSearchInput");el.value="K";el.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  await jsP('CleanFrameDebug.press(["ok"])');
  await sleep(400);
  var d2 = JSON.parse(await jsP(DUMP));
  check(d2 && /zwei|two/i.test(d2.text || ''), 'eine zu kurze Eingabe wird benannt, nicht verschluckt', JSON.stringify((d2 && d2.text || '').slice(0, 70)));
  check(d2 && d2.undefined === false, 'auch dabei kein "undefined"');

  /* --- Fall 3: Zurueck schliesst die Suche --- */
  await jsP('CleanFrameDebug.press(["back"])');
  await sleep(350);
  var d3 = JSON.parse(await jsP(DUMP));
  check(d3 && d3.view !== 'placesearch', 'Zurueck verlaesst die Suche', d3 && d3.view);
  check(d3 && d3.hidden === true, 'und das Blatt ist zu', d3 && d3.hidden);

  /* --- Fall 4: ohne jeden Ort fordert der Hinweis zum Eintippen auf --- */
  var none = JSON.parse(JSON.stringify(cfg));
  none.integrations = none.integrations || {};
  none.integrations.weather = none.integrations.weather || {};
  none.integrations.weather.place = '';
  none.integrations.weather.lat = 0; none.integrations.weather.lon = 0;
  await postConfig(none);
  await boot();
  await jsP('CleanFrameDebug.openPlace("Set the place first, then the weather can show.")');
  await sleep(500);
  var d4 = JSON.parse(await jsP(DUMP));
  check(d4 && d4.view === 'placesearch', 'ohne Ort oeffnet sich trotzdem die Suche', d4 && d4.view);
  check(d4 && /Set the place first|Setze zuerst den Ort/.test(d4.text || ''), 'der Hinweis nennt den fehlenden Ort', JSON.stringify((d4 && d4.text || '').slice(0, 70)));
  check(d4 && d4.undefined === false, 'und nirgends "undefined"');
  await jsP('CleanFrameDebug.press(["back"])');
  await sleep(300);

  /* Konfiguration zurueckstellen. */
  await postConfig(cfg);
  await boot();
  var restored = await hub('GET', '/api/config');
  var rcfg = restored.config || restored;
  var rplace = ((rcfg.integrations || {}).weather || {}).place || '';
  check(rplace === hadPlace, 'Konfiguration wiederhergestellt', 'place=' + rplace);

  console.log('\nRESULT ' + results.filter(Boolean).length + '/' + results.length);
  process.exit(process.exitCode || 0);
}
main();
